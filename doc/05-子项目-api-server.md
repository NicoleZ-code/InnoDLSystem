# 05 · 子项目代码架构：`@innodl/api-server`

> 路径：`apps/api-server/` · 名称：`@innodl/api-server`（private） · 定位：统一业务后端 · 端口 8787
> 源码：`src/` 下 38 个 `.ts` 文件（9 个空壳 `.module.ts` + 20 个业务文件 + 通用/仓储/基础设施）

## 1. 技术栈真相：Fastify 作肉、Nest 作壳

`package.json` 同时声明 `fastify ^5.6.2`、`@fastify/{websocket,static,swagger,swagger-ui}` 与 `@nestjs/{common,core,platform-fastify} ^11.1.0`、`reflect-metadata`、`rxjs`。实际实现：

| 层面 | 事实 |
| --- | --- |
| HTTP 实例 | `new FastifyAdapter({...}).getInstance()` 得到的**原生 `FastifyInstance`**（`app.ts:74-82`） |
| 路由注册 | 全部是 `app.get/post/put/patch/delete(...)`，由 20 个 `registerXxxRoutes(app, ...)` 直接注册，**无 `@Controller`、无 `@Get`、无 Guard/Pipe/Interceptor、无业务 DI** |
| Nest 用途① | `Module({imports:[featureModule(...)]})(BackendModule)` + `nest.init()`，靠 `onModuleInit` 鸭子类型触发 9 个注册闭包 |
| Nest 用途② | `nest.useGlobalFilters(new ApiExceptionFilter())`，经 `FastifyAdapter.setErrorHandler` 把过滤器装到 Fastify |
| 9 个 `.module.ts` | 全部空壳：`export class XxxModule {}` + `Module({})(XxxModule)` |

`modules.ts` 的 `featureModule(module, name, register)` 返回 `DynamicModule`，用 provider `useValue: { onModuleInit: register }` 承载闭包。该机制依赖 `@nestjs/core` 内部 `callModuleInitHook` 的 `isFunction(instance.onModuleInit)` 判断（已核验 `node_modules` 源码）。**移除 `nest.init()` 会让全部业务路由消失且失去全局异常处理** —— 这是本项目最脆弱的隐式耦合。

## 2. 启动链路与注册顺序

`main.ts`：`readConfig() → buildApp({databaseFile, databaseUrl, bootstrapPassword, intervalMs, redisUrl, logger: LOG_LEVEL!=='silent', serveWeb:true}) → app.listen({host: API_HOST, port: API_PORT})`；`SIGINT/SIGTERM` 只 `await app.close()`（不显式 `nest.close()`）。

`buildApp()`（`app.ts:73-390`）的精确顺序：

1. `FastifyAdapter`（`bodyLimit:65536`，`rewriteUrl`：`/api/` → `/api/v1/`）
2. 数据库选择：`DATABASE_FILE` ? SQLite : `openPostgres()`；`repository = pg?.repository ?? createRepository(db!)`
3. `cache = await createCache(redisUrl)`；`clients: Set<WebSocket>` + `socketScopes` / `subscriptions` 两个 WeakMap
4. 定义 `broadcast(event)`（按 scope/订阅裁剪，`bufferedAmount > 1MB` 时 `close(1013)`）
5. `measurements = pg ? createMeasurements(pool, onEvent) : undefined`；`simulation = createSimulation(repository, onChange, measurements?.sample)`
6. 注册 swagger（声明 `bearerAuth`）、swagger-ui（`/api-docs`）、`@fastify/websocket`（`maxPayload:4096`）
7. `preValidation` 钩子：zod 校验 `page`(≥1)、`pageSize`(1..500)
8. `onSend` 钩子：全局 `Cache-Control: no-store`；对 `/api/v1/` 且 `statusCode<400` 的字符串响应 `JSON.parse`，若 `envelope.data` 为数组则按 `q` 模糊过滤并包装为 `{items,total,page,pageSize}`
9. `GET /api/v1/health`（**返回裸对象，未用 `response()` 封装**）
10. `BackendModule` + `NestFactory.create(...)` + `useGlobalFilters` + `await nest.init()` → 9 个模块注册路由
11. `GET /ws/scene-events`（`websocket:true`）
12. 条件注册 `@fastify/static`，root = `apps/twin-screen/dist`（仅当 `index.html` 存在）
13. `setInterval(simulation.advance, intervalMs ?? 1000)`（`intervalMs===0` 时不建定时器）
14. `onClose` 钩子：清 timer、terminate 所有 ws、`db.close()` / `pg.close()` / `cache.close()`
15. `await app.ready()` → `{app, repository, simulation, nest}`

