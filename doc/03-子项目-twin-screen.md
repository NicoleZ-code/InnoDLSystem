# 03 · 子项目代码架构：`@innodl/twin-screen`

> 路径：`apps/twin-screen/` · 名称：`@innodl/twin-screen`（private） · 定位：三维指挥大屏 · 端口 5187（固定）

## 1. 包配置与脚本

`package.json` 依赖：`@innodl/power-types`、`@innodl/api-client`、`@innodl/twin-engine`、`@innodl/shared-utils`（均 `workspace:*`），以及 `react/react-dom 18.3.1`、`styled-components ^6.1.19`、`zustand ^5.0.8`、`@tanstack/react-query ^5.90.0`、`cesium 1.132.0`、`three ^0.180.0`、`lucide-react`、`react-router-dom ^6.30.1`。

```json
"dev":   "node ../../scripts/copy-cesium.mjs && vite --host 0.0.0.0",
"build": "node ../../scripts/copy-cesium.mjs && tsc -p ../../tsconfig.json && vite build",
"typecheck": "tsc -p ../../tsconfig.json --noEmit"
```

`build` 使用**仓库根** `tsconfig.json`（其 `include` 恰为 `apps/twin-screen/src` 与 `packages/power-types/src`）。

## 2. 目录分层与规模

`src/` 共 21 个源码文件，合计约 4197 行；其中 `global.css` 1838 行、`App.tsx` 891 行，两者约占 65%。

| 目录 | 文件 | 职责 |
| --- | --- | --- |
| `api/` | `client.ts`（1 行） | `export * from '@innodl/api-client'` 薄适配层 |
| `app/` | `App.tsx`（891 行） | **唯一页面组件**，装配全部 DOM 区块、派生计算与交互回调 |
| `components/panels/` | `Panel.tsx`(48)、`OperationsPanel.tsx`(444) | 通用面板（唯一使用 styled-components 处）、数据维护弹窗 |
| `components/charts/` | `Charts.tsx`(135) | `LoadChart`（自绘 SVG）、`Gauge`（CSS `conic-gradient`） |
| `components/scene-ui/` | `Topology.tsx`(132) | 供电一次接线图（自绘 SVG + 8 个硬编码坐标） |
| `engine/` | `city.ts`(1)、`CityScene.tsx`(90)、`EquipmentScene.tsx`(170) | Cesium / Three.js 的 React 生命周期边界 |
| `hooks/` | `useSceneData.ts`(95)、`useTwinRoute.ts`(83) | 数据加载 + 实时订阅 + 回放；地址 ↔ store 同步 |
| `pages/` | 5 个 `route.ts`(各 3 行)、`overview/Login.tsx`(68) | **无页面组件**，只有路径常量与登录表单 |
| `stores/` | `scene.store.ts`(91) | zustand `useStore` |
| `styles/` | `global.css`(1838) | 单文件全局样式 |

**全 app 未使用 echarts / recharts / d3 / canvas**：所有图表与拓扑为手写 SVG 或 CSS 渐变，图标来自 `lucide-react`。

## 3. 启动与路由

`main.tsx`（16 行）挂载三层 Provider：`React.StrictMode` → `QueryClientProvider`（`new QueryClient()` 无默认选项）→ `BrowserRouter` → `<App />`；未装 `ThemeProvider`。

**没有声明式路由表**：全仓无 `<Routes>` / `<Route>` / `useParams`。`pages/*/route.ts` 只导出 `{ path, mode }` 常量，真正的「路由」是 `useTwinRoute.ts` 对 `pathname.split('/')` 的 `[, prefix, page, id]` 手工解析：

| 地址 | 写入 store |
| --- | --- |
| 非 `/twin` 前缀 | `navigate('/twin/overview', {replace:true})` |
| `/twin/protection/:id` | 先 `GET /api/v1/protection-events/:id`，成功设 `mode:'venue'`、`protectedIds: event.assetIds` |
| `/twin/area/:id` | `mode:'city'`、`region:id`（裸字面量 `'area'`，无常量定义） |
| `/twin/station/:id` | `mode:'venue'`、`selected:id` |
| `/twin/device/:id` | `mode:'equipment'`、`selected:id` |
| `/twin/topology` | `topology:true`、`mode:'grid'` |
| `/twin/overview` / `/twin/alarms` | `mode:'city'` |
| `/twin/replay` | `playing:false`（裸字面量 `'replay'`） |

`changeMode(mode)` 反向生成地址：`city→/twin/overview`、`grid→/twin/topology`、`equipment→/twin/device/:selected`、`venue→/twin/station/:selected`。**每个分支都无条件清空 `protectedIds`**，因此从任何地址切换都会丢失保电筛选。

