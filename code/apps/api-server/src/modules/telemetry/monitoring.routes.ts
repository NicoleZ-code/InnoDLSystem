import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DomainError, type Repository } from '../../repositories/repository';
import type { createSimulation } from './simulation.service';
import { response } from '../../common/response';
import {
  historySchema,
  filterSchema,
  idSchema,
  tickSchema,
  controlSchema,
} from '../../common/schemas';
/** 注册遥测、历史、告警处理、审计和模拟控制路由。
 * @param app Fastify 应用实例。
 * @param repository 持久化数据仓储。
 * @param simulation 唯一权威模拟时钟服务。
 * @returns 无返回值，向应用注册监测业务路由。
 */
export function registerMonitoringRoutes(
  app: FastifyInstance,
  repository: Repository,
  simulation: ReturnType<typeof createSimulation>,
) {
  app.get('/api/v1/telemetry/summary', async (request) =>
    response(await repository.latest(), request.id),
  );
  app.get('/api/v1/telemetry/replay', async (request) => {
    const { tick } = z.object({ tick: tickSchema }).parse(request.query);
    return response(await simulation.replay(tick), request.id);
  });
  app.get('/api/v1/telemetry/history', async (request) => {
    const query = historySchema.parse(request.query);
    if (query.assetId && !(await repository.assets()).some((asset) => asset.id === query.assetId))
      throw new DomainError(404, 'NOT_FOUND', '未找到资产');
    return response(
      await repository.history(query.fromTick, query.toTick, query.limit),
      request.id,
    );
  });
  app.get('/api/v1/alarms', async (request) => {
    const query = z
      .object({
        status: z.enum(['active', 'resolved']).optional(),
        regionId: filterSchema.shape.regionId,
      })
      .parse(request.query);
    const ids = new Set((await repository.assets(query)).map((asset) => asset.id));
    return response(
      (await repository.alarms(query.status)).filter((alarm) => ids.has(alarm.assetId)),
      request.id,
    );
  });
  app.post('/api/v1/alarms/:id/acknowledge', async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const { note } = z
      .strictObject({ note: z.string().trim().min(1).max(500) })
      .parse(request.body);
    return response(await repository.acknowledge(id, note), request.id);
  });
  app.get('/api/v1/audit', async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(50) })
      .parse(request.query);
    return response(await repository.audit(limit), request.id);
  });
  app.get('/api/v1/simulation', async (request) =>
    response(
      { simulation: await repository.simulation(), telemetry: await repository.latest() },
      request.id,
    ),
  );
  app.patch('/api/v1/simulation', async (request) =>
    response(await simulation.control(controlSchema.parse(request.body)), request.id),
  );
}
