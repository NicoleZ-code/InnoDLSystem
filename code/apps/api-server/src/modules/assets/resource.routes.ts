import type { FastifyInstance } from 'fastify';
import { DomainError, type Repository } from '../../repositories/repository';
import { response } from '../../common/response';
import { assetSchema, lineSchema, filterSchema, idSchema } from '../../common/schemas';
/** 注册场景、资产和线路路由。
 * @param app Fastify 应用实例。
 * @param repository 可替换的持久化仓储。
 * @param publishCatalog 目录提交后的实时发布回调。
 * @returns 无返回值，向应用注册资源路由。
 */
export function registerResourceRoutes(
  app: FastifyInstance,
  repository: Repository,
  publishCatalog: () => Promise<void>,
) {
  app.get('/api/v1/regions', async (request) =>
    response((await repository.catalog()).regions, request.id),
  );
  app.get('/api/v1/catalog/:sceneId', async (request) => {
    const { sceneId } = request.params as { sceneId: string };
    if (!['shanghai', 'city', 'grid', 'venue', 'equipment'].includes(sceneId))
      throw new DomainError(404, 'NOT_FOUND', '未找到该场景');
    return response(await repository.catalog(), request.id);
  });
  app.get('/api/v1/assets', async (request) =>
    response(await repository.assets(filterSchema.parse(request.query)), request.id),
  );
  app.get('/api/v1/assets/:id', async (request) => {
    const { id } = request.params as { id: string };
    const asset = (await repository.assets()).find((item) => item.id === id);
    if (!asset) throw new DomainError(404, 'NOT_FOUND', '未找到资产');
    return response(asset, request.id);
  });
  app.post('/api/v1/assets', async (request, reply) => {
    const asset = assetSchema.parse(request.body);
    await repository.saveAsset(asset, true);
    await publishCatalog();
    return reply.code(201).send(response(asset, request.id));
  });
  app.put('/api/v1/assets/:id', async (request) => {
    const asset = assetSchema.parse(request.body);
    if ((request.params as { id: string }).id !== asset.id)
      throw new DomainError(400, 'ID_MISMATCH', '路径与请求体的 ID 不一致');
    await repository.saveAsset(asset, false);
    await publishCatalog();
    return response(asset, request.id);
  });
  app.delete('/api/v1/assets/:id', async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    await repository.deleteAsset(id);
    await publishCatalog();
    return response({ deleted: id }, request.id);
  });
  app.get('/api/v1/power-lines', async (request) => {
    const filter = filterSchema.parse(request.query);
    const ids = new Set((await repository.assets(filter)).map((asset) => asset.id));
    return response(
      (await repository.catalog()).lines.filter(
        (line) =>
          ids.has(line.fromId) &&
          ids.has(line.toId) &&
          (!filter.voltageKv || line.voltage === filter.voltageKv),
      ),
      request.id,
    );
  });
  app.post('/api/v1/power-lines', async (request, reply) => {
    const line = lineSchema.parse(request.body);
    await repository.saveLine(line, true);
    await publishCatalog();
    return reply.code(201).send(response(line, request.id));
  });
  app.put('/api/v1/power-lines/:id', async (request) => {
    const line = lineSchema.parse(request.body);
    if ((request.params as { id: string }).id !== line.id)
      throw new DomainError(400, 'ID_MISMATCH', '路径与请求体的 ID 不一致');
    await repository.saveLine(line, false);
    await publishCatalog();
    return response(line, request.id);
  });
  app.delete('/api/v1/power-lines/:id', async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    await repository.deleteLine(id);
    await publishCatalog();
    return response({ deleted: id }, request.id);
  });
}
