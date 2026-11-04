import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Repository } from '../../repositories/repository';
import { DomainError } from '../../repositories/repository';
import { idSchema } from '../../common/schemas';
import { response } from '../../common/response';
/** 注册保障对象、保障预案和活动报告。
 * @param app HTTP 应用。
 * @param pool PostgreSQL 业务池。
 * @param repository 统一资产仓储。
 * @returns 无返回值，注册保电扩展路由。
 */
export function registerProtectionRoutes(app: FastifyInstance, pool: Pool, repository: Repository) {
  app.get('/api/v1/protection-events/:id', async (request) => {
    const id = (request.params as { id: string }).id;
    const row = (
      await pool.query(
        'SELECT id,name,level,status,starts_at::double precision AS "startsAt",ends_at::double precision AS "endsAt",plan FROM protection_events WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (!row) throw new DomainError(404, 'NOT_FOUND', '保电活动不存在');
    return response(
      {
        ...row,
        assetIds: (
          await pool.query('SELECT asset_id FROM protected_assets WHERE event_id=$1', [id])
        ).rows.map((a) => a.asset_id),
      },
      request.id,
    );
  });
  app.put('/api/v1/protection-events/:id/targets', async (request) => {
    const id = (request.params as { id: string }).id;
    const { assetIds } = z
      .strictObject({ assetIds: z.array(idSchema).max(500) })
      .parse(request.body);
    const ids = [...new Set(assetIds)];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (
        !(await client.query('SELECT id FROM protection_events WHERE id=$1 FOR UPDATE', [id]))
          .rowCount
      )
        throw new DomainError(404, 'NOT_FOUND', '保电活动不存在');
      if (
        (await client.query('SELECT id FROM assets WHERE id=ANY($1::text[])', [ids])).rowCount !==
        ids.length
      )
        throw new DomainError(422, 'INVALID_ASSET', '保障对象含不存在的资产');
      await client.query('DELETE FROM protected_assets WHERE event_id=$1', [id]);
      for (const assetId of ids)
        await client.query('INSERT INTO protected_assets VALUES($1,$2)', [id, assetId]);
      await client.query(
        'INSERT INTO audit_log(action,entity_id,timestamp,details) VALUES($1,$2,$3,$4)',
        ['protection.targets', id, Date.now(), ids.join(',')],
      );
      await client.query('COMMIT');
      return response({ id, assetIds: ids }, request.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  app.get('/api/v1/protection-events/:id/assets', async (request) => {
    const ids = (
      await pool.query('SELECT asset_id FROM protected_assets WHERE event_id=$1', [
        (request.params as { id: string }).id,
      ])
    ).rows.map((a) => a.asset_id);
    return response(
      (await repository.assets()).filter((a) => ids.includes(a.id)),
      request.id,
    );
  });
  app.get('/api/v1/protection-plans', async (request) =>
    response(
      (
        await pool.query(
          'SELECT id,event_id AS "eventId",name,content,status FROM protection_plans ORDER BY id',
        )
      ).rows,
      request.id,
    ),
  );
  app.post('/api/v1/protection-plans', async (request, reply) => {
    const plan = z
      .strictObject({
        id: idSchema,
        eventId: idSchema,
        name: z.string().min(1).max(100),
        content: z.string().min(1).max(10000),
        status: z.enum(['draft', 'approved']).default('draft'),
      })
      .parse(request.body);
    if (
      !(await pool.query('SELECT id FROM protection_events WHERE id=$1', [plan.eventId])).rowCount
    )
      throw new DomainError(422, 'INVALID_EVENT', '保电活动不存在');
    await pool.query('INSERT INTO protection_plans VALUES($1,$2,$3,$4,$5)', [
      plan.id,
      plan.eventId,
      plan.name,
      plan.content,
      plan.status,
    ]);
    return reply.code(201).send(response(plan, request.id));
  });
  app.get('/api/v1/reports/protection', async (request) => {
    const [catalog, alarms, orders, events] = await Promise.all([
      repository.catalog(),
      pool.query('SELECT count(*)::integer AS n FROM alarms'),
      pool.query(
        "SELECT count(*) FILTER(WHERE status='closed')::integer AS closed,count(*) FILTER(WHERE status<>'closed')::integer AS open FROM work_orders",
      ),
      pool.query(
        'SELECT p.id,p.name,p.level,p.status,count(a.asset_id)::integer AS "assetCount" FROM protection_events p LEFT JOIN protected_assets a ON a.event_id=p.id GROUP BY p.id ORDER BY p.starts_at',
      ),
    ]);
    return response(
      {
        generatedAt: Date.now(),
        events: events.rows,
        assetCount: catalog.assets.length,
        lineCount: catalog.lines.length,
        alarmCount: alarms.rows[0].n,
        closedOrders: orders.rows[0].closed,
        openOrders: orders.rows[0].open,
      },
      request.id,
    );
  });
}
