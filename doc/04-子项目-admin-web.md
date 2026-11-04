# 04 · 子项目代码架构：`@innodl/admin-web`

> 路径：`apps/admin-web/` · 名称：`@innodl/admin-web`（private） · 定位：综合业务后台 · 端口 5189（`ADMIN_PORT` 可覆盖）

## 1. 包配置

依赖：`@innodl/power-types`、`@innodl/api-client`、`@innodl/shared-utils`（`workspace:*`）、`react/react-dom 18.3.1`、`antd ^6.0.0`、`@ant-design/icons ^6.0.0`、`@tanstack/react-query ^5.90.0`、`echarts ^6.0.0`、`react-router-dom ^6.30.1`。

> `@innodl/shared-utils` 在 `src/` 全部 23 个源文件中**零引用**，是未使用的依赖声明。

`tsconfig.json` 单行 `{"extends":"../../tsconfig.json","include":["src","vite.config.ts"]}`；scripts 为 `dev: vite --host 0.0.0.0`、`build: tsc -p tsconfig.json && vite build`、`typecheck: tsc -p tsconfig.json`。

## 2. 目录分层

`src/` 共 23 个源文件（约 2500 行），无 `src/router/index.tsx`、无 `pages/*/index.tsx`、无独立登录路由、无测试文件。

| 目录/文件 | 职责 |
| --- | --- |
| `main.tsx`(33) | Provider 装配 |
| `app/App.tsx`(257) | 登录页 / 后台框架 / 路由分发 / 布局，四合一 |
| `layouts/navigation.tsx`(85) | `menuGroups` 静态菜单（10 个顶层项） |
| `router/resources.tsx`(62) | `resourceConfig(path, catalog, notify)` 配置驱动注册中心 |
| `router/resource-context.tsx`(35) | 共享 `id`/`name` 字段、`typeOptions`、`statusNames`、`ResourceContext` 接口（**不是 React Context**） |
| `components/ResourcePage.tsx`(304) | 通用 CRUD 表格：搜索、分页、表单弹窗、编辑/删除、行操作 |
| `pages/{8 个领域}/resources.tsx` | 8 个同构 `configure*` 函数，产出资源配置 |
| `pages/*/{Dashboard,Monitoring,Topology,ReportsPage,ModelsPage}.tsx` | 5 个特殊页面 |
| `style.css`(393) | 单文件全局 CSS，无 CSS 变量、无 Modules |

## 3. 启动链路与路由分发

`main.tsx` Provider 由外到内：`React.StrictMode` → `ConfigProvider`（`locale=zhCN`，`colorPrimary:'#087f8c'`）→ `AntApp` → `QueryClientProvider`（`retry:1`、`refetchOnWindowFocus:false`）→ `BrowserRouter(basename=BASE_URL)` → `App`。

**没有 `<Routes>` / `<Route>` / `useParams` / `Outlet`**。事实上的路由表是 `App.tsx` 中的字符串特判：

| 条件 | 渲染 |
| --- | --- |
| `!token \|\| user.isError` | 登录页 JSX 分支（`.login-page`，表单默认 `admin`） |
| `!user.data \|\| !catalog.data` | 全屏 `Spin`「正在加载统一业务数据」 |
| `/dashboard` | `<Dashboard />` |
| `/monitoring/realtime` / `/monitoring/history` | `<Monitoring />` / `<Monitoring history />` |
| `/topology/paths` | `<Topology catalog={...} />` |
| `/scenes/models` | `<ModelsPage catalog={...} />` |
| `/reports/protection` | `<ReportsPage />` |
| 其余 | `config ? <ResourcePage key={pathname} config={config}/> : <Alert "请选择左侧业务模块"/>` |

`layouts/navigation.tsx` 的 10 个顶层菜单（工作台、电力资产、供电拓扑、运行监测、重点保电、告警处置、运维工单、三维场景、分析报表、系统管理）中，叶子 `key` 直接是绝对路径，`Menu.onClick` 调 `navigate(key)`；**菜单无角色过滤、无权限字段**。

`resourceConfig()` 是「按路径匹配 + 责任链」：构造 `context = {path, catalog, base, assetOptions, act}`，依次调用 8 个 `configure*`，**首个返回非空配置胜出**：

```
configureAssets → configureTopology → configureMonitoring → configureAlarms
→ configureProtection → configureWorkOrders → configureScenes → configureSystem
```

## 4. 通用组件 `ResourcePage.tsx`

