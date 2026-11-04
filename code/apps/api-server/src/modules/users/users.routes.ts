import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { passwordHash } from '../auth/base.routes';
import { authenticatedUsers } from '../auth/context';
import { idSchema } from '../../common/schemas';
import { response } from '../../common/response';
import { DomainError } from '../../repositories/repository';
/** 注册用户创建、角色分配与区域授权。
 * @param app HTTP 应用。
 * @param pool 业务数据库。
 * @returns 无返回值，注册用户领域路由。
 */
export function registerUserRoutes(app: FastifyInstance, pool: Pool) {
  const users = authenticatedUsers;
  app.get('/api/v1/users', async (request) => {
    if (users.get(request)?.role !== 'admin')
      throw new DomainError(403, 'FORBIDDEN', '需要管理员权限');
    return response(
      (
        await pool.query(
          `SELECT u.id,u.username,u.role,COALESCE((SELECT json_agg(s.region_id) FROM user_scopes s WHERE s.user_id=u.id),'[]') AS "regionIds" FROM users u ORDER BY username`,
        )
      ).rows,
      request.id,
    );
  });
  app.post('/api/v1/users', async (request, reply) => {
    const user = z
      .strictObject({
        username: idSchema,
        password: z.string().min(12).max(256),
        role: z.enum(['admin', 'protection_manager', 'supervisor', 'operator', 'viewer']),
      })
      .parse(request.body);
    if ((await pool.query('SELECT id FROM users WHERE username=$1', [user.username])).rowCount)
      throw new DomainError(409, 'CONFLICT', '用户名已存在');
    const id = randomUUID();
    await pool.query('INSERT INTO users VALUES($1,$2,$3,$4)', [
      id,
      user.username,
      passwordHash(user.password),
      user.role,
    ]);
    return reply
      .code(201)
      .send(response({ id, username: user.username, role: user.role }, request.id));
  });
  app.patch('/api/v1/users/:id', async (request) => {
    if (authenticatedUsers.get(request)?.role !== 'admin')
      throw new DomainError(403, 'FORBIDDEN', '需要管理员权限');
    const id = (request.params as { id: string }).id;
    const { role, regionIds } = z
      .strictObject({
        role: z.enum(['admin', 'protection_manager', 'supervisor', 'operator', 'viewer']),
        regionIds: z.array(z.string()).default([]),
      })
      .parse(request.body);
    if (id === 'admin' && role !== 'admin')
      throw new DomainError(409, 'BUILTIN_ADMIN', '不能降级初始化管理员');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        'UPDATE users SET role=$1 WHERE id=$2 RETURNING id,username,role',
        [role, id],
      );
      if (!updated.rowCount) throw new DomainError(404, 'NOT_FOUND', '用户不存在');
      await client.query('DELETE FROM user_scopes WHERE user_id=$1', [id]);
      for (const regionId of [...new Set(regionIds)])
        await client.query('INSERT INTO user_scopes VALUES($1,$2)', [id, regionId]);
      await client.query('COMMIT');
      return response(updated.rows[0], request.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
