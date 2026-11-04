# 06 · 子项目代码架构：`@innodl/twin-engine`

> 路径：`packages/twin-engine/` · 定位：Cesium 城市场景渲染内核 · 依赖 `power-types`、`shared-utils`、`cesium 1.132.0`
> `exports: "./src/index.ts"`（源码直出）；构建 `tsup src/index.ts --format esm --dts`

## 1. 包结构与公开 API

`src/index.ts` 只有 3 行桶文件，**公开导出仅 6 个符号**：

```ts
export * from './scenes/createCity';   // createCity
export * from './bindings/types';      // type EngineState, type EngineBindings
export * from './camera/presets';      // type CameraSnapshot, captureCamera, restoreCamera
```

| 文件 | 行数 | 导出 | 说明 |
| --- | ---: | --- | --- |
| `scenes/createCity.ts` | 352 | `createCity` | 核心：Cesium Viewer + 全部几何/图层/拾取/同步 |
| `bindings/types.ts` | 18 | `EngineState`、`EngineBindings` | 引擎与业务的唯一契约 |
| `camera/presets.ts` | 35 | `CameraSnapshot`、`captureCamera`、`restoreCamera` | 镜头快照读写（真实 Cesium API） |
| `core/lifecycle.ts` | 12 | `createDisposer` | 逆序、幂等执行销毁闭包 |
| `layers/visibility.ts` | 14 | `isAssetVisible` | 资产三重可见性判定 |
| `models/bindings.ts` | 10 | `resolveModelBindings` | 模型绑定解析 + 本地 GLB 降级 |
| `effects/voltage-colors.ts` | 7 | `colors` | 5 档电压配色 |
| `interactions/pick.ts` | 8 | `resolveBusinessId` | 拾取 id 白名单校验 |

后 5 个辅助模块**未从包入口导出**，只被 `createCity.ts` 内部 import。包内**没有 Three.js**（`three` 在 `apps/twin-screen` 层）。

## 2. 解耦设计：状态读取 + 选择回调

```ts
export interface EngineState {
  catalog: SceneCatalog; telemetry: Telemetry; tick: number; region: RegionId;
  category?: AssetType; protectedIds?: string[]; selected: string;
  voltages: number[]; buildings: boolean; labels: boolean; boundary: boolean;
}
export interface EngineBindings {
  getState: () => EngineState;
  select: (assetId: string) => void;
}
```

引擎**不 import `@innodl/api-client`、不发 HTTP/WS、不读 zustand**；只通过 `getState()` 单向读业务状态、`select(id)` 回写选中。调用方在 `apps/twin-screen/src/engine/CityScene.tsx` 注入：

```ts
createCity(container, onReady, onError, {
  getState: useStore.getState,
  select: (id) => useStore.getState().select(id),
});
```

再由 `useStore.subscribe(...)` 在状态变化时调 `scene.sync()` / `scene.fly(mode)`。

## 3. `createCity` 实现

签名：

```ts
createCity(container, onReady, onError, bindings)
  : { viewer: C.Viewer; fly(mode, instant?): void; sync(): void; destroy(): void }
```

**坐标框架**：`origin = Cartesian3.fromDegrees(121.302, 31.188)`（上海国家会展中心），`frame = Transforms.eastNorthUpToFixedFrame(origin)`，私有 `world(x,y,z)` 用 `Matrix4.multiplyByPoint` 把 ENU 米制坐标转 WGS84。

**Viewer 配置**：关闭 baseLayer / 全部默认控件 / skyBox / skyAtmosphere / fog，`requestRenderMode:true`、`maximumRenderTimeChange:Infinity`、`DirectionalLight` 强度 2、`resolutionScale = min(devicePixelRatio, 1.5)`、缩放范围 220–45000、背景 `#081d2b`。

**4 个 `CustomDataSource`**：`buildings` / `networks` / `pois` / `boundary`。

**程序化几何**（无外部 GIS 数据）：固定伪随机 `seed=841`（Lehmer `seed*16807 % 2147483647`）循环 3400 次生成 `BoxGeometry` 实例，汇成**单个 `Primitive`**（`PerInstanceColorAppearance`，`asynchronous:false`），跳过中心 660m 与河道带；`-20..20` 横纵道路 82 条 polyline；60 点正弦河流（宽 55）；核心区 ±610m 方形 boundary（polygon + `PolylineGlowMaterialProperty` + wall）。

**资产图层**：每个资产在 `pois` 建 `point`(pixelSize 9) + `label`(pixelOffset `(0,-42)`，`DistanceDisplayCondition(0,55000)`) + 竖直 polyline 到 160m；`substation` 额外在 `buildings` 加 90×65×45 box。