`ResourceConfig` 共 13 个顶层字段：`title / description / endpoint / fields / columns / canCreate / canEdit / deleteEndpoint / transform / editSuffix / prepare / editMethod / actions`；`Field` 共 7 个字段（`name/label/type/options/required/initial/disabledOnEdit`），`type` 支持 `date|number|textarea|select|switch|password`。

- **列表**：`useQuery([endpoint, pagination, search])` → `requestPage(`${endpoint}?page=&pageSize=&q=`)`；后端 `app.ts` 的 `onSend` 已按 `q` 过滤并包装 `{items,total,page,pageSize}`，前端 `dataSource` **又做一次** `JSON.stringify(row).includes(search)` 客户端过滤 → 双重过滤且 `total` 可能与可见行数不符。
- **表单**：`Modal` 内 `Form layout="vertical"`，遍历 `fields` 渲染控件；`required` 默认 `true`；`date` 用 `datetime-local` + 毫秒时间戳换算。
- **提交**：`transform?.(values, editing) ?? values` → `POST endpoint` 或 `PUT/PATCH endpoint/:id(+editSuffix)` → `refresh()` = `queryClient.invalidateQueries()`（**无参数，使全部查询失效**，含 `current-user` 与 `admin-catalog`）。
- **行操作**：`c.actions?.(record, refresh)` + 编辑按钮 + `deleteEndpoint` 时 `Modal.confirm` 后 `DELETE`。
- **业务字段泄漏进通用组件**：`edit()` 中硬编码 `position → longitude/latitude/height`、`destination → ...`、`assetIds → targetIds` 三类映射。

## 5. 八个领域资源配置

`endpoint` 均为前端书写形式 `/api/...`，经 `api-client.send()` 统一重写为 `/api/v1/...`。

| 领域（文件） | 路径 → endpoint | 写能力 |
| --- | --- | --- |
| assets | `/assets/stations`、`/assets/equipment` → `/api/assets`；`/assets/areas` → `/api/areas`；`/assets/lines` → `/api/power-lines` | 增改删（areas 无删除） |
| topology | `/topology/graph` → `/api/topology/edges` | 仅改（`state`: CLOSED/OPEN/UNKNOWN） |
| monitoring | `/monitoring/points` → `/api/measurement-points` | 增改（transform 补 `quality:'simulated'`） |
| alarms | `/alarms/rules` → `/api/alarm-rules`；`/alarms/events` → `/api/alarms` | 规则增改；事件只读 + 「确认」「定位」 |
| protection | `/protection/events` → `/api/protection-events`；`/protection/plans` → `/api/protection-plans` | 活动增改；预案仅增 |
| work-orders | `/work-orders` → `/api/work-orders` | 增 + 状态机 4 动作 |
| scenes | `/scenes` → `/api/scene-configurations`；`/scenes/cameras` → `/api/camera-presets` | 配置仅改 + 「发布」；镜头增改 |
| system | `/system/users` → `/api/users`（`editMethod:'PATCH'`）；`/system/roles` → `/api/roles`（`editSuffix:'/permissions'`）；`/system/audit` → `/api/audit` | 用户/角色可改；审计纯只读 |

**工单状态机**：按 `record.status` 映射按钮 `pending→assign`、`assigned→start`、`processing→submit`、`resolved→review`，动作 POST 到 `/api/work-orders/:id/:operation` 并携带 `version` 乐观锁；`submit` 弹 `Modal.confirm` + `TextArea` 收集反馈。

**「定位」按钮**：`window.open('http://localhost:5187/twin/station/' + assetId)`，`Dashboard.tsx` 的「进入大屏」同样硬编码 `http://localhost:5187/twin/overview`。

## 6. 五个特殊页面

| 页面 | 功能与可视化 |
| --- | --- |
| `Dashboard.tsx`(159) | 3 个轮询查询（summary 5s / active alarms 3s / history 10s）+ 4 个 `Statistic` + **ECharts** 折线（面积渐变）+ 告警 Table；`echarts.init` + `ResizeObserver` + `dispose` 手写生命周期 |
| `Monitoring.tsx`(128) | 实时模式 Table（2s 轮询 `/api/telemetry/latest`）；历史模式 ECharts 折线（`/api/measurement-history`，10s）；默认测点硬编码 `station-a-temperature` |
| `Topology.tsx`(88) | **不是图形**：`/api/topology/trace` 返回的 `assetIds` / `lineIds` 用 DOM 卡片 + `Tag` 列出，无 SVG/Canvas/ECharts graph，附「不作为现场倒闸依据」免责声明 |
| `ReportsPage.tsx`(95) | `/api/reports/protection` + 4 个 `Statistic` + 明细 Table；导出为 **JSON**（Blob + 动态 `<a>`），无 PDF/Excel |
| `ModelsPage.tsx`(196) | GLB 上传三步：`POST /api/scene-models/upload-url` → `PUT signed.url`（`Content-Type: model/gltf-binary`）→ `POST /api/scene-models/:id/complete`；绑定表单 `PUT /api/scenes/:sceneId/bindings`；3 个表格。**发布按钮不在此页**，在 `/scenes` 资源配置中 |

