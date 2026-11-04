import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { response } from '../../common/response';
import { DomainError } from '../../repositories/repository';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { authenticatedUsers } from './context';
/** 对项目用户密码加盐派生。
 * @param password 用户提供的密码。
 * @param salt 可选现有盐，用于密码验证。
 * @returns 盐与派生结果组成的不可逆存储串。
 */
export function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
/** 对会话令牌做不可逆摘要，数据库不保存明文令牌。
 * @param token 客户端会话令牌。
 * @returns SHA-256 摘要字符串。
 */
function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
/** 注册统一登录、会话查询与用户创建。
 * @param app HTTP 应用适配器。
 * @param pool PostgreSQL 业务数据库。
 * @param bootstrapPassword 可选首次管理员密码。
 * @returns 完成认证路由注册的 Promise。
 */
export async function registerAuthBase(
  app: FastifyInstance,
  pool: Pool,
  bootstrapPassword?: string,
) {
  const existing = await pool.query("SELECT id FROM users WHERE username='admin'");
  if (!existing.rowCount) {
    const password = bootstrapPassword ?? randomBytes(18).toString('base64url');
    await pool.query('INSERT INTO users VALUES($1,$2,$3,$4) ON CONFLICT(username) DO NOTHING', [
      'admin',
      'admin',
      passwordHash(password),
      'admin',
    ]);
    if (!bootstrapPassword) {
      mkdirSync('data', { recursive: true });
      writeFileSync('data/bootstrap-admin.txt', `username=admin\npassword=${password}\n`, {
        mode: 0o600,
      });
      app.log.info('首次管理员凭据已写入 data/bootstrap-admin.txt（仅本地可读）');
    }
  }
  const users = authenticatedUsers;
  const attempts = new Map<string, { count: number; until: number }>();
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/v1/model-upload/')) return;
    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (bearer) {
      const found = await pool.query(
        'SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2',
        [tokenHash(bearer), Date.now()],
      );
      if (found.rowCount) users.set(request, found.rows[0]);
    }
    if (
      request.url.startsWith('/api/v1/') &&
      !['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/health'].some(
        (path) => request.url.split('?')[0] === path,
      ) &&
      !users.get(request)
    )
      throw new DomainError(401, 'UNAUTHORIZED', '请先登录');
    if (
      request.url.startsWith('/api/v1/') &&
      !request.url.startsWith('/api/v1/auth/login') &&
      !request.url.startsWith('/api/v1/auth/refresh') &&
      !request.url.startsWith('/api/v1/health')
    ) {
      const user = users.get(request);
      if (!user) throw new DomainError(401, 'UNAUTHORIZED', '请先登录业务管理平台');
      const route = request.url;
      const domain = route.includes('/protection')
        ? 'protection'
        : route.includes('/work-orders')
          ? 'workorders'
          : route.includes('/alarm')
            ? 'alarms'
            : route.includes('/scene') || route.includes('/model') || route.includes('/camera')
              ? 'scenes'
              : route.includes('/topology')
                ? 'topology'
                : 'assets';
      const permissions =
        ((await pool.query('SELECT permissions FROM roles WHERE id=$1', [user.role])).rows[0]
          ?.permissions as string[]) ?? [];
      if (
        !route.includes('/auth/') &&
        !permissions.some((permission) => ['*', `${domain}.manage`, ...(['GET','HEAD','OPTIONS'].includes(request.method) ? ['*.read',`${domain}.read`] : [])].includes(permission))
      )
        throw new DomainError(403, 'FORBIDDEN', '当前角色没有此业务操作权限');
      if (
        (/\/(users|roles)(\/|$)/.test(route) ||
          ((!['GET','HEAD'].includes(request.method)) && (route.includes('/simulation') || route.includes('/alarm-rules')))) &&
        user.role !== 'admin'
      )
        throw new DomainError(403, 'FORBIDDEN', '需要管理员权限');
    }
  });
  app.post('/api/v1/auth/login', async (request) => {
    const body = z
      .strictObject({ username: z.string().min(1).max(80), password: z.string().min(1).max(256) })
      .parse(request.body);
    const state = attempts.get(request.ip);
    if (state && state.until > Date.now() && state.count >= 10)
      throw new DomainError(429, 'TOO_MANY_ATTEMPTS', '登录尝试过多，请稍后重试');
    const row = (await pool.query('SELECT * FROM users WHERE username=$1', [body.username]))
      .rows[0];
    const saved = String(row?.password_hash ?? passwordHash('unknown'));
    const derived = passwordHash(body.password, saved.split(':')[0]);
    if (!row || !timingSafeEqual(Buffer.from(saved), Buffer.from(derived))) {
      const prior = state && state.until > Date.now() ? state.count : 0;
      attempts.set(request.ip, { count: prior + 1, until: Date.now() + 60000 });
      throw new DomainError(401, 'INVALID_CREDENTIALS', '用户名或密码不正确');
    }
    attempts.delete(request.ip);
    const token = randomBytes(32).toString('base64url');
    await pool.query('DELETE FROM sessions WHERE expires_at<$1', [Date.now()]);
    await pool.query('INSERT INTO sessions VALUES($1,$2,$3)', [
      tokenHash(token),
      row.id,
      Date.now() + 8 * 3600000,
    ]);
    return response(
      { token, user: { id: row.id, username: row.username, role: row.role } },
      request.id,
    );
  });
  app.get('/api/v1/auth/me', async (request) => {
    const user = users.get(request);
    if (!user) throw new DomainError(401, 'UNAUTHORIZED', '登录已过期');
    return response(user, request.id);
  });
  app.post('/api/v1/auth/logout', async (request) => {
    const token = request.headers.authorization?.slice(7);
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
    return response({ loggedOut: true }, request.id);
  });
}
