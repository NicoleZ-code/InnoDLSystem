import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { authenticatedUsers } from './context';
import { DomainError } from '../../repositories/repository';
/** 查询账户区域范围，空集合配置表示全域授权。
 * @param pool 数据库连接池。
 * @param userId 已认证账户 ID。
 * @returns 受限账户可访问的资产 ID 集合；全域账户返回 null。
 */
export async function allowedAssets(pool: Pool, userId: string): Promise<Set<string> | null> {
  const scopes = (await pool.query('SELECT region_id FROM user_scopes WHERE user_id=$1', [userId]))
    .rows;
  if (!scopes.length) return null;
  const result = await pool.query(
    `WITH RECURSIVE scope(id) AS (SELECT region_id FROM user_scopes WHERE user_id=$1 UNION SELECT r.id FROM regions r JOIN scope s ON r.parent_id=s.id) SELECT id FROM assets WHERE region IN (SELECT id FROM scope)`,
    [userId],
  );
  return new Set(result.rows.map((row) => row.id));
}
/** 统一执行区域数据鉴权，列表裁剪和详情/写入检查共用同一范围。
 * @param app HTTP 应用。
 * @param pool 业务数据库。
 * @returns 无返回值，注册请求与响应策略。
 */
export function registerScopePolicy(app: FastifyInstance, pool: Pool) {
  const contexts = new WeakMap<object, Set<string>>();
  app.addHook('preHandler', async (request) => {
    const user = authenticatedUsers.get(request);
    if (!user || user.role === 'admin') return;
    const route = request.url.split('?')[0];
    if (/\/(users|roles|audit)(\/|$)/.test(route))
      throw new DomainError(403, 'FORBIDDEN', '仅管理员可访问系统管理数据');
    if (user.role === 'operator' && request.method === 'POST' && /\/work-orders$/.test(route)) throw new DomainError(403,'FORBIDDEN','运维人员由主管分派任务，不能创建工单');
    const allowed = await allowedAssets(pool, user.id);
    if (!allowed) return;
    contexts.set(request, allowed);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const query = request.query as Record<string, unknown>;
    const ids = [
      body.assetId,
      body.fromId,
      body.toId,
      query.assetId,
      ...(Array.isArray(body.assetIds) ? body.assetIds : []),
    ].filter((id): id is string => typeof id === 'string');
    if (typeof query.pointId === 'string') {const point = (await pool.query('SELECT asset_id FROM measurement_points WHERE id=$1',[query.pointId])).rows[0];if(point)ids.push(point.asset_id);}
    const id = (request.params as { id?: string }).id;
    if (id) {
      if (/\/assets\//.test(route)) ids.push(id);
      const table = /\/work-orders\//.test(route)
        ? 'work_orders'
        : /\/alarms\//.test(route)
          ? 'alarms'
          : /\/measurement-points\//.test(route)
            ? 'measurement_points'
            : null;
      if (table) {
        const record = (await pool.query(`SELECT asset_id FROM ${table} WHERE id=$1`, [id]))
          .rows[0];
        if (record) ids.push(record.asset_id);
      }
    }
    if (ids.some((id) => !allowed.has(id)))
      throw new DomainError(403, 'OUT_OF_SCOPE', '资源超出当前账户的保障区域');
    if (/\/(topology|reports|platform|areas|scene|camera|protection)/.test(route))
      throw new DomainError(403, 'OUT_OF_SCOPE', '此全域管理功能需要全域数据授权');
  });
  app.addHook('preSerialization', async (request, _reply, payload) => {
    const allowed = contexts.get(request);
    if (!payload || typeof payload !== 'object') return payload;
    const envelope = payload as { data: unknown };
    const route = request.url;
    const user = authenticatedUsers.get(request);
    if (user?.role === 'operator' && route.includes('/work-orders')) {
      if (Array.isArray(envelope.data)) envelope.data = envelope.data.filter((order) => [user.id,user.username].includes(order.assignee));
      else if (envelope.data && typeof envelope.data === 'object' && 'assignee' in envelope.data && ![user.id,user.username].includes(String(envelope.data.assignee))) throw new DomainError(403,'FORBIDDEN','仅可查看指派给自己的工单');
    }
    if (!allowed) return envelope;
    /** 按数据结构裁剪列表与完整快照。
     * @param data 待序列化的业务数据。
     * @returns 仅含授权资产的业务数据。
     */
    function restrict(data: unknown): unknown {
      if (Array.isArray(data))
        return data
          .filter((row) => {
            if (row && typeof row === 'object') {
              if (row.properties?.assetId) return allowed!.has(row.properties.assetId);
              if (row.assetId || row.asset_id) return allowed!.has(row.assetId ?? row.asset_id);
              if (row.fromId || row.toId) return allowed!.has(row.fromId) && allowed!.has(row.toId);
              if (row.position || /\/assets(\?|$)/.test(route)) return allowed!.has(row.id);
            }
            return true;
          })
          .map(restrict);
      if (data && typeof data === 'object')
        return Object.fromEntries(
          Object.entries(data).map(([key, value]) => [
            key,
            ['assets', 'lines', 'alarms', 'telemetry', 'features'].includes(key)
              ? restrict(value)
              : value,
          ]),
        );
      return data;
    }
    envelope.data = restrict(envelope.data);
    return envelope;
  });
}
