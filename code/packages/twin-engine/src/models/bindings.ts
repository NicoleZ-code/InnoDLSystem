import type { ModelBinding, SceneCatalog } from '@innodl/power-types';
/** 读取已发布模型配置，无配置时使用本地演示场馆。
 * @param catalog 后端统一资产与发布配置。
 * @returns 与业务资产关联的模型绑定列表。
 */
export function resolveModelBindings(catalog: SceneCatalog): ModelBinding[] {
  return catalog.modelBindings?.length
    ? catalog.modelBindings
    : [{ assetId: 'venue', modelUri: '/models/exhibition-center.glb', transform: { scale: 1 } }];
}
