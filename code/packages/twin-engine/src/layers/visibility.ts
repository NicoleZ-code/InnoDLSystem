import type { Asset } from '@innodl/power-types';
import type { EngineState } from '../bindings/types';
/** 统一空间图层与业务列表的可见性条件。
 * @param asset 当前资产。
 * @param state 从应用注入的业务状态。
 * @returns 是否属于当前区域、资产类型和保电活动。
 */
export function isAssetVisible(asset: Asset, state: EngineState): boolean {
  return (
    (!state.protectedIds || state.protectedIds.includes(asset.id)) &&
    (state.region === 'shanghai' || asset.region === state.region) &&
    (!state.category || asset.type === state.category)
  );
}