## 7. 数据层与登录态

- `request` / `requestPage` / `fetchScene` 来自 `@innodl/api-client`；`fetchScene` 仅用于 `App.tsx` 的 `catalog` 查询（10s 轮询）。
- `power-types` 全部为 **type-only** 导入：`SessionUser`、`SceneCatalog`、`AlarmRecord`、`Telemetry`。
- **未调用** `api-client.subscribeScene`：虽然 `vite.config.ts` 配了 `/ws` 代理，后台实时性完全依赖 `refetchInterval`（2/3/5/10s）。
- Token 存 `sessionStorage['innodl-token']`；Cookie 仅通过 `credentials:'include'` 携带。401 → `refreshSession()` 重放一次 → 失败清 token → `user.isError` 使 `App` 切回登录页。**没有 `navigate('/login')`、没有 `ProtectedRoute`、没有按 `SessionUser.role` 控制菜单或按钮**。
- `catalog` 查询 `enabled: !!user.data`，且 `!user.data || !catalog.data` 时整个后台停在 Spin —— 目录接口失败会阻塞全部业务页面。

`vite.config.ts`：`port: Number(ADMIN_PORT ?? 5189)`、`strictPort`、`base: ADMIN_BASE ?? '/'`、`envDir:'../..'`，代理 `/api`、`/models/uploaded`、`/ws`；`manualChunks` 拆 `antd`、`echarts`。

`style.css` 393 行，无 `:root` / CSS 变量，主色 `#087f8c` 在 CSS、ConfigProvider、ECharts 三处各自硬编码；大量 `!important` 覆盖 antd；两组响应式断点（1200px、900px）。

## 8. 设计取舍与已知缺口

1. **手写字串路由三处绑定**：`navigation.tsx` 菜单 key、`App.tsx` 的 `pathname` 特判、`resources.tsx` 的 `if (path === ...)`，新增页面需改三处；无 404、无懒加载、无 Suspense、无 ErrorBoundary。
2. **通用组件内嵌业务字段**（§4），且 8 个 `configure*` 同构重复，`...base` 展开、`statusNames` Tag 渲染、逗号分隔 ↔ 数组转换均重复多次；ECharts 生命周期样板在两页几乎逐行重复。
3. **跨应用硬编码地址** 5187，端口/域名变更即失效；`ADMIN_PORT` / `ADMIN_BASE` / `API_PROXY_TARGET` 三个环境变量未写入 `.env.example`。
4. **硬编码业务默认值**：`venue`（拓扑默认资产）、`station-a-temperature`、`'core'`、`121.302/31.188`、`'venue,station-a,station-b'`、`orientation:{heading:15,pitch:-48,roll:0}`、`scale:[1,1,1]`、场景 ID 列表在两处顺序还不一致。
5. **搜索双重过滤** + `invalidateQueries()` 无参全局失效，是明确的性能/一致性隐患。
6. **主题双份维护**：ConfigProvider token 与 CSS 字面量、图表色各自硬编码。
7. **未使用能力**：`shared-utils` 零引用；`/ws` 代理与 `subscribeScene` 未用；`power-types` 中的 `WorkOrder`、`ProtectionEvent`、`SceneConfiguration` 未被复用，页面内重复定义 `Measurement`、`Report`、`Model` 局部接口，资源数据统一 `Record<string, unknown>`。
8. **只读/半只读资源**：`/topology/edges` 无增删、`/alarms/events` 无增、`/system/audit` 全只读、`/scenes` 无增、`/protection/plans` 无改删。
9. **Dashboard 告警级别列恒显示「关注」**（`render: () => <Tag color="orange">关注</Tag>` 忽略 `severity`）；`configureAssets` 中 `path.includes('topology')` 为恒假死分支；`typeOptions` 把设备类型与场所类型混在一个下拉。
10. 无批量操作、无列排序/筛选、无详情抽屉、除报表 JSON 外无导出；`submit()` 的 `catch` 仅对 `Error` 实例提示，校验失败被静默吞掉；`act()` 成功与失败都走同一个 `message.info`。