> **cookie / CORS 插件并不存在**：`@fastify/cookie`、`@fastify/cors` 都不在依赖里。Cookie 手写 `split(';')` 解析 + `reply.header('Set-Cookie')` 拼接；CORS 完全未配置，前后端只能同源或走代理。

`config.ts`：dotenv 从 `code/.env` 读取，zod 校验 `API_HOST`(默认 127.0.0.1)、`API_PORT`(8787)、`DATABASE_URL`、`DATABASE_FILE`(可选)、`BOOTSTRAP_ADMIN_PASSWORD`(≥12)、`SIMULATION_INTERVAL_MS`(100..60000，默认 1000)、`REDIS_URL`、`LOG_LEVEL`。`COOKIE_SECURE`、`MINIO_*` **不经 config.ts**，直接读 `process.env`。

`tsup.config.ts`：单入口 `src/main.ts`、ESM、`target node22`、`noExternal:[/^@innodl\//]`（workspace 包打进 bundle）。

## 3. 模块划分

`modules.ts` 导出 9 个模块；`app.ts` 的 `BackendModule.imports` 顺序为 **Auth → Users → Assets → Topology → Telemetry → Protection → WorkOrders → Scenes → Alarms**。

| 文件（相对 `src/modules/`） | 导出 | 职责 | 仅 PG |
| --- | --- | --- | --- |
| `auth/base.routes.ts` | `passwordHash`、`registerAuthBase` | 登录/会话 + **全局 `onRequest` 鉴权与角色权限** + 幂等建 admin | ✓ |
| `auth/auth.routes.ts` | `registerAuthExtensions` | Access Token 缩短、Refresh Cookie 轮换、`/roles` 维护 | ✓ |
| `auth/context.ts` | `authenticatedUsers: WeakMap` | 请求级认证上下文 | — |
| `auth/scope.ts` | `allowedAssets`、`registerScopePolicy` | 区域授权递归展开 + `preHandler` 入参校验 / `preSerialization` 响应裁剪 | ✓ |
| `users/users.routes.ts` | `registerUserRoutes` | 用户创建、角色与区域授权 | ✓ |
| `assets/resource.routes.ts` | `registerResourceRoutes` | 目录/区域/资产/线路 CRUD，变更后 `publishCatalog()` | ✗ |
| `assets/assets.routes.ts` | `registerAssetRoutes` | 区域层级、子资产、GeoJSON 视域、拓扑图/路径/版本、平台汇总 | ✓ |
| `topology/topology.routes.ts` | `registerTopologyRoutes` | 开关边状态 + 上下游 BFS 追踪 | ✓ |
| `telemetry/monitoring.routes.ts` | `registerMonitoringRoutes` | 演示遥测/历史/回放、告警列表与确认、审计、模拟时钟控制 | ✗ |
| `telemetry/telemetry.routes.ts` | `registerTelemetryRoutes` | Prisma 测点/规则 + `pg` 原生 SQL 最新值/历史 | ✓ |
| `telemetry/simulation.service.ts` | `createSimulation` | 唯一权威时钟、`serial()` 串行推进、`snapshotAt/advance/control/replay` | — |
| `telemetry/measurement.service.ts` | `createMeasurements` | 测点采样、阈值评估、告警生成/恢复、写 `telemetry_latest/history` | — |
| `alarms/alarms.routes.ts` | `registerAlarmRoutes` | 告警详情、恢复后人工关闭 | ✓ |
| `protection/base.routes.ts` | `registerProtectionBase` | 保电活动核心维护（`createMutation` 事务） | ✓ |
| `protection/protection.routes.ts` | `registerProtectionRoutes` | 活动详情/目标集合/资产、预案、报告 | ✓ |
| `work-orders/base.routes.ts` | `registerOrderBase` | 工单创建（`Idempotency-Key`）与列表 | ✓ |
| `work-orders/flow.routes.ts` | `registerFlowRoutes` | 状态机 4 动作 + 详情与日志 | ✓ |
| `scenes/base.routes.ts` | `registerSceneBase` | 场景配置草稿 | ✓ |
| `scenes/scenes.routes.ts` | `registerSceneRoutes`、`addContentTypeParser` | 模型上传/存储/绑定/图层/镜头/发布 | ✓ |

> **关键降级事实**：设置 `DATABASE_FILE`（SQLite）时，只有 `resource.routes.ts` 与 `monitoring.routes.ts` 两个注册器无条件执行，其余 **17 个注册器被 `if (pg)` 跳过**；`measurements` 为 `undefined`（无真实测点采样与规则告警），WebSocket `authenticated = !pg` **免鉴权**，`catalog()` 无 `modelBindings`。`code/docs/api/README.md` 未描述此模式。

