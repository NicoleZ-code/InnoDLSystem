# 13 · 子项目代码架构：`tooling/model-converter`

> 路径：`tooling/model-converter/` · `generate-demo-models.py`（197 行）+ `README.md`
> **该目录没有 `package.json`**，不属于 pnpm workspace（workspace glob `tooling/*` 只匹配含包清单的目录）；是纯 Python 离线工具。

## 1. 定位

按 glTF 2.0 / GLB 二进制格式，**用纯 Python 标准库**（`struct` / `json` / `math` / `pathlib`）程序化生成两个演示模型，不依赖 Blender、Cesium ion 或任何第三方 3D 工具：

| 产物 | 大小 | 消费方 |
| --- | ---: | --- |
| `apps/twin-screen/public/models/exhibition-center.glb` | 190,512 B（186 KB） | `twin-engine/src/models/bindings.ts` 默认 `modelUri`，由 Cesium 在城市/场馆场景加载 |
| `apps/twin-screen/public/models/switchgear.glb` | 43,996 B（43 KB） | `twin-screen/src/engine/EquipmentScene.tsx` 的 `GLTFLoader` |

同样的两个文件也复制在 `assets/expo/exhibition-center.glb` 与 `assets/equipment/switchgear.glb`（`tests/postgres.test.ts:222` 用前者作为上传字节源，`tests/models.test.ts` 读后者校验结构）。

## 2. 代码结构

`class GLB` 提供一组把几何追加进 glTF JSON + 二进制 chunk 的方法：

| 方法 | 作用 |
| --- | --- |
| `material(...)` | 追加 PBR 材质 |
| `accessor(...)` | 追加 bufferView / accessor（顶点、法线、索引） |
| `mesh(...)` | 组装 primitive 与 mesh |
| `box(...)` | 生成带名称的长方体节点（柜体、门、表计、断路器、铜排、把手等） |
| `disc(...)` | 生成圆盘/表盘几何 |
| `save(path)` | 按 GLB 规范写 12 字节头（magic `0x46546c67`、version 2、声明长度）+ JSON chunk + BIN chunk |

节点命名遵循 **`kind-index`** 约定，例如 `cabinet-0`、`breaker-0`、`busbar-0-1`、`handle-0`、`meter-0`、`door-0`、`floor-0`。这个约定被三处代码依赖：

1. `EquipmentScene.tsx` 的 `pick()`：`hit.object.name.split('-')[0]` 得到 `kind` 写入 `state.component`；
2. `EquipmentScene.tsx` 的 `animate()`：`parseInt(name.split('-')[1])` 得到 index 用于分解位移 `(index-1.5)*0.38`，并按 kind 决定隐藏/位移方向；
3. `App.tsx` 的 `componentNames` 映射（7 项中文名）与部件按钮（4 项）。

`tests/models.test.ts` 校验：GLB magic、声明长度一致、nodes 名称唯一、`busbar-` 前缀节点共 **12** 个。

## 3. 交付边界

`README.md` 与各 `assets/*/README.md` 明确：

- 单位为米，模型是**演示几何**，不是测绘数据、不是站房 BIM、不是实物设备扫描；
- **通用 IFC / Revit / 倾斜摄影 → 3D Tiles 转换不在当前交付范围**；
- `assets/city/README.md` 声明「当前无授权 GIS / 3D Tiles 数据」，城市底座（3400 栋建筑、道路、河流、边界）由 `twin-engine/src/scenes/createCity.ts` 程序化生成；
- `assets/stations/README.md` 是站房 BIM/GLB 的**预留目录**，尚无正式资产；
- `assets/` 与 `data/` 下**没有任何独立纹理文件**（无 `.png/.jpg/.ktx2/.webp`），材质为纯色。

`code/data/models/` 下另有 3 个 UUID 命名的 `.glb`（均 190,512 B，与 `exhibition-center.glb` 相同），是 API 上传流程落盘的结果（`scenes.routes.ts` 的 `storage = resolve('data/models')`），不是本工具直接产出。

## 4. 设计取舍与已知缺口

1. **命名约定是隐式契约**：`kind-index` 没有写进 `power-types` 或任何共享常量，Python 生成器、Three.js 场景、React 部件清单三处各维护一份；`App.tsx` 的 `componentNames`（7 项）与实际按钮（4 项）已不一致。
2. **无纹理 / 无 PBR 贴图 / 无动画 / 无 LOD**：视觉表现依赖 `EquipmentScene` 运行时补充的 `EdgesGeometry` 描边与 emissive 高亮。
3. **不在 workspace 中**：没有 `package.json`、不参与 `turbo run build`、无 npm 脚本；修改模型需手动运行 Python 并同步复制到 `public/models/` 与 `assets/`，容易漏拷。
4. **无参数化**：尺寸、颜色、节点数量写死在脚本里，无法按配置生成不同规格设备。
5. **无 CI 校验**：`tests/models.test.ts` 只检查生成结果的 GLB 头与节点名，不校验 Python 脚本可重复生成或与产物一致。
6. 若后续接入真实 BIM/3D Tiles，建议保留本工具作为「离线演示资产生成器」，另建独立转换流水线，避免把格式转换逻辑塞进本目录。
