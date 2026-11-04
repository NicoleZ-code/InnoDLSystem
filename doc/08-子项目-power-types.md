# 08 · 子项目代码架构：`@innodl/power-types`

> 路径：`packages/power-types/` · 定位：前后端共享 TypeScript 契约中心 · **零运行时代码**
> 文件：`src/index.ts`(40 行)、`src/contracts.ts`(111 行)；`exports: "./src/index.ts"`

## 1. 结构

```
src/index.ts     基础领域类型（40 行）  ──export type *──>  对外统一入口
     ↑ import type                                              │
src/contracts.ts 扩展契约（111 行）  <──────────────────────┘
```

`contracts.ts` 首行 `import type { Alarm, Asset, PowerLine, RegionId, Telemetry } from './index'`，而 `index.ts` 末行 `export type * from './contracts'`，构成 **index ↔ contracts 类型级双向环**。因全部是 `import type` / `export type *`，编译后完全擦除：`dist/index.js` 为 **0 B**，`dist/index.d.ts` 170 行含全部 28 个类型导出。

**全包无 `enum`、无 `export const`、无 `export function`**，是纯类型包；`typecheck` 是唯一带 `--noEmit` 的包。

## 2. 基础类型（`src/index.ts`）

| 导出 | 定义 |
| --- | --- |
| `SceneMode` | `'city' \| 'grid' \| 'venue' \| 'equipment'` |
| `AssetType` | `'venue' \| 'substation' \| 'transport' \| 'hotel' \| 'switchgear' \| 'transformer' \| 'sensor' \| 'feeder'` |
| `Status` | `'normal' \| 'attention' \| 'alarm'` |
| `RegionId` | `string` |
| `Asset` | `id, name, type, region, position:[number,number,number], voltage, capacity, status` |
| `PowerLine` | `id, name, fromId, toId, voltage, status, load` |
| `Alarm` | `id, assetId, message, severity:'attention'\|'alarm', timestamp` |
| `Telemetry` | `tick, timestamp, load, voltage, current, alarms: Alarm[]`（即「遥测快照」） |

## 3. 扩展契约（`src/contracts.ts`）

| 分组 | 导出 | 关键字段 |
| --- | --- | --- |
| 协议 | `ApiResponse<T>` | `code, message, data, isDemoData: boolean, requestId` |
| 协议 | `ApiError` | `error:{code,message,requestId}` |
| 场景 | `Region` | `id, name` |
| 场景 | `ModelBinding` | `assetId, modelUri, transform:{scale?,heading?,height?}` |
| 场景 | `SceneCatalog` | `assets, lines, regions, revision, modelBindings?` |
| 事件 | `SceneEvent` | `{type:'telemetry', data:Telemetry, simulation:SimulationState, isDemoData:true}` |
| 事件 | `CatalogEvent` | `{type:'catalog', data:SceneCatalog}` |
| 事件 | `DomainEvent` | `{type:'domain', event:string, seq:number, timestamp:number, data:unknown}` |
| 事件 | `ServerEvent` | `SceneEvent \| CatalogEvent \| DomainEvent` |
| 业务 | `AlarmRecord extends Alarm` | `status:'active'\|'resolved', acknowledgedAt, note` |
| 业务 | `AuditEntry` | `id, action, entityId, timestamp, details` |
| 业务 | `SimulationState` | `playing, tick` |
| 业务 | `SessionUser` | `id, username, role: UserRole` |
| 业务 | `UserRole` | `'admin' \| 'protection_manager' \| 'supervisor' \| 'operator' \| 'viewer'` |
| 业务 | `ProtectionEvent` | `id, name, level, status:'draft'\|'active'\|'completed', startsAt, endsAt, plan, assetIds` |
| 业务 | `WorkOrder` | `id, alarmId, assetId, eventId, title, assignee, status, feedback, createdAt, updatedAt` |
| 业务 | `SceneConfiguration` | `id, name, mode:string, configuration:{camera,layers,models}, revision` |
| 查询 | `AssetFilter`、`HistoryQuery` | `regionId?/type?`；`assetId?/fromTick?/toTick?/limit?` |

> `dist/index.d.ts` 末尾集中导出 **28 个类型**。

## 4. 消费方

被 **3 个 app + 5 个包/tooling** 引用，是依赖图的唯一汇点：

- `api-server`：`common/response.ts`（`ApiResponse`）、`app.ts`（`ServerEvent`）、`repositories/repository.ts`、`modules/auth/context.ts`（`SessionUser`）、`infrastructure/database/postgres.ts`
- `twin-screen`：`scene.store.ts`、`App.tsx`、`Topology.tsx`、`OperationsPanel.tsx`、5 个 `route.ts`
- `admin-web`：全部为 type-only（`SessionUser`、`SceneCatalog`、`AlarmRecord`、`Telemetry`）
- `twin-engine`：`EngineState`/`EngineBindings` 基于 `SceneCatalog`/`Telemetry`/`RegionId`/`AssetType`
- `api-client`：`ApiResponse`、`ServerEvent`、`SceneCatalog`、`Asset`、`PowerLine`、`AlarmRecord`、`AuditEntry`
- `shared-utils`、`ui-components`（声明未用）、`eslint-config`（声明未用）、`mock-telemetry`（声明未用）

## 5. 设计取舍与已知缺口

1. **契约不完整**：**没有测点（Measurement）、阈值规则（Rule/Threshold）、设备（Device）、拓扑边（TopologyEdge）等类型**；这些概念只存在于 `api-server/src/modules/telemetry/measurement.service.ts`、`database/schemas/schema.prisma`、Prisma model 与后台页面的局部接口（`Measurement`、`Report`、`Model`）中，前后端各自建模，存在漂移风险。
2. **类型级循环**：`index.ts ↔ contracts.ts` 双向引用；运行时无环，但对 IDE / 类型检查是双向耦合。建议把基础类型拆到第三个模块 `base.ts`。
3. **字面量集合不一致**：`Status`（normal/attention/alarm）、`Alarm.severity`（attention/alarm）、`AlarmRecord.status`（active/resolved）三套状态语义并存，且 `AlarmRecord extends Alarm` 同时携带 `severity` 与 `status`。
4. **`isDemoData` 类型不统一**：`ApiResponse.isDemoData: boolean` vs `SceneEvent.isDemoData: true`（字面量）；实现侧 `response.ts:8` 与 `app.ts` 均硬编码 `true`。
5. **弱类型字段**：`SceneConfiguration.mode: string` 未复用同包 `SceneMode`；`ProtectionEvent.level: string`、`DomainEvent.event: string` 未收窄为联合类型。
6. **复用不足**：`WorkOrder`、`ProtectionEvent`、`SceneConfiguration` 在 `admin-web` 中未被导入，页面重复定义局部接口；资源页数据统一 `Record<string, unknown>`，契约价值被削弱。
7. **零运行时是优点也是约束**：`dist/index.js` 为空，若将来把 `exports` 切到 `dist`，纯类型包没有值可导，需整体调整发布策略。
8. 无 `// @ts-expect-error`、无 `any`（根 ESLint 规则 `@typescript-eslint/no-explicit-any: error`）；但 `DomainEvent.data: unknown` 要求每个消费者自行收窄，实际代码中存在大量 `as` 断言。