## 4. 认证授权

- **不透明令牌 + 数据库 session**，不是 JWT：`passwordHash = salt:scryptSync(password,salt,32)`（`scryptSync` 同步阻塞事件循环）；`token = randomBytes(32).base64url`，`sessions` 只存 `token_hash = SHA-256`；登录比对用 `timingSafeEqual`。
- 限流：`attempts: Map<ip,{count,until}>`，10 次/60 秒 → 429；**条目永不删除**，多实例可绕过。
- 有效期：登录先插 8 小时 session，`auth.routes.ts` 的 `onSend` 随即改写为 **15 分钟**；`innodl-refresh` HttpOnly Cookie `Max-Age=604800`、`Path=/api/v1/auth`、`SameSite=Lax`（`COOKIE_SECURE==='true'` 时加 `Secure`），`refresh_sessions` 一次性轮换。
- 初始 `admin`：不存在时用 `bootstrapPassword ?? randomBytes(18).base64url` 建号；未传密码时写 `data/bootstrap-admin.txt`（`0o600`）。
- **权限靠 URL 字符串推断 domain**（`base.routes.ts:80-91`）：`/protection`→protection、`/work-orders`→workorders、`/alarm`→alarms、`/scene|/model|/camera`→scenes、`/topology`→topology，否则 assets；要求 `'*'` 或 `${domain}.manage`，GET 额外允许 `*.read`。`/\/(users|roles)(\/|$)/` 或非 GET 的 `/simulation`、`/alarm-rules` 要求 `role==='admin'`。
- `scope.ts`：`user_scopes` 无行 → `null`（全域）；有行则用 `WITH RECURSIVE` 沿 `regions.parent_id` 展开子区域，得到 `Set<assetId>`；`preHandler` 检查 `body.assetId/fromId/toId/assetIds`、`query.*`、`params.id` 反查越界 → 403；`preSerialization` 对键名 `assets/lines/alarms/telemetry/features` 的数组递归裁剪。
- **WebSocket**：5 秒内 `{event:'auth',token}` 校验 `sessions`，超时 `close(1008)`；20s `ping`、45s 无 pong `terminate()`。

## 5. 数据访问层

```
SceneRepository（13 个同步签名方法）
  ├─ createRepository(DatabaseSync)         SQLite：document TEXT(JSON) 列，transaction() 包裹写操作
  └─ openPostgres(...).repository           PostgreSQL：独立业务表，tx() + pg_advisory_xact_lock
        ↑ 两者通过 `type Repository` 映射类型统一为 `T | Promise<T>`，所有路由都 `await`
```

`unit-of-work.ts` 的 `createMutation(pool).mutate(action,id,operation)`：`BEGIN → operation(client) → INSERT audit_log → COMMIT`，异常 `ROLLBACK`；仅被 protection / scenes / work-orders 的 base 路由使用，其余路由各自手写 `pool.connect()/BEGIN/COMMIT/ROLLBACK`。

三适配器：

| | `postgres.ts` | `extended.ts` | `sqlite-test.ts` |
| --- | --- | --- | --- |
| 职责 | 生产主适配器 + 基础种子 | 增量迁移 + 幂等回填 | 隔离测试适配器 |
| 建表来源 | `001-core.sql` | `002-domains.sql` + 条件 `003-spatial.sql` | 内联 SQL 自建 8 张表 |
| 连接 | `Pool({max:8, options:'-c search_path=<schema>,public'})`，schema 经正则白名单 | 同 advisory lock `583177` | `node:sqlite DatabaseSync`，`:memory:` 可用 |

`infrastructure/cache.ts`：`!url → return undefined`（**无内存降级**）；有 Redis 时 `multi()` 写 `telemetry:latest:{pointId}`(`EX:30`) 并 `publish('innodl:events', ...)`，`client.on('error', () => {})` 静默吞错；**代码中没有任何 subscribe 或读取这些键的地方**。

`infrastructure/project-path.ts`：从 `process.cwd()` 逐级向上找 `pnpm-workspace.yaml` 定位 SQL 文件；容器/独立部署若缺该文件，`postgres.ts` 顶层 `readFileSync` 会直接抛错。

**Prisma 只覆盖 2 张表**：`schema.prisma` 定义 `MeasurementPoint`、`AlarmRule`（均 `@@map` 到 SQL 已建表），唯一使用处 `telemetry.routes.ts` 的 `new PrismaClient({datasources:{db:{url: ...&schema=<schema>}}})`；`api-server/prisma/` 是空目录。

