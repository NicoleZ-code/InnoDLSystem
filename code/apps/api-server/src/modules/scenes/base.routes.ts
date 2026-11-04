import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { response } from '../../common/response';
import { idSchema } from '../../common/schemas';
import { DomainError } from '../../repositories/repository';
import { createMutation } from '../../repositories/unit-of-work';
import type { Repository } from '../../repositories/repository';
/** 注册场景配置维护。
 * @param app HTTP 应用适配器。
 * @param pool PostgreSQL 业务数据库。
 * @param repository 统一业务仓储。
 * @returns 无返回值，向模块注册领域路由。
 */
export function registerSceneBase(app: FastifyInstance, pool: Pool, repository: Repository) {
  const mutate = createMutation(pool);
  app.get('/api/v1/scene-configurations', async (request) =>
    response((await pool.query('SELECT * FROM scenes ORDER BY id')).rows, request.id),
  );
  app.put('/api/v1/scene-configurations/:id', async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const body = z
      .strictObject({
        name: z.string().min(1).max(100),
        configuration: z.strictObject({
          camera: z.strictObject({ targetAssetId: idSchema, duration: z.number().min(0).max(30) }),
          layers: z.strictObject({
            buildings: z.boolean(),
            labels: z.boolean(),
            boundary: z.boolean(),
          }),
          models: z.strictObject({
            venue: z.string().startsWith('/models/').max(300),
            equipment: z.string().startsWith('/models/').max(300),
          }),
        }),
      })
      .parse(request.body);
    if (!(await repository.assets()).some((a) => a.id === body.configuration.camera.targetAssetId))
      throw new DomainError(422, 'INVALID_ASSET', '相机锚点资产不存在');
    return response(
      await mutate('scene.updated', id, async (c) => {
        const result = await c.query(
          'UPDATE scenes SET name=$1,configuration=$2,revision=revision+1 WHERE id=$3 RETURNING *',
          [body.name, body.configuration, id],
        );
        if (!result.rowCount) throw new DomainError(404, 'NOT_FOUND', '场景不存在');
        return result.rows[0];
      }),
      request.id,
    );
  });
}
