# InnoDLSystem 文档中心

> 全景智慧供电保障系统（方案 B 可运营 MVP）· 架构与使用文档
> 代码快照日期：2026-11-04 · 代码根目录：`InnoDLSystem/code/`
> 本文档由源码逐文件分析生成，所有路径、端口、符号名、数量均可在 `code/` 中核验。

## 文档清单

### 全局

| 文档 | 内容 |
| --- | --- |
| [01 · 使用文档](01-使用文档.md) | 环境要求、安装启动、配置项、首次登录、演示业务闭环、测试命令、容器部署、排错 |
| [02 · 总体架构文档](02-总体架构文档.md) | 系统分层、Monorepo 依赖拓扑、运行时数据流、技术栈真相、数据库与部署、与方案 B 原文的差异、已知边界 |

### 子项目代码架构（每个 workspace 包独立一篇）

| 文档 | 子项目 | 一句话定位 |
| --- | --- | --- |
| [03 · twin-screen](03-子项目-twin-screen.md) | `apps/twin-screen` | React + Cesium/Three 三维指挥大屏，端口 5187 |
| [04 · admin-web](04-子项目-admin-web.md) | `apps/admin-web` | React + Ant Design 综合业务后台，端口 5189 |
| [05 · api-server](05-子项目-api-server.md) | `apps/api-server` | Fastify 路由 + Nest 生命周期壳的统一后端，端口 8787 |
| [06 · twin-engine](06-子项目-twin-engine.md) | `packages/twin-engine` | Cesium 城市场景渲染内核，与业务通过 bindings 解耦 |
| [07 · api-client](07-子项目-api-client.md) | `packages/api-client` | 前后端共用的 HTTP / WebSocket 客户端封装 |
| [08 · power-types](08-子项目-power-types.md) | `packages/power-types` | 零运行时代码的共享 TypeScript 契约中心 |
| [09 · shared-utils](09-子项目-shared-utils.md) | `packages/shared-utils` | 全仓唯一演示数据源与确定性遥测公式 |
| [10 · ui-components](10-子项目-ui-components.md) | `packages/ui-components` | 10 行占位包，无 React 组件、无消费者 |
| [11 · eslint-config](11-子项目-eslint-config.md) | `packages/eslint-config` | ESLint 9 flat config，强制逐参数 JSDoc |
| [12 · mock-telemetry](12-子项目-mock-telemetry.md) | `tooling/mock-telemetry` | 一次性 NDJSON stdout 脚本（不是服务、不监听端口） |
| [13 · model-converter](13-子项目-model-converter.md) | `tooling/model-converter` | 纯 Python GLB 演示几何生成器 |

### 支撑设施

| 文档 | 覆盖范围 |
| --- | --- |
| [20 · 数据库](20-支撑-数据库.md) | SQL 迁移、Prisma 双轨、幂等种子、演示数据 |
| [21 · 基础设施与脚本](21-支撑-基础设施与脚本.md) | Docker Compose、Dockerfile、Nginx、dev/setup/copy-cesium 脚本 |
| [22 · 测试体系](22-支撑-测试体系.md) | Vitest 单测、Playwright E2E、三层数据库隔离 |

## 阅读路径建议

- **第一次接手项目**：`01 使用文档` → `02 总体架构` → `05 api-server` → `03 twin-screen`。
- **改前端页面**：`02` 的依赖边界 → `03` / `04` → `07` / `08` / `09`。
- **改三维场景**：`06 twin-engine` → `03 twin-screen` 的 engine 目录 → `13 model-converter`。
- **改接口或加表**：`05 api-server` → `20 数据库` → `07 api-client` → `22 测试体系`。
- **部署上线**：`01` 的容器章节 → `21 基础设施与脚本` → `02` 的部署拓扑。

## 与仓库内已有文档的关系

`code/docs/` 下已有项目自带的落地记录（`architecture/方案B落地.md`、`api/README.md`、`database/README.md`、`scene-spec/README.md`、`README.md` 等）。本目录不替代它们，而是：

1. 从**源码事实**出发重新梳理，补上代码自带文档未覆盖的实现细节（例如 Nest/Fastify 混用真相、SQLite 模式下大量路由不注册、`mock-telemetry` 并非服务等）；
2. 按**子项目**拆分，便于按包查阅；
3. 记录与 `source/全景智慧电力保障系统_对话归档/documents/方案B_详细架构原文.md` 的可核验偏差。

> 已知的原仓库文档问题：`code/docs/acceptance.md` 指向的 `code/docs/testing/验收记录.md` 不存在；`code/docs/architecture.md` 与 `implementation-plan.md` 均为 3 行索引占位。

## 约定

- 文中路径若无特别说明，均相对 `InnoDLSystem/code/`。
- 「端口」「数量」「符号名」来自源码常量与配置，不是推测。
- 每篇子项目文档末尾都有「设计取舍与已知缺口」，指出可核验的耦合点与未实现能力，供后续迭代参考。
