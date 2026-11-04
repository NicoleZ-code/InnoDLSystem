import { registerUserRoutes } from './modules/users/users.routes';
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  AssetsModule,
  TopologyModule,
  TelemetryModule,
  AuthModule,
  UsersModule,
  AlarmsModule,
  ProtectionModule,
  ScenesModule,
  WorkOrdersModule,
  featureModule,
} from './modules';
import { openPostgres } from './infrastructure/database/postgres';
import { createCache } from './infrastructure/cache';
import { createHash } from 'node:crypto';
import { createMeasurements } from './modules/telemetry/measurement.service';
import { allowedAssets, registerScopePolicy } from './modules/auth/scope';
import { registerAuthBase } from './modules/auth/base.routes';
import { registerAuthExtensions } from './modules/auth/auth.routes';
import { registerAssetRoutes } from './modules/assets/assets.routes';
import { registerTopologyRoutes } from './modules/topology/topology.routes';
import { registerAlarmRoutes } from './modules/alarms/alarms.routes';
import { registerTelemetryRoutes } from './modules/telemetry/telemetry.routes';
import { registerProtectionBase } from './modules/protection/base.routes';
import { registerProtectionRoutes } from './modules/protection/protection.routes';
import { registerOrderBase } from './modules/work-orders/base.routes';
import { registerFlowRoutes } from './modules/work-orders/flow.routes';
import { registerSceneBase } from './modules/scenes/base.routes';
import { registerSceneRoutes } from './modules/scenes/scenes.routes';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { ApiExceptionFilter } from './common/errors';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SceneEvent, ServerEvent } from '@innodl/power-types';
import { openDatabase } from './infrastructure/database/sqlite-test';
import { createRepository } from './repositories/repository';
import { createSimulation } from './modules/telemetry/simulation.service';
import { registerResourceRoutes } from './modules/assets/resource.routes';
import { registerMonitoringRoutes } from './modules/telemetry/monitoring.routes';
export interface AppOptions {
  databaseFile?: string;
  databaseUrl?: string;
  schema?: string;
  bootstrapPassword?: string;
  redisUrl?: string;
  intervalMs?: number;
  logger?: boolean;
  serveWeb?: boolean;
}
/** 构建可注入测试的后端，不在工厂中绑定端口。
 * @param options 数据库、模拟周期、日志及静态托管选项。
 * @param options.databaseFile 可选 SQLite 隔离测试适配器。
 * @param options.databaseUrl PostgreSQL 连接串。
 * @param options.schema 可选集成测试隔离 schema。
 * @param options.bootstrapPassword 可选初始管理员密码。
 * @param options.redisUrl 可选 Redis 最新值与事件缓存地址。
 * @param options.intervalMs 模拟间隔毫秒，0 表示由测试手动推进。
 * @param options.logger 是否启用 HTTP 日志。
 * @param options.serveWeb 是否托管已构建的前端。
 * @returns Fastify、仓储与模拟服务，调用 app.close 可完整释放资源。
 */