`App.tsx` 首屏两个提前返回：错误信息匹配 `/登录|权限/` → `<Login>`；`isPending || isError` → 加载/失败态（「重新连接」按钮调 `refetch()`）。

## 4. 三维渲染

```mermaid
flowchart TB
  App["App.tsx<br/>state.mode 判定"] -->|city / grid / venue| City["CityScene.tsx<br/>key=catalog.revision"]
  App -->|equipment| Equip["EquipmentScene.tsx"]
  City -->|createCity(container, onReady, onError, bindings)| Engine["@innodl/twin-engine<br/>Cesium Viewer"]
  City -->|captureCamera / restoreCamera| Store["zustand camera"]
  Equip -->|GLTFLoader + Raycaster| Three["Three.js 独立设备场景"]
  Store -->|useStore.subscribe 每次变化调用 sync()| Engine
```

**CityScene（90 行）**：`useEffect([])` 内调 `createCity(container, ..., { getState: useStore.getState, select: id => ...select(id) })`；挂载时若有 `camera` 快照则 `restoreCamera`，否则 `fly(mode, true)` 并对选中资产 `viewer.flyTo`；`useStore.subscribe` 在 `mode/region/revision` 变化时 `fly`、在 `selected` 变化时按 `'line-'` 前缀选择 `networks`/`pois` 数据源 `flyTo`；卸载时 `unsubscribe → set({camera: captureCamera(viewer)}) → scene.destroy()`。

**EquipmentScene（170 行）**：`T.Scene` + `WebGLRenderer`（`localClippingEnabled=true`）+ `PerspectiveCamera(38)` 固定机位 `(7,5,10)` + `OrbitControls` + 半球光/平行光 + `GridHelper`；`GLTFLoader` 加载 `/models/switchgear.glb`，为每个 Mesh 生成 `EdgesGeometry` 描边；`Raycaster` 拾取写入 `state.component`；`animate()` 每帧按 `state.exploded`（`(index-1.5)*0.38` 位移）、`state.cutaway`（隐藏 `cabinet/door/meter/handle` 四类 Mesh）、`state.component`（emissive 高亮）更新；`ResizeObserver` 同步尺寸；卸载时 `disposeObject(scene)` + `renderer.dispose()`。

> 「内部剖视」不是几何剖切——虽启用了 `localClippingEnabled`，但全文件没有创建任何 `T.Plane` 或 `clippingPlanes`，实际只是隐藏若干 Mesh。

**镜头保存只覆盖城市场景**：`CameraSnapshot` 由 `CityScene` 卸载写入、挂载读取，`EquipmentScene` 每次进入都是固定机位。

## 5. 状态与数据流

`scene.store.ts` 的 `State` 主要字段：

| 分组 | 字段（初值） |
| --- | --- |
| 数据 | `catalog`(本地演示目录, revision 0)、`telemetry`(`telemetryAt(0)`)、`connection`('connecting')、`dataError`('') |
| 视图 | `mode`('venue')、`region`('shanghai')、`selected`('venue')、`category`、`protectedIds`、`voltages`([500,220,110,35,10]) |
| 图层 | `buildings/labels/boundary`(true)、`topology`(false) |
| 播放 | `playing`(true)、`tour`(false)、`tick`(0) |
| 设备 | `exploded/cutaway`(false)、`component`('breaker') |
| 其他 | `camera`、`revision`(0)、`set` / `select` / `reset` |

`useSceneData()`：`useQuery(['scene-assets'])` 调 `fetchScene()`，`staleTime: Infinity`；effect 中 `request('/api/simulation')` 取首帧，再 `subscribeScene(onEvent, onStatus)`。`onEvent` 分派：`catalog` → 覆盖目录；`domain` 中仅 `alarm.created` 且 `playing` 时定位到告警资产（**其余 domain 事件被吞掉**）；`telemetry` 且 `playing` 时更新 `telemetry/tick`。

`useSimulation()`：offline 时 1s `setInterval` 本地 `telemetryAt(next)`；暂停拖动时 online 走 `fetchReplay(tick)`、offline 走 `telemetryAt(tick)`；`tour` 时每 12 tick 轮换 `city→grid→venue→equipment`。

`offline` 开关是全 app 唯一的 `import.meta.env` 使用点：`const offline = import.meta.env.VITE_DATA_MODE === 'offline'`（`useSceneData.ts:7`）。

`vite.config.ts`：`port 5187 / strictPort`、`CESIUM_BASE_URL='/cesium/'`、`envDir:'../..'`；代理 `/api`、`/models/uploaded`、`/ws`（`ws:true`）到 `API_PROXY_TARGET ?? 'http://localhost:8787'`；`manualChunks` 拆 `cesium / three / react`，无 `resolve.alias`、无 Cesium Vite 插件。`scripts/copy-cesium.mjs` 从 `node_modules/cesium/Build/Cesium` 复制 `Workers/Assets/Widgets/ThirdParty` 到 `public/cesium/`。