## 6. 通用层

- `common/response.ts`：`response<T>()` → `{code:'OK', message:'success', data, isDemoData:true, requestId}`；**`isDemoData` 恒为 `true`**，真实 PG 数据也被标记演示。
- `common/errors.ts`：`ApiExceptionFilter` 状态码映射 `P2002/23505→409`、`P2025→404`、`23503→422`、`ZodError→400`、`DomainError→error.status`、其余 500；错误体 `{code,message,error:{code,message,requestId},requestId}`；末尾用 `Catch()(ApiExceptionFilter)` 运行时调用装饰器。
- `common/schemas.ts`：`idSchema`、`regionSchema`、`statusSchema`、`assetSchema`（strictObject，经纬度/电压/容量范围）、`lineSchema`、`filterSchema`、`tickSchema`、`controlSchema`、`historySchema`。**统一模式是 handler 内手动 `.parse()`**，没有 Fastify 声明式 schema，因此 Swagger 里不会出现业务接口。

## 7. 实时与仿真

`setInterval(1000)` → `simulation.advance()`：

1. `snapshotAt(tick)` = `telemetryAt(tick)`（`shared-utils`：`load=62.4+sin(tick/13)*4.2`、`voltage=10.48+sin(tick/7)*0.08`、`current=432+sin(tick/11)*23`；`tick%90 ∈ [30,55)` 时产生 `station-a` 温度告警），再过滤已删除资产的告警。
2. `serial()` 用 `pending` Promise 链串行化，`pending = task.catch(()=>undefined)` 保证失败不阻塞后续采集。
3. `measurements.sample(snapshot)`：查启用测点 → 写 `telemetry_latest`（`ON CONFLICT DO UPDATE`）与 `telemetry_history`（分区表）→ 按 `alarm_rules` 的 `gt/lt` 阈值生成/恢复告警（部分唯一索引保证每条规则至多 1 条 active）→ 用真实 DB 告警**替换**演示快照的 `alarms` → `onEvent('telemetry.batch', values)`。
4. `repository.record(snapshot, tick)` → `onChange` → `broadcast({type:'telemetry', data, simulation, isDemoData:true})`。

**WebSocket `/ws/scene-events` 推送 3 类 `ServerEvent`**：`telemetry`（快照）、`catalog`（资产/线路/模型绑定变更后）、`domain`（`telemetry.batch` / `alarm.created` / `alarm.updated`，带进程内 `seq` 计数器，重启归零）。客户端消息：`auth`、`telemetry.subscribe`（`assetIds` ≤500）、`system.heartbeat`。

## 8. 路由清单（88 条 HTTP + 1 个 WS）

分组摘要（`†` 表示 SQLite 模式下不存在）：

- **应用级**：`GET /api/v1/health`（裸对象）、`GET /ws/scene-events`、`/api-docs`、`/*` 静态托管。
- **Auth†**：`POST /auth/login`、`GET /auth/me`、`POST /auth/logout`、`POST /auth/refresh`、`GET /roles`、`PUT /roles/:id/permissions`。
- **Users†**：`GET|POST /users`、`PATCH /users/:id`。
- **Assets 核心**（无 `†`）：`GET /regions`、`GET /catalog/:sceneId`（仅 5 个合法 sceneId）、`GET|POST /assets`、`GET|PUT|DELETE /assets/:id`、`GET|POST /power-lines`、`PUT|DELETE /power-lines/:id`。
- **Assets 扩展†**：`GET|POST /areas`、`GET|PUT /areas/:id`、`GET /assets/:id/children`、`GET /assets/geojson`、`GET /topology/graph`、`GET /topology/paths`、`POST /topology/publish`、`GET /platform/summary`。
- **Topology†**：`GET /topology/edges`、`PUT /topology/edges/:id`、`GET /topology/trace`。
- **Monitoring 核心**（无 `†`）：`GET /telemetry/summary`、`GET /telemetry/replay`、`GET /telemetry/history`、`GET /alarms`、`POST /alarms/:id/acknowledge`、`GET /audit`、`GET|PATCH /simulation`。
- **Telemetry 测点†**：`GET|POST /measurement-points`、`PUT /measurement-points/:id`、`GET|POST /alarm-rules`、`PUT /alarm-rules/:id`、`GET /telemetry/latest`、`GET /measurement-history`、`GET /assets/:id/measurements`。
- **Alarms†**：`GET /alarms/:id`、`POST /alarms/:id/close`。
- **Protection†**：`GET|POST /protection-events`、`GET|PUT /protection-events/:id`、`PUT /protection-events/:id/targets`、`GET /protection-events/:id/assets`、`GET|POST /protection-plans`、`GET /reports/protection`。
- **Work Orders†**：`GET|POST /work-orders`、`GET /work-orders/:id`、`POST /work-orders/:id/{assign|start|submit|review}`。
- **Scenes†**：`GET|PUT /scene-configurations`、`GET /scene-models`、`POST /scene-models/upload-url`、`PUT /model-upload/:id`（**鉴权豁免**，靠 HMAC 5 分钟签名）、`POST /scene-models/:id/complete`、`GET /models/uploaded/:file`（**不在 `/api/v1` 前缀下，不受鉴权**）、`GET /model-bindings`、`GET /scenes`、`GET /scenes/:id`、`/layers`、`/objects`、`/cameras`、`GET|POST /camera-presets`、`PUT /camera-presets/:id`、`PUT /scenes/:id/bindings`、`POST /scenes/:id/publish`。

