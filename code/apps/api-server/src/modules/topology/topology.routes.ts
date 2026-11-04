import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Repository } from '../../repositories/repository';
import { DomainError } from '../../repositories/repository';
import { z } from 'zod';
import { idSchema } from '../../common/schemas';
import { response } from '../../common/response';
/** 注册上下游供电追踪分析。
 * @param app HTTP 应用。
 * @param repository 统一拓扑仓储。
 * @param pool 电气拓扑数据库连接池。
 * @returns 无返回值，注册拓扑业务路由。
 */
export function registerTopologyRoutes(app: FastifyInstance, repository: Repository, pool: Pool) {
  app.get('/api/v1/topology/edges', async (request) =>
    response(
      (
        await pool.query(
          'SELECT id,from_node_id AS "fromNodeId",to_node_id AS "toNodeId",line_id AS "lineId",state FROM topology_edges ORDER BY id',
        )
      ).rows,
      request.id,
    ),
  );
  app.put('/api/v1/topology/edges/:id', async (request) => {
    const { state } = z
      .strictObject({ state: z.enum(['CLOSED', 'OPEN', 'UNKNOWN']) })
      .parse(request.body);
    const id = idSchema.parse((request.params as { id: string }).id);
    const result = await pool.query(
      'UPDATE topology_edges SET state=$1 WHERE id=$2 RETURNING id,state',
      [state, id],
    );
    if (!result.rowCount) throw new DomainError(404, 'NOT_FOUND', '拓扑连接不存在');
    await pool.query(
      'INSERT INTO audit_log(action,entity_id,timestamp,details) VALUES($1,$2,$3,$4)',
      ['topology.state', id, Date.now(), state],
    );
    return response(result.rows[0], request.id);
  });
  app.get('/api/v1/topology/trace', async (request) => {
    const query = z
      .object({
        assetId: idSchema,
        direction: z.enum(['upstream', 'downstream']).default('upstream'),
      })
      .parse(request.query);
    const catalog = await repository.catalog();
    if (!catalog.assets.some((a) => a.id === query.assetId))
      throw new DomainError(404, 'NOT_FOUND', '资产不存在');
    const closed = new Set(
      (await pool.query("SELECT line_id FROM topology_edges WHERE state='CLOSED'")).rows.map(
        (row) => row.line_id,
      ),
    );
    const visited = new Set([query.assetId]);
    const edges = new Set<string>();
    const queue = [query.assetId];
    while (queue.length) {
      const current = queue.shift()!;
      for (const line of catalog.lines.filter((line) => closed.has(line.id))) {
        const from = query.direction === 'upstream' ? line.toId : line.fromId;
        const to = query.direction === 'upstream' ? line.fromId : line.toId;
        if (from === current) {
          edges.add(line.id);
          if (!visited.has(to)) {
            visited.add(to);
            queue.push(to);
          }
        }
      }
    }
    return response(
      { assetIds: [...visited], lineIds: [...edges], direction: query.direction },
      request.id,
    );
  });
}
