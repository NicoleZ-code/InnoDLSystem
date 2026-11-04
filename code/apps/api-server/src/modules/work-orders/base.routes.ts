import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { response } from '../../common/response';
import { idSchema } from '../../common/schemas';
import { DomainError } from '../../repositories/repository';
import { createMutation } from '../../repositories/unit-of-work';
import { authenticatedUsers } from '../auth/context';
import { randomUUID, createHash } from 'node:crypto';
/** 注册工单创建与查询；状态变更由显式动作接口负责。
 * @param app HTTP 应用适配器。
 * @param pool PostgreSQL 业务数据库。
 * @returns 无返回值，向模块注册领域路由。
 */
export function registerOrderBase(app: FastifyInstance, pool: Pool) {
  const mutate = createMutation(pool);
  app.get('/api/v1/work-orders', async (request) =>
    response(
      (
        await pool.query(
          'SELECT id,alarm_id AS "alarmId",asset_id AS "assetId",event_id AS "eventId",title,assignee,status,feedback,version,created_at::double precision AS "createdAt",updated_at::double precision AS "updatedAt" FROM work_orders ORDER BY created_at DESC LIMIT 500',
        )
      ).rows,
      request.id,
    ),
  );
  app.post('/api/v1/work-orders', async (request, reply) => {
    const body = z
      .strictObject({
        assetId: idSchema,
        alarmId: idSchema.nullable().optional(),
        eventId: idSchema.nullable().optional(),
        title: z.string().trim().min(1).max(200),
        assignee: z.string().trim().min(1).max(80),
      })
      .parse(request.body);
    const id = randomUUID();
    const supplied = request.headers['idempotency-key'];
    const key =
      typeof supplied === 'string'
        ? `${authenticatedUsers.get(request)!.id}:${z.string().min(1).max(120).parse(supplied)}`
        : undefined;
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const result = await mutate('workorder.created', id, async (c) => {
      if (key) {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        const existing = (await c.query('SELECT * FROM idempotency_keys WHERE key=$1', [key]))
          .rows[0];
        if (existing) {
          if (existing.request_hash !== hash)
            throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同请求');
          return existing.result;
        }
      }
      if (!(await c.query('SELECT id FROM assets WHERE id=$1', [body.assetId])).rowCount)
        throw new DomainError(422, 'INVALID_ASSET', '资产不存在');
      if (
        body.eventId &&
        !(await c.query('SELECT id FROM protection_events WHERE id=$1', [body.eventId])).rowCount
      )
        throw new DomainError(422, 'INVALID_EVENT', '保电活动不存在');
      if (
        body.alarmId &&
        !(
          await c.query('SELECT id FROM alarms WHERE id=$1 AND asset_id=$2', [
            body.alarmId,
            body.assetId,
          ])
        ).rowCount
      )
        throw new DomainError(422, 'INVALID_ALARM', '告警与资产不一致');
      await c.query("INSERT INTO work_orders VALUES($1,$2,$3,$4,$5,$6,'pending','',$7,$7)", [
        id,
        body.alarmId ?? null,
        body.assetId,
        body.eventId ?? null,
        body.title,
        body.assignee,
        Date.now(),
      ]);
      const result = { id, ...body, status: 'pending', version: 1 };
      if (key)
        await c.query('INSERT INTO idempotency_keys VALUES($1,$2,$3,$4)', [
          key,
          hash,
          result,
          Date.now(),
        ]);
      return result;
    });
    return reply.code(201).send(response(result, request.id));
  });
}