> `code/docs/api/README.md` 漏列 `/health`、`/regions`、`/assets/:id/children`、`/assets/:id/measurements`、`/model-bindings`、5 个 `scenes` 子路由、`PUT /model-upload/:id`、`GET /models/uploaded/:file`、`/ws/scene-events`、`/api-docs` 等 14 条。

## 9. 存储与文件

`scenes.routes.ts` 的 `registerSceneRoutes(app, pool, onPublish)`：本地存储根 `data/models`；`signingKey = randomBytes(32)` **每进程启动随机**（重启后未完成上传 URL 立即失效）。MinIO 可用时走 `minio.putObject/getObject`，否则 `writeFileSync(...,{flag:'wx',mode:0o600})` + `createReadStream`。上传校验：签名 `timingSafeEqual`、`size` 12B..50MB、GLB 魔数 `0x46546c67`、version 2、声明长度 == 实际长度。发布时写 `app_state['published-scene-{id}']` 快照、递增 revision、写审计并 `onPublish()` 广播 catalog。

## 10. 设计取舍与已知缺口

1. **Nest/Fastify 隐式耦合**（§1）：路由注册与异常处理都绑在 `nest.init()` 的内部行为上，无显式契约或测试保护。
2. **鉴权白名单与前缀漏洞**：`/api/v1/model-upload/` 显式跳过 `onRequest` 全部检查；`/models/uploaded/:file` 不在 `/api/v1` 前缀下，任何人可读取 `uploaded/published` 模型；CORS 完全缺失。
3. **URL 子串推断 domain**：`route.includes('/alarm')` 把 `/alarm-rules` 归入 alarms，新增路由易漏鉴权；三个钩子（`auth onSend` / `app onSend` / `scope preSerialization`）对 `JSON.parse(payload)` 与 `envelope.data` 是否为数组有隐含约定。
4. **Redis 跨实例广播未闭环**：只 publish 不 subscribe，`clients` 是进程内 Set，多实例各推各的。
5. **Swagger 空壳**：原生路由无 Fastify `schema`，OpenAPI 不含业务接口。
6. **`telemetry_history` 分区形同虚设**：只建 DEFAULT 分区，无按月建子分区代码；`measurement.service.ts` 每 tick 全表查测点 + 每条规则单独查 active 告警，N+1 明显。
7. **`/topology/paths` 标识不一致**：`from/to` 按裸 `assetId` 与 `topology_edges.from_node_id`（`node-xxx`）比较，用裸 id 调用几乎必然只返回 `[from]`；而 `/topology/graph` 返回 `node-xxx`。
8. **会话清理不完整**：`sessions` 仅 login 时清理过期行，`refresh_sessions` 只删当前 token；`logout` 用 `authorization?.slice(7)` 不校验 `Bearer ` 前缀；`scryptSync` 阻塞事件循环。
9. **降级无内存替代**：未配 `REDIS_URL` 缓存功能整体关闭；`DATABASE_FILE` 模式下 17 个注册器不执行、WS 免鉴权（README 未说明）。
10. **`isDemoData` 恒 true**、`health` 未统一封装、`LOG_LEVEL` 除 `silent` 外不生效、`shutdown()` 未 `nest.close()`、`Cache-Control:no-store` 被全局加到静态资源与 Swagger 上。
11. `projectPath()` 依赖 `pnpm-workspace.yaml` 定位迁移文件；`COOKIE_SECURE`/`MINIO_*` 游离于 config.ts 之外。
12. **与 `code/docs/api/README.md` 的差异**（§8、§9.9）需要在维护接口时同步更新。
