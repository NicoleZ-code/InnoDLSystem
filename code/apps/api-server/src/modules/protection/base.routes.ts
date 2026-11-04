import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { response } from '../../common/response';
import { idSchema } from '../../common/schemas';
import { DomainError } from '../../repositories/repository';
import { createMutation } from '../../repositories/unit-of-work';
/** 注册保电活动核心维护。
 * @param app HTTP 应用适配器。
 * @param pool PostgreSQL 业务数据库。
 * @returns 无返回值，向模块注册领域路由。
 */
export function registerProtectionBase(app: FastifyInstance, pool: Pool) {
  const mutate = createMutation(pool);
  const eventSchema = z
    .strictObject({
      id: idSchema,
      name: z.string().trim().min(1).max(100),
      level: z.enum(['一级', '二级', '三级']),
      status: z.enum(['draft', 'active', 'completed']),
      startsAt: z.number().int().positive(),
      endsAt: z.number().int().positive(),
      plan: z.string().max(5000),
      assetIds: z.array(idSchema).max(500),
    })
    .refine((event) => event.endsAt > event.startsAt, { message: '结束时间必须晚于开始时间' });
  app.get('/api/v1/protection-events', async (request) =>
    response(
      (
        await pool.query(
          'SELECT p.id,p.name,p.level,p.status,p.starts_at::double precision AS "startsAt",p.ends_at::double precision AS "endsAt",p.plan,COALESCE(json_agg(a.asset_id) FILTER(WHERE a.asset_id IS NOT NULL),\'[]\') AS "assetIds" FROM protection_events p LEFT JOIN protected_assets a ON a.event_id=p.id GROUP BY p.id ORDER BY p.starts_at DESC',
        )
      ).rows,
      request.id,
    ),
  );
  /** 保存完整保电活动与独立保护资产关联表。
   * @param body 已校验的活动数据。
   * @param create 是否创建新活动。
   * @returns 保存后的活动数据。
   */
  async function saveEvent(body: z.infer<typeof eventSchema>, create: boolean) {
    return mutate(create ? 'protection.created' : 'protection.updated', body.id, async (c) => {
      const exists = (await c.query('SELECT id FROM protection_events WHERE id=$1', [body.id]))
        .rowCount;
      if (create && exists) throw new DomainError(409, 'CONFLICT', '活动 ID 已存在');
      if (!create && !exists) throw new DomainError(404, 'NOT_FOUND', '未找到活动');
      const unique = [...new Set(body.assetIds)];
      if (
        unique.length &&
        (await c.query('SELECT id FROM assets WHERE id=ANY($1::text[])', [unique])).rowCount !==
          unique.length
      )
        throw new DomainError(422, 'INVALID_ASSET', '保障对象必须引用已有资产');
      if (
        body.status === 'completed' &&
        (
          await c.query("SELECT id FROM work_orders WHERE event_id=$1 AND status<>'closed'", [
            body.id,
          ])
        ).rowCount
      )
        throw new DomainError(409, 'OPEN_WORK_ORDERS', '还有未闭环工单，不能归档活动');
      await c.query(
        'INSERT INTO protection_events VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,level=excluded.level,status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at,plan=excluded.plan',
        [body.id, body.name, body.level, body.status, body.startsAt, body.endsAt, body.plan],
      );
      await c.query('DELETE FROM protected_assets WHERE event_id=$1', [body.id]);
      for (const id of unique)
        await c.query('INSERT INTO protected_assets VALUES($1,$2)', [body.id, id]);
      return body;
    });
  }
  app.post('/api/v1/protection-events', async (request, reply) =>
    reply
      .code(201)
      .send(response(await saveEvent(eventSchema.parse(request.body), true), request.id)),
  );
  app.put('/api/v1/protection-events/:id', async (request) => {
    const body = eventSchema.parse(request.body);
    if ((request.params as { id: string }).id !== body.id)
      throw new DomainError(400, 'ID_MISMATCH', '活动 ID 不一致');
    return response(await saveEvent(body, false), request.id);
  });
}
