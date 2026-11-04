import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { DomainError } from '../../repositories/repository';
import { response } from '../../common/response';
/** 注册告警详情与恢复后的人工关闭。
 * @param app HTTP 应用。
 * @param pool 业务数据库连接池。
 * @returns 无返回值，注册告警领域接口。
 */
export function registerAlarmRoutes(app: FastifyInstance, pool: Pool) {
  app.get('/api/v1/alarms/:id', async (request) => {
    const alarm = (
      await pool.query(
        'SELECT document,status,acknowledged_at,closed_at,note,rule_id,point_id FROM alarms WHERE id=$1',
        [(request.params as { id: string }).id],
      )
    ).rows[0];
    if (!alarm) throw new DomainError(404, 'NOT_FOUND', '告警不存在');
    return response(
      {
        ...alarm.document,
        status: alarm.closed_at ? 'closed' : alarm.status,
        acknowledgedAt: alarm.acknowledged_at,
        ruleId: alarm.rule_id,
        pointId: alarm.point_id,
        note: alarm.note,
      },
      request.id,
    );
  });
  app.post('/api/v1/alarms/:id/close', async (request) => {
    const id = (request.params as { id: string }).id;
    const alarm = (await pool.query('SELECT status FROM alarms WHERE id=$1', [id])).rows[0];
    if (!alarm) throw new DomainError(404, 'NOT_FOUND', '告警不存在');
    if (alarm.status === 'active')
      throw new DomainError(409, 'ALARM_ACTIVE', '设备尚未恢复，不能关闭告警');
    await pool.query('UPDATE alarms SET closed_at=COALESCE(closed_at,$1) WHERE id=$2', [
      Date.now(),
      id,
    ]);
    return response({ id, status: 'closed' }, request.id);
  });
}
