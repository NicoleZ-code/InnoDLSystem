import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { userInfo } from 'node:os';
import { z } from 'zod';
import { idSchema } from '../../common/schemas';
import { response } from '../../common/response';
import { DomainError } from '../../repositories/repository';
const pointSchema = z.strictObject({
  id: idSchema,
  assetId: idSchema,
  name: z.string().trim().min(1).max(100),
  metric: z.enum(['voltage', 'current', 'temperature', 'load']),
  unit: z.string().min(1).max(20),
  enabled: z.boolean().default(true),
  quality: z.string().max(30).default('simulated'),
});
const ruleSchema = z.strictObject({
  id: idSchema,
  pointId: idSchema,
  name: z.string().trim().min(1).max(100),
  operator: z.enum(['gt', 'lt']),
  threshold: z.number(),
  severity: z.enum(['attention', 'alarm']),
  enabled: z.boolean().default(true),
});
/** 注册 Prisma 驱动的测点与规则维护以及 PostgreSQL 分区历史查询。
 * @param app HTTP 应用。
 * @param pool 共享业务数据库连接池。
 * @param url Prisma 数据库连接串。
 * @param schema 测试或业务 schema。
 * @returns 完成路由注册的 Promise。
 */
export async function registerTelemetryRoutes(
  app: FastifyInstance,
  pool: Pool,
  url: string,
  schema = 'public',
) {
  const connection = new URL(url);
  if (!connection.username) connection.username = userInfo().username;
  url = connection.toString();
  const orm = new PrismaClient({
    datasources: { db: { url: `${url}${url.includes('?') ? '&' : '?'}schema=${schema}` } },
  });
  await orm.$connect();
  app.addHook('onClose', async () => orm.$disconnect());
  app.get('/api/v1/measurement-points', async (request) =>
    response(await orm.measurementPoint.findMany({ orderBy: { id: 'asc' } }), request.id),
  );
  app.post('/api/v1/measurement-points', async (request, reply) => {
    const point = pointSchema.parse(request.body);
    if (!(await pool.query('SELECT id FROM assets WHERE id=$1', [point.assetId])).rowCount)
      throw new DomainError(422, 'INVALID_ASSET', '测点必须关联已有资产');
    const result = await orm.measurementPoint.create({ data: point });
    await pool.query(
      'INSERT INTO audit_log(action,entity_id,timestamp,details) VALUES($1,$2,$3,$4)',
      ['measurement.created', point.id, Date.now(), point.name],
    );
    return reply.code(201).send(response(result, request.id));
  });
  app.put('/api/v1/measurement-points/:id', async (request) => {
    const point = pointSchema.parse(request.body);
    if ((request.params as { id: string }).id !== point.id)
      throw new DomainError(400, 'ID_MISMATCH', '测点 ID 不一致');
    if (!(await pool.query('SELECT id FROM assets WHERE id=$1', [point.assetId])).rowCount)
      throw new DomainError(422, 'INVALID_ASSET', '关联资产不存在');
    return response(
      await orm.measurementPoint.update({ where: { id: point.id }, data: point }),
      request.id,
    );
  });
  app.get('/api/v1/alarm-rules', async (request) =>
    response(await orm.alarmRule.findMany({ orderBy: { id: 'asc' } }), request.id),
  );
  app.post('/api/v1/alarm-rules', async (request, reply) => {
    const rule = ruleSchema.parse(request.body);
    if (!(await orm.measurementPoint.findUnique({ where: { id: rule.pointId } })))
      throw new DomainError(422, 'INVALID_POINT', '测点不存在');
    return reply.code(201).send(response(await orm.alarmRule.create({ data: rule }), request.id));
  });
  app.put('/api/v1/alarm-rules/:id', async (request) => {
    const rule = ruleSchema.parse(request.body);
    if ((request.params as { id: string }).id !== rule.id)
      throw new DomainError(400, 'ID_MISMATCH', '规则 ID 不一致');
    return response(await orm.alarmRule.update({ where: { id: rule.id }, data: rule }), request.id);
  });
  app.get('/api/v1/telemetry/latest', async (request) => {
    const query = z.object({ assetId: idSchema.optional() }).parse(request.query);
    return response(
      (
        await pool.query(
          'SELECT point_id AS "pointId",asset_id AS "assetId",metric,value,unit,quality,timestamp::double precision FROM telemetry_latest WHERE ($1::text IS NULL OR asset_id=$1) ORDER BY point_id',
          [query.assetId ?? null],
        )
      ).rows,
      request.id,
    );
  });
  app.get('/api/v1/measurement-history', async (request) => {
    const query = z
      .object({ pointId: idSchema, limit: z.coerce.number().int().min(1).max(3600).default(180) })
      .parse(request.query);
    return response(
      (
        await pool.query(
          'SELECT ts,value,quality FROM (SELECT ts,value,quality FROM telemetry_history WHERE point_id=$1 ORDER BY ts DESC LIMIT $2) h ORDER BY ts',
          [query.pointId, query.limit],
        )
      ).rows,
      request.id,
    );
  });
  app.get('/api/v1/assets/:id/measurements', async (request) =>
    response(
      await orm.measurementPoint.findMany({
        where: { assetId: (request.params as { id: string }).id },
      }),
      request.id,
    ),
  );
}