export async function buildApp(options: AppOptions) {
  const adapter = new FastifyAdapter({
    logger: options.logger ?? false,
    bodyLimit: 65536,
    rewriteUrl: (request: { url?: string }) => {
      const url = request.url ?? '/';
      return url.startsWith('/api/v1/') ? url : url.replace(/^\/api\//, '/api/v1/');
    },
  });
  const app = adapter.getInstance();
  const pg = options.databaseFile
    ? undefined
    : await openPostgres(
        options.databaseUrl ?? 'postgresql://localhost:5432/innodl_system',
        options.schema,
      );
  const db = options.databaseFile ? openDatabase(options.databaseFile) : undefined;
  const repository = pg?.repository ?? createRepository(db!);
  const cache = await createCache(options.redisUrl);
  const clients = new Set<WebSocket>();
  const socketScopes = new WeakMap<WebSocket, Set<string>>();
  const subscriptions = new WeakMap<WebSocket, Set<string>>();
  /** 广播已提交的数据事件，慢客户端主动断开以控制内存。
   * @param event 符合共享协议的目录或遥测事件。
   * @returns 无返回值，推送给当前在线客户端。
   */
  function broadcast(event: ServerEvent) {
    for (const client of clients) {
      const scope = socketScopes.get(client);
      const subscribed = subscriptions.get(client);
      const allowed = scope
        ? new Set([...scope].filter((id) => !subscribed?.size || subscribed.has(id)))
        : subscribed;
      let outgoing: ServerEvent = event;
      if (
        event.type === 'domain' &&
        event.event === 'telemetry.batch' &&
        !!allowed &&
        Array.isArray(event.data)
      )
        outgoing = {
          ...event,
          data: event.data.filter((point: { assetId: string }) => allowed.has(point.assetId)),
        };
      if (scope) {
        if (outgoing.type === 'telemetry')
          outgoing = {
            ...outgoing,
            data: {
              ...outgoing.data,
              alarms: outgoing.data.alarms.filter((alarm) => scope.has(alarm.assetId)),
            },
          };
        if (outgoing.type === 'catalog')
          outgoing = {
            ...outgoing,
            data: {
              ...outgoing.data,
              assets: outgoing.data.assets.filter((asset) => scope.has(asset.id)),
              lines: outgoing.data.lines.filter(
                (line) => scope.has(line.fromId) && scope.has(line.toId),
              ),
              modelBindings: outgoing.data.modelBindings?.filter((binding) =>
                scope.has(binding.assetId),
              ),
            },
          };
        if (
          outgoing.type === 'domain' &&
          outgoing.event.startsWith('alarm.') &&
          !scope.has((outgoing.data as { assetId: string }).assetId)
        )
          continue;
      }
      const payload = JSON.stringify(outgoing);
      if (client.bufferedAmount > 1024 * 1024) {
        client.close(1013, '客户端读取过慢');
        continue;
      }
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
  let sequence = 0;
  const measurements = pg
    ? createMeasurements(pg.pool, (event, data) => {
        broadcast({ type: 'domain', event, seq: ++sequence, timestamp: Date.now(), data });
        void cache?.publish(event, data).catch((error) => app.log.error(error));
      })
    : undefined;
  const simulation = createSimulation(
    repository,
    (data, state) => broadcast({ type: 'telemetry', data, simulation: state, isDemoData: true }),
    measurements ? (snapshot) => measurements.sample(snapshot) : undefined,
  );
  await app.register(swagger, {
    openapi: {
      info: { title: '全景智慧电力保障平台 API', version: '1.0.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api-docs' });
  await app.register(websocket, { options: { maxPayload: 4096 } });
  app.addHook('preValidation', async (request) => {
    if (request.url.startsWith('/api/v1/'))
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(500).optional(),
      }).parse(request.query);
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    if (
      typeof payload === 'string' &&
      request.url.startsWith('/api/v1/') &&
      reply.statusCode < 400
    ) {
      const envelope = JSON.parse(payload);
      if (Array.isArray(envelope.data)) {
        const query = request.query as { page?: string; pageSize?: string; q?: string };
        const page = Number(query.page ?? 1);
        const pageSize = Number(query.pageSize ?? 50);
        const items = query.q
          ? envelope.data.filter((item: unknown) =>
              JSON.stringify(item).toLowerCase().includes(query.q!.toLowerCase()),
            )
          : envelope.data;
        envelope.data = {
          items: items.slice((page - 1) * pageSize, page * pageSize),
          total: items.length,
          page,
          pageSize,
        };
        return JSON.stringify(envelope);
      }
    }
    return payload;
  });
  /** 通知订阅者重新加载目录。
   * @returns 无返回值，发送最新目录修订。
   */
  async function publishCatalog() {
    broadcast({ type: 'catalog', data: await repository.catalog() });
  }
  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'innodl-api',
    database: pg ? 'postgresql' : 'sqlite-test',
    cache: cache ? 'redis' : 'postgresql-only',
    dataSource: 'simulation',
  }));
  class BackendModule {}
  Module({
    imports: [
      featureModule(AuthModule, 'AUTH_ROUTES', async () => {
        if (pg) {
          await registerAuthBase(app, pg.pool, options.bootstrapPassword);
          registerAuthExtensions(app, pg.pool);
          registerScopePolicy(app, pg.pool);
        }
      }),
      featureModule(UsersModule, 'USER_ROUTES', () => {
        if (pg) registerUserRoutes(app, pg.pool);
      }),
      featureModule(AssetsModule, 'ASSET_ROUTES', () => {
        registerResourceRoutes(app, repository, publishCatalog);
        if (pg) registerAssetRoutes(app, pg.pool, repository);
      }),
      featureModule(TopologyModule, 'TOPOLOGY_ROUTES', () => {
        if (pg) registerTopologyRoutes(app, repository, pg.pool);
      }),
      featureModule(TelemetryModule, 'TELEMETRY_ROUTES', async () => {
        registerMonitoringRoutes(app, repository, simulation);
        if (pg)
          await registerTelemetryRoutes(
            app,
            pg.pool,
            options.databaseUrl ?? 'postgresql://localhost:5432/innodl_system',
            options.schema,
          );
      }),
      featureModule(ProtectionModule, 'PROTECTION_ROUTES', () => {
        if (pg) {
          registerProtectionBase(app, pg.pool);
          registerProtectionRoutes(app, pg.pool, repository);
        }
      }),
      featureModule(WorkOrdersModule, 'WORK_ORDER_ROUTES', () => {
        if (pg) {
          registerOrderBase(app, pg.pool);
          registerFlowRoutes(app, pg.pool);
        }
      }),
      featureModule(ScenesModule, 'SCENE_ROUTES', async () => {
        if (pg) {
          registerSceneBase(app, pg.pool, repository);
          await registerSceneRoutes(app, pg.pool, publishCatalog);
        }
      }),
      featureModule(AlarmsModule, 'ALARM_ROUTES', () => {
        if (pg) registerAlarmRoutes(app, pg.pool);
      }),
    ],
  })(BackendModule);
  const nest = await NestFactory.create<NestFastifyApplication>(BackendModule, adapter, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  nest.useGlobalFilters(new ApiExceptionFilter());
  try {
    await nest.init();
  } catch (error) {
    if (pg) await pg.close();
    if (db) db.close();
    throw error;
  }
  app.get('/ws/scene-events', { websocket: true }, (socket) => {
    let authenticated = !pg;
    const authTimeout = setTimeout(() => {
      if (!authenticated) socket.close(1008, '鉴权超时');
    }, 5000);
    let sessionExpires = Infinity;
    let lastPong = Date.now();
    const heartbeat = setInterval(() => {
      if (Date.now() >= sessionExpires || Date.now() - lastPong > 45000) {
        socket.terminate();
        return;
      }
      socket.ping();
    }, 20000);
    socket.on('pong', () => {
      lastPong = Date.now();
    });
    socket.on('error', (error) => app.log.warn(error));
    socket.on('close', () => {
      clients.delete(socket);
      clearInterval(heartbeat);
      clearTimeout(authTimeout);
    });
    /** 发送鉴权后的最新完整状态。
     * @returns 状态读取与发送完成的 Promise。
     */
    async function initial() {
      const [data, state] = await Promise.all([repository.latest(), repository.simulation()]);
      if (socket.readyState === WebSocket.OPEN) {
        clients.add(socket);
        const scope = socketScopes.get(socket);
        const event: SceneEvent = {
          type: 'telemetry',
          data: scope
            ? { ...data, alarms: data.alarms.filter((alarm) => scope.has(alarm.assetId)) }
            : data,
          simulation: state,
          isDemoData: true,
        };
        socket.send(JSON.stringify(event));
      }
    }
    if (authenticated) void initial().catch((error) => app.log.error(error));
    socket.on('message', (raw) => {
      void (async () => {
        const message = JSON.parse(raw.toString());
        if (message.event === 'auth' && pg) {
          const token = z.string().max(200).parse(message.token);
          const found = await pg.pool.query(
            'SELECT user_id,expires_at FROM sessions WHERE token_hash=$1 AND expires_at>$2',
            [createHash('sha256').update(token).digest('hex'), Date.now()],
          );
          if (!found.rowCount) {
            socket.close(1008, '登录已过期');
            return;
          }
          sessionExpires = Number(found.rows[0].expires_at);
          const scope = await allowedAssets(pg.pool, found.rows[0].user_id);
          if (scope) socketScopes.set(socket, scope);
          authenticated = true;
          clearTimeout(authTimeout);
          await initial();
          return;
        }
        if (!authenticated) return;
        if (message.event === 'telemetry.subscribe') {
          const assetIds = z
            .array(z.string().max(80))
            .max(500)
            .parse(message.assetIds ?? []);
          subscriptions.set(socket, new Set(assetIds));
        }
        if (message.event === 'system.heartbeat') {
          lastPong = Date.now();
          socket.send(JSON.stringify({ event: 'system.heartbeat', timestamp: Date.now() }));
        }
      })().catch(() => socket.close(1008, '消息格式无效'));
    });
  });
  const webRoot = fileURLToPath(new URL('../../twin-screen/dist', import.meta.url));
  if (options.serveWeb && existsSync(resolve(webRoot, 'index.html')))
    await app.register(staticFiles, { root: webRoot, index: ['index.html'] });
  const timer =
    options.intervalMs === 0
      ? undefined
      : setInterval(() => {
          try {
            void simulation.advance().catch((error) => app.log.error(error));
          } catch (error) {
            app.log.error(error, '遥测采集失败');
          }
        }, options.intervalMs ?? 1000);
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    for (const socket of clients) socket.terminate();
    clients.clear();
    if (db) db.close();
    if (pg) await pg.close();
    if (cache) await cache.close();
  });
  await app.ready();
  return { app, repository, simulation, nest };
}