## 6. 关键业务能力落点

| 能力 | 落点 |
| --- | --- |
| 地址直达 | `hooks/useTwinRoute.ts` + 5 个 `pages/*/route.ts` |
| 图层筛选 | `App.tsx` 图层弹窗/图例 + store 字段 + `twin-engine` 的 `sync()` / `isAssetVisible()` |
| 拓扑联动 | `Topology.tsx` 的 `state.select()` → `App.tsx` 的 `selectedLine` → `CityScene` 的 `flyTo` |
| 实时快照 | `useSceneData.ts` + `api-client.subscribeScene` + `App.tsx` 顶栏状态/负荷 |
| 告警定位 | `useSceneData.ts` 的 `alarm.created` 分支 + `OperationsPanel`（`fetchAlarms` 5s 轮询、确认） |
| 时间回放 | `useSimulation()` + `App.tsx` 底部 `range`（`max=180`）/`fetchReplay`；只读，不改公共时钟 |
| 设备分解/剖视 | `EquipmentScene.animate()` / `pick()` + `App.tsx` 部件按钮与工具条 |
| 数据维护 | `OperationsPanel.tsx` 四个 tab（assets/lines/alarms/audit），写后统一 `fetchScene()` 回填 + 失效查询 |
| 快照导出 | `App.tsx` 的 `exportSnapshot()` 下载 `供电保障-演示快照.json` |

## 7. 设计取舍与已知缺口

1. **单体装配层**：`App.tsx` 891 行包含全部 DOM 与交互，`const state = useStore()` 无 selector，每秒 `tick` 会重渲染整棵组件树；`CityScene` 的 `subscribe` 同样在每次 store 变化时调用 `sync()`。
2. **两个同名 `revision`**：顶层 `State.revision`（`reset()` 递增，触发 `fly`）与 `catalog.revision`（`CityScene` 的 `key`，决定是否重建 Viewer），语义不同易混淆；后端 catalog 事件会连带重建 Viewer。
3. **路由常量未充分利用**：5 个 `route.ts` 中 `stationRoute.mode`、`deviceRoute.mode`、`protectionRoute.mode`、`alarmsRoute.path` 均未被引用；`/twin/area/:id`、`/twin/replay` 是裸字面量且 `changeMode` 不会生成。
4. **拾取 id 不一致**：`createCity` 生成的模型 entity id 为 `model-venue`，拾取特判却写 `'venue-model'`，且不在 `resolveBusinessId` 白名单内 → 点击场馆 GLB 不会触发选中。
5. **`onReady` 同步调用**：glTF 由 Cesium 异步加载，loading 态在模型真正就绪前即关闭；`createCity` 内部已 `fly('venue', true)`，挂载后又 `fly(mode, true)`，镜头飞行两次。
6. **硬编码演示值**：日期「2026.11.04 星期三」、天气「24° 上海 · 多云」、经纬度、`99.99/100/100` 三个 Gauge、柜内温度 `'58.6'/'28.6'`、`LoadChart` 的 24 点常量数组（与真实 `telemetry.load` 无关）；刻度也不一致（图表 `tick%240`、滑块 `max=180`、`telemetryAt` 告警周期 `tick%90`）。
7. **刻度与布局耦合**：`Topology.tsx` 的 `basePositions` 硬编码 8 个默认资产 id，后端目录增删资产时新增节点只能按 index 落到占位坐标。
8. **错误恢复脆弱**：`Login` 显示条件靠 `/登录|权限/` 匹配后端中文错误文案；无 `ErrorBoundary`；`Login.tsx` 与 `useTwinRoute.ts` 直接 `import from '@innodl/api-client'`，绕过 `src/api/client.ts` 适配层。
9. **重复初始化请求**：`useSceneData.ts` 与 `api-client.subscribeScene` 的 `onopen` 各请求一次 `/api/v1/simulation`。
10. **样式单点**：1838 行全局 CSS、大量 `!important` 覆盖 Cesium 内部 DOM；`styled-components` 只在 `Panel.tsx` 生效；`vite-env.d.ts` 未声明 `VITE_DATA_MODE` 类型。
11. **`copy-cesium.mjs` 幂等但非更新**：目录已存在即跳过，升级 Cesium 版本后静态资源不会刷新；`typecheck` 脚本不执行拷贝。
12. `reset()` 不清理 `dataError`、`protectedIds`、`tick`、`playing`、设备相关字段；初值 `mode:'venue'` 而 `reset()` 设为 `'city'`。
13. `disposeObject` 只释放 geometry 与 material，未处理 texture / renderTarget；`React.StrictMode` 下开发环境会走两轮 create/destroy（由 `alive` 标志兜底）。