**线路图层**：`networks` 中每条线建 3 点折角 glow polyline（高 45），颜色取 `colors[voltage]` = `{500:'#ff6382',220:'#ffcc76',110:'#32e7c1',35:'#45b9ff',10:'#a78bfa'}`；额外建 `flow-${id}` 白色流动点，由 `CallbackPositionProperty` 按 `performance.now()/4200` 三段线性插值驱动。

**glTF 模型**：`resolveModelBindings(catalog)` 返回 `modelBindings`，无配置时降级为 `[{assetId:'venue', modelUri:'/models/exhibition-center.glb', transform:{scale:1}}]`；每个绑定用 `viewer.entities.add({model:{uri, scale, minimumPixelSize:100, shadows:DISABLED}})`。

| 私有函数 | 行为 |
| --- | --- |
| `fly(mode, instant)` | `radius = venue?1750 : grid?10000 : 13000`，`camera.flyToBoundingSphere(BoundingSphere(origin,radius), {duration: instant?0:1.8, offset: HeadingPitchRange(5°/15°, -48°, radius*2)})` |
| `sync()` | 读 `getState()`：控制 `city/buildings/boundary.show`；逐资产 `isAssetVisible`（`protectedIds` ∩ `region` ∩ `category`）、`label.show = labels`、`point.color`（正常 `#26e6a0` / 异常 `#f8bf58`）、选中 15px；逐线路按 `voltages` 与两端可见性显隐、`lineStatus` 决定颜色、选中宽度 7；模型按 `category`/`protectedIds` 显隐；末尾 `scene.requestRender()` |
| 拾取 | `ScreenSpaceEventHandler.LEFT_CLICK` → `scene.pick` → `Entity` → `'venue-model'` 特判 → `resolveBusinessId` 白名单 → `bindings.select(id)` |
| 初始化尾部 | `fly('venue', true); sync(); onReady();`（`onReady` 同步调用） |
| `destroy` | `createDisposer([viewer.destroy, handler.destroy, removeError])` |

`camera/presets.ts` 的 `captureCamera` 从 `camera.positionCartographic`（`Math.toDegrees`）读经纬高与 heading/pitch/roll，`restoreCamera` 用 `camera.setView` 写回。

## 4. 设计取舍与已知缺口

1. **真实实现而非抽象桩**：直接使用 Cesium 的 `Viewer`、`CustomDataSource`、`GeometryInstance`、`Primitive`、`PolylineGlowMaterialProperty`、`CallbackPositionProperty`、`ScreenSpaceEventHandler`；`dist/index.js` 12.81 KB 保留 `import * as C from "cesium"` 为外部依赖。
2. **初始化时一次性解构目录**：`const {assets, lines} = bindings.getState().catalog` 后建实体；`sync()` 只更新**显隐与样式**，不增删实体。catalog 事件带来的资产/线路增删必须靠 `catalog.revision` 改变 `CityScene` 的 key 重建 Viewer 才能反映。
3. **拾取命名不一致**：生成的模型 entity id 是 `` `model-${assetId}` ``（默认 `model-venue`），拾取特判写的是 `'venue-model'`，且模型 id 不在 `[...assets,...lines]` 白名单内 → 点击场馆 GLB 不会触发 `select`。
4. **`onReady` 时机过早**：`viewer.entities.add` 的 glTF 由 Cesium 异步加载，`onReady()` 在模型就绪前即被调用，加载态会提前消失。
5. **双重 fly**：`createCity` 内部已 `fly('venue', true)`，`CityScene` 挂载后再 `fly(mode, true)`。
6. **Cesium 类型泄漏**：`createCity` 返回的 `viewer: C.Viewer`、`captureCamera(viewer: C.Viewer)` 把第三方类型直接暴露给业务层，`dist/index.d.ts` 顶部就 `import * as C from 'cesium'`；`CityScene.tsx` 也直接 `import { HeadingPitchRange } from 'cesium'`，削弱了解耦边界。
7. **辅助模块未导出**：`createDisposer`、`isAssetVisible`、`colors`、`resolveBusinessId` 等无法被包外复用或单测；只能随 `createCity` 一起被打包。
8. **固定演示坐标系与配色**：`121.302/31.188`、`#081d2b` 背景、5 档电压色、3400 栋建筑全部硬编码；无图层配置注入、无 LOD/3D Tiles 支持、无性能自适应。
9. **`sync()` 全量遍历**：每次 store 变化（含每秒 tick）都遍历全部资产/线路/模型并 `requestRender()`，未做脏标记。
