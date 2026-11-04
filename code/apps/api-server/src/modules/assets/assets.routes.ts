import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { idSchema } from '../../common/schemas';
import { response } from '../../common/response';
import { DomainError, type Repository } from '../../repositories/repository';
/** 注册区域维护、子资产和视域资产查询。
 * @param app HTTP 应用。
 * @param pool PostgreSQL 池，存在 PostGIS 时执行空间索引查询。
 * @param repository 共享资产仓储。
 * @returns 无返回值，注册资产扩展路由。
 */
export function registerAssetRoutes(app: FastifyInstance, pool: Pool, repository: Repository) {
  const areaSchema = z.strictObject({
    id: idSchema,
    name: z.string().trim().min(1).max(100),
    parentId: idSchema.nullable().optional(),
  });
  app.get('/api/v1/areas', async (request) =>
    response(
      (await pool.query('SELECT id,name,parent_id AS "parentId",boundary FROM regions ORDER BY id'))
        .rows,
      request.id,
    ),
  );
  app.get('/api/v1/areas/:id', async (request) => {
    const row = (
      await pool.query('SELECT id,name,parent_id AS "parentId",boundary FROM regions WHERE id=$1', [
        (request.params as { id: string }).id,
      ])
    ).rows[0];
    if (!row) throw new DomainError(404, 'NOT_FOUND', '区域不存在');
    return response(row, request.id);
  });
  app.post('/api/v1/areas', async (request, reply) => {
    const body = areaSchema.parse(request.body);
    if (body.parentId === body.id)
      throw new DomainError(422, 'INVALID_PARENT', '区域不能作为自己的父级');
    await pool.query('INSERT INTO regions(id,name,parent_id) VALUES($1,$2,$3)', [
      body.id,
      body.name,
      body.parentId ?? null,
    ]);
    return reply.code(201).send(response(body, request.id));
  });
  app.put('/api/v1/areas/:id', async (request) => {
    const body = areaSchema.parse(request.body);
    if ((request.params as { id: string }).id !== body.id)
      throw new DomainError(400, 'ID_MISMATCH', '区域 ID 不一致');
    if (body.parentId === body.id)
      throw new DomainError(422, 'INVALID_PARENT', '区域不能作为自己的父级');
    const row = await pool.query(
      'UPDATE regions SET name=$1,parent_id=$2 WHERE id=$3 RETURNING id',
      [body.name, body.parentId ?? null, body.id],
    );
    if (!row.rowCount) throw new DomainError(404, 'NOT_FOUND', '区域不存在');
    return response(body, request.id);
  });
  app.get('/api/v1/assets/:id/children', async (request) => {
    const ids = (
      await pool.query('SELECT id FROM assets WHERE parent_id=$1', [
        (request.params as { id: string }).id,
      ])
    ).rows.map((row) => row.id);
    return response(
      (await repository.assets()).filter((a) => ids.includes(a.id)),
      request.id,
    );
  });
  app.get('/api/v1/assets/geojson', async (request) => {
    const query = z
      .object({
        bbox: z.string().optional(),
        type: z.string().optional(),
        zoom: z.coerce.number().min(0).max(24).default(12),
      })
      .parse(request.query);
    const bounds = query.bbox ? query.bbox.split(',').map(Number) : [-180, -90, 180, 90];
    if (
      bounds.length !== 4 ||
      bounds.some((v) => !Number.isFinite(v)) ||
      bounds[0] > bounds[2] ||
      bounds[1] > bounds[3]
    )
      throw new DomainError(400, 'INVALID_BBOX', 'bbox 必须为西、南、东、北四个有效数值');
    const spatial = (await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='assets' AND column_name='location'")).rowCount;
    const result = await pool.query(
      spatial ? 'SELECT id,name,type,longitude,latitude,height FROM assets WHERE ST_Intersects(location,ST_MakeEnvelope($1,$2,$3,$4,4326)) AND ($5::text IS NULL OR type=$5) ORDER BY id LIMIT $6' :
      'SELECT id,name,type,longitude,latitude,height FROM assets WHERE longitude BETWEEN $1 AND $3 AND latitude BETWEEN $2 AND $4 AND ($5::text IS NULL OR type=$5) ORDER BY id LIMIT $6',
      [...bounds, query.type ?? null, query.zoom < 10 ? 50 : 200],
    );
    return response(
      {
        type: 'FeatureCollection',
        features: result.rows.map((row) => ({
          type: 'Feature',
          id: row.id,
          properties: { assetId: row.id, name: row.name, type: row.type },
          geometry: { type: 'Point', coordinates: [row.longitude, row.latitude, row.height] },
        })),
      },
      request.id,
    );
  });
  app.get('/api/v1/topology/graph', async (request) =>
    response(
      {
        nodes: (
          await pool.query(
            'SELECT id,asset_id AS "assetId",node_type AS type,electrical_code AS code FROM topology_nodes ORDER BY id',
          )
        ).rows,
        edges: (
          await pool.query(
            'SELECT id,from_node_id AS "fromNodeId",to_node_id AS "toNodeId",line_id AS "lineId",state FROM topology_edges ORDER BY id',
          )
        ).rows,
      },
      request.id,
    ),
  );
  app.get('/api/v1/topology/paths', async (request) => {
    const { from, to } = z.object({ from: idSchema, to: idSchema }).parse(request.query);
    const graph = (await pool.query("SELECT * FROM topology_edges WHERE state='CLOSED'")).rows;
    const queue: { id: string; path: string[] }[] = [{ id: from, path: [from] }];
    const visited = new Set([from]);
    let path: string[] = [];
    while (queue.length) {
      const node = queue.shift()!;
      if (node.id === to) {
        path = node.path;
        break;
      }
      for (const edge of graph)
        if (edge.from_node_id === node.id && !visited.has(edge.to_node_id)) {
          visited.add(edge.to_node_id);
          queue.push({ id: edge.to_node_id, path: [...node.path, edge.to_node_id] });
        }
    }
    return response({ from, to, path }, request.id);
  });
  app.post('/api/v1/topology/publish', async (request, reply) => {
    const snapshot = {
      nodes: (await pool.query('SELECT * FROM topology_nodes')).rows,
      edges: (await pool.query('SELECT * FROM topology_edges')).rows,
    };
    const id = `network-${Date.now()}`;
    const version = (
      await pool.query(
        'INSERT INTO topology_versions SELECT $1,COALESCE(MAX(version),0)+1,$2,$3 FROM topology_versions RETURNING version',
        [id, Date.now(), snapshot],
      )
    ).rows[0].version;
    return reply.code(201).send(response({ id, version }, request.id));
  });
  app.get('/api/v1/platform/summary', async (request) => {
    const result = await pool.query(
      "SELECT (SELECT count(*)::integer FROM assets) AS assets,(SELECT count(*)::integer FROM power_lines) AS lines,(SELECT count(*)::integer FROM protection_events WHERE status='active') AS activities,(SELECT count(*)::integer FROM work_orders WHERE status<>'closed') AS \"openOrders\",(SELECT count(*)::integer FROM alarms WHERE status='active') AS alarms",
    );
    return response(result.rows[0], request.id);
  });
}
