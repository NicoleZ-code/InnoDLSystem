# 全景智慧供电保障系统 · 方案 B

依据 `source/全景智慧电力保障系统_对话归档/documents/方案B_详细架构原文.md` 实施的 pnpm Monorepo：React + TypeScript 三维指挥大屏、独立综合管理后台、NestJS 模块化单体服务。采用 PostgreSQL 业务表、Prisma 测点/规则访问、Cesium 与 Three.js；Redis、PostGIS、MinIO 可通过 Compose 启用。

## 本地启动

要求 Node.js ≥22.17、pnpm 10、PostgreSQL ≥14，并创建项目专属数据库 `innodl_system`。

```sh
cd A-project/3D/InnoDLSystem/code
pnpm install
pnpm setup
# 在 .env 中设置 DATABASE_URL；本机默认使用当前系统用户连接 PostgreSQL。
pnpm db:generate
pnpm dev
```

- 大屏：<http://localhost:5187/twin/overview>（固定端口 5187）。
- 后台：<http://localhost:5189/dashboard>。5188 为本机其他项目使用；可通过 `ADMIN_PORT` 修改后台端口。
- API：<http://localhost:8787/api/v1/health>；路由索引 <http://localhost:8787/api-docs>。
- 管理员 `admin` 的首次密码由 `pnpm setup` 随机生成并保存在 `.env`。若数据库已初始化，新的环境变量不会重置已有密码；此前未配置密码时生成的凭据位于 `apps/api-server/data/bootstrap-admin.txt`。不在浏览器代码中内置密码。
- 默认是真实后端模式。只有显式设置 `VITE_DATA_MODE=offline` 才使用浏览器独立演示数据。

首次 API 启动执行幂等迁移与基础种子。默认 8 个保障对象、7 条线路、16 个测点和 8 条规则；需要扩展演示规模时，在完成首次启动后执行 `pnpm seed:demo`，增加 12 站、300 设备、120 线、800 测点，保留原有台账。

## 工程结构

```text
apps/
  twin-screen/src/{app,pages,components,hooks,stores,engine}
  admin-web/src/{app,layouts,pages,router,components}
  api-server/src/{modules,common,infrastructure,repositories,main.ts}
packages/
  twin-engine/src/{core,camera,scenes,layers,models,effects,interactions,bindings}
  api-client/  power-types/  ui-components/  shared-utils/  eslint-config/
tooling/model-converter/  tooling/mock-telemetry/
database/migrations/  database/seed/  database/schemas/
assets/city/  assets/expo/  assets/stations/  assets/equipment/
infra/compose.yaml  infra/nginx/  infra/scripts/
docs/architecture/  docs/api/  docs/database/  docs/scene-spec/  docs/testing/
```

后台按资产、拓扑、监测、保电、告警、工单、场景和系统管理分目录。后端按 auth/users/assets/topology/telemetry/alarms/protection/work-orders/scenes 分为 Nest 领域模块。共享 `power-types` 只包含类型；引擎通过状态读取和选择回调连接业务。

## 已实现业务

后台维护区域、资产、线路、独立电气开关状态、测点与阈值规则、保电活动/对象/预案、告警确认与关闭、工单显式状态流转、模型上传/绑定/发布、镜头预设、用户角色/区域授权、审计和保电汇总报告。列表支持分页与搜索。

大屏支持全景/区域/保电活动/站点/设备地址直达、图层筛选、拓扑联动、WebSocket 实时快照与告警定位、只读时间回放、设备分解/剖视/部件选择。城市场景切换复用 Viewer，切换独立设备场景时释放并保存城市镜头。

演示闭环：活动绑定资产 → `/twin/protection/ciie-2026` → 模拟 tick 30–54 温度越限 → 告警确认/定位 → 新建工单 → 指派 → 开始处理 → 提交反馈 → tick 55 恢复 → 主管复核关闭 → 活动归档/报告。改变公共模拟时钟使用管理员 `PATCH /api/v1/simulation`；大屏时间轴为当前浏览器只读回放。

## 检查与构建

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm format:check
pnpm build
```

集成测试连接 `TEST_DATABASE_URL`，默认本机专属 `innodl_system`；每次创建独立 schema 并在完成后删除。浏览器测试独占 5187、5198、8790，请先关闭本项目开发服务。SQLite 仅作为仓储单元测试适配器，生产默认 PostgreSQL。

ESLint、Prettier、Husky 和 lint-staged 已配置；当前目录尚未初始化 Git，后续在本目录初始化 Git 后执行 `pnpm prepare` 启用钩子。命名函数包含逐参数 `@param` 和 `@returns` 注释。

## 容器运行

```sh
pnpm setup
pnpm infra:up
# http://localhost:8080/ 和 http://localhost:8080/admin/
pnpm infra:down
```

Compose 包含 PostGIS PostgreSQL、Redis、MinIO、API 和 Nginx，持久化卷独立保存数据库与模型。模型上传与下载经过同源网关，浏览器不依赖 Docker 内部主机名。正式 HTTPS 环境设置 `COOKIE_SECURE=true` 并在入口终止 TLS。当前机器未完成 Docker 守护进程运行验证，不能视为已部署。

## 资料与交付边界

正式城市 GIS、站房 BIM、实物设备模型和生产采集接口尚未提供。当前空间模型为本地生成的演示资产，数值标记 simulated；不是视频对应真实测绘模型。通用 BIM/3D Tiles 转换、移动端和完整场景编辑器不属于当前已交付能力。长时运行、目标硬件 FPS 与实际生产接入需另行验收。

详见 
### [架构映射](docs/architecture/方案B落地.md)
### [接口协议](docs/api/README.md)
### [数据库](docs/database/README.md)
### [场景约定](docs/scene-spec/README.md) 
### [验收记录](docs/testing/验收记录.md)
