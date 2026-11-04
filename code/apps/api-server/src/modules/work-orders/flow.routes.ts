import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { DomainError } from '../../repositories/repository';
import { authenticatedUsers } from '../auth/context';
import { response } from '../../common/response';
/** 注册工单显式状态机动作，使用版本号保护并发操作。
 * @param app HTTP 应用。
 * @param pool PostgreSQL 池。
 * @returns 无返回值，注册指派、开始、提交和复核动作。
 */
export function registerFlowRoutes(app: FastifyInstance, pool: Pool) {
  for (const action of ['assign', 'start', 'submit', 'review'] as const) {
    app.post(`/api/v1/work-orders/:id/${action}`, async (request) => {
      const id = (request.params as { id: string }).id;
      const body = z
        .object({
          version: z.number().int().positive(),
          assignee: z.string().trim().max(80).optional(),
          feedback: z.string().trim().max(5000).optional(),
          approved: z.boolean().default(true),
        })
        .parse(request.body);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const order = (await client.query('SELECT * FROM work_orders WHERE id=$1 FOR UPDATE', [id]))
          .rows[0];
        if (!order) throw new DomainError(404, 'NOT_FOUND', '工单不存在');
        const actor = authenticatedUsers.get(request)!;
        if (
          actor.role === 'operator' &&
          (['assign', 'review'].includes(action) ||
            ![actor.id, actor.username].includes(order.assignee))
        )
          throw new DomainError(
            403,
            'FORBIDDEN',
            '运维人员只能处理指派给自己的工单，指派和复核由主管完成',
          );
        const next =
          action === 'assign'
            ? 'assigned'
            : action === 'start'
              ? 'processing'
              : action === 'submit'
                ? 'resolved'
                : body.approved
                  ? 'closed'
                  : 'processing';
        if (order.status === next) {
          await client.query('COMMIT');
          return response(
            { id, status: next, version: order.version, idempotent: true },
            request.id,
          );
        }
        if (order.version !== body.version)
          throw new DomainError(409, 'STALE_VERSION', '工单已被他人修改，请刷新后重试');
        const allowed =
          action === 'assign'
            ? ['pending']
            : action === 'start'
              ? ['assigned']
              : action === 'submit'
                ? ['processing']
                : ['resolved'];
        if (!allowed.includes(order.status))
          throw new DomainError(409, 'INVALID_TRANSITION', '当前工单状态不允许执行该动作');
        if (action === 'assign' && !body.assignee)
          throw new DomainError(400, 'ASSIGNEE_REQUIRED', '请指定处理人员');
        if (action === 'submit' && !body.feedback)
          throw new DomainError(400, 'FEEDBACK_REQUIRED', '请填写现场处理反馈');
        if (
          action === 'review' &&
          body.approved &&
          (
            await client.query("SELECT id FROM alarms WHERE asset_id=$1 AND status='active'", [
              order.asset_id,
            ])
          ).rowCount
        )
          throw new DomainError(
            409,
            'ALARM_NOT_RECOVERED',
            '设备仍存在活动告警，恢复后才能复核关闭',
          );
        await client.query(
          'UPDATE work_orders SET status=$1,assignee=$2,feedback=$3,version=version+1,updated_at=$4 WHERE id=$5',
          [next, body.assignee ?? order.assignee, body.feedback ?? order.feedback, Date.now(), id],
        );
        await client.query(
          'INSERT INTO work_order_logs(order_id,actor_id,action,remark,occurred_at) VALUES($1,$2,$3,$4,$5)',
          [id, actor.id, action, body.feedback ?? '', Date.now()],
        );
        await client.query(
          'INSERT INTO audit_log(action,entity_id,timestamp,details) VALUES($1,$2,$3,$4)',
          [`workorder.${action}`, id, Date.now(), `${order.status} → ${next}`],
        );
        await client.query('COMMIT');
        return response({ id, status: next, version: order.version + 1 }, request.id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }
  app.get('/api/v1/work-orders/:id', async (request) => {
    const id = (request.params as { id: string }).id;
    const order = (
      await pool.query(
        'SELECT id,alarm_id AS "alarmId",asset_id AS "assetId",event_id AS "eventId",title,assignee,status,feedback,version,created_at::double precision AS "createdAt",updated_at::double precision AS "updatedAt" FROM work_orders WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (!order) throw new DomainError(404, 'NOT_FOUND', '工单不存在');
    return response(
      {
        ...order,
        logs: (
          await pool.query('SELECT * FROM work_order_logs WHERE order_id=$1 ORDER BY occurred_at', [
            id,
          ])
        ).rows,
      },
      request.id,
    );
  });
}
