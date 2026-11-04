import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { response } from '../../common/response';
import { DomainError } from '../../repositories/repository';
import { authenticatedUsers } from './context';
/** 对不透明会话令牌计算数据库摘要。
 * @param value 会话随机令牌。
 * @returns SHA-256 摘要。
 */
function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
/** 读取并限制刷新令牌 Cookie。
 * @param cookie 原始 Cookie 请求头。
 * @returns 刷新令牌字符串或空字符串。
 */
function refreshCookie(cookie: string | undefined) {
  return (
    cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('innodl-refresh='))
      ?.slice(15) ?? ''
  );
}
/** 注册短期 Access Token、轮换 Refresh Cookie 与角色权限。
 * @param app HTTP 应用。
 * @param pool PostgreSQL 会话存储。
 * @returns 无返回值，注册认证扩展。
 */
export function registerAuthExtensions(app: FastifyInstance, pool: Pool) {
  const cookieSuffix = `Path=/api/v1/auth; HttpOnly; SameSite=Lax${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
  app.addHook('onSend', async (request, reply, payload) => {
    if (
      request.url.startsWith('/api/v1/auth/login') &&
      reply.statusCode === 200 &&
      typeof payload === 'string'
    ) {
      const envelope = JSON.parse(payload);
      if (envelope.data?.token) {
        const token = randomBytes(32).toString('base64url');
        await pool.query('UPDATE sessions SET expires_at=$1 WHERE token_hash=$2', [
          Date.now() + 15 * 60000,
          digest(envelope.data.token),
        ]);
        await pool.query('INSERT INTO refresh_sessions VALUES($1,$2,$3)', [
          digest(token),
          envelope.data.user.id,
          Date.now() + 7 * 86400000,
        ]);
        reply.header('Set-Cookie', `innodl-refresh=${token}; Max-Age=604800; ${cookieSuffix}`);
      }
    }
    if (request.url.startsWith('/api/v1/auth/logout') && reply.statusCode === 200) {
      const token = refreshCookie(request.headers.cookie);
      if (token)
        await pool.query('DELETE FROM refresh_sessions WHERE token_hash=$1', [digest(token)]);
      reply.header('Set-Cookie', `innodl-refresh=; Max-Age=0; ${cookieSuffix}`);
    }
    return payload;
  });
  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const token = refreshCookie(request.headers.cookie);
    if (!token) throw new DomainError(401, 'UNAUTHORIZED', '请先登录');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = (
        await client.query(
          'DELETE FROM refresh_sessions WHERE token_hash=$1 AND expires_at>$2 RETURNING user_id',
          [digest(token), Date.now()],
        )
      ).rows[0];
      if (!found) throw new DomainError(401, 'SESSION_EXPIRED', '登录已过期');
      const user = (
        await client.query('SELECT id,username,role FROM users WHERE id=$1', [found.user_id])
      ).rows[0];
      const access = randomBytes(32).toString('base64url');
      const refresh = randomBytes(32).toString('base64url');
      await client.query('INSERT INTO sessions VALUES($1,$2,$3)', [
        digest(access),
        user.id,
        Date.now() + 15 * 60000,
      ]);
      await client.query('INSERT INTO refresh_sessions VALUES($1,$2,$3)', [
        digest(refresh),
        user.id,
        Date.now() + 7 * 86400000,
      ]);
      await client.query('COMMIT');
      reply.header('Set-Cookie', `innodl-refresh=${refresh}; Max-Age=604800; ${cookieSuffix}`);
      return response({ token: access, user }, request.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  app.get('/api/v1/roles', async (request) =>
    response((await pool.query('SELECT * FROM roles ORDER BY id')).rows, request.id),
  );
  app.put('/api/v1/roles/:id/permissions', async (request) => {
    if (authenticatedUsers.get(request)?.role !== 'admin')
      throw new DomainError(403, 'FORBIDDEN', '需要管理员权限');
    const id = (request.params as { id: string }).id;
    const { permissions } = z
      .strictObject({ permissions: z.array(z.string().max(80)).max(100) })
      .parse(request.body);
    if (id === 'admin' && !permissions.includes('*'))
      throw new DomainError(409, 'ADMIN_PERMISSION_REQUIRED', '管理员必须保留完整权限');
    const result = await pool.query('UPDATE roles SET permissions=$1 WHERE id=$2 RETURNING *', [
      JSON.stringify(permissions),
      id,
    ]);
    if (!result.rowCount) throw new DomainError(404, 'NOT_FOUND', '角色不存在');
    return response(result.rows[0], request.id);
  });
}
