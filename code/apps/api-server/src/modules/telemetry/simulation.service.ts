import { type Telemetry, type SimulationState } from '@innodl/power-types';
import { telemetryAt } from '@innodl/shared-utils';
import type { Repository } from '../../repositories/repository';
/** 建立拥有唯一权威时钟的模拟服务。
 * @param repository 持久化场景仓储。
 * @param onChange 每次提交快照后的推送回调。
 * @param transform 可选测点采集与规则检测流程。
 * @returns 查询、推进、暂停及回放控制函数。
 */
export function createSimulation(
  repository: Repository,
  onChange: (snapshot: Telemetry, state: SimulationState) => void,
  transform?: (snapshot: Telemetry) => Promise<Telemetry>,
) {
  /** 生成与当前资产目录匹配的模拟快照。
   * @param tick 确定性模拟秒数。
   * @returns 排除已删除资产告警的遥测。
   */
  async function snapshotAt(tick: number) {
    const result = telemetryAt(tick);
    const ids = new Set((await repository.assets()).map((asset) => asset.id));
    return { ...result, alarms: result.alarms.filter((alarm) => ids.has(alarm.assetId)) };
  }
  let pending: Promise<unknown> = Promise.resolve();
  /** 串行提交时钟事务，失败不会阻塞后续采集。
   * @param operation 待执行的采集或控制事务。
   * @returns 该事务自身的结果 Promise。
   */
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = pending.then(operation);
    pending = task.catch(() => undefined);
    return task;
  }
  return {
    /** 推进模拟时钟；暂停状态下保持不变。
     * @returns 当前有效遥测快照。
     */
    async advance() {
      return serial(async () => {
        const state = await repository.simulation();
        if (!state.playing) return repository.latest();
        const next = { ...state, tick: state.tick + 1 };
        const original = await snapshotAt(next.tick);
        const snapshot = transform ? await transform(original) : original;
        await repository.record(snapshot, next);
        onChange(snapshot, next);
        return snapshot;
      });
    },
    /** 控制模拟运行或跳转，状态持久化后再广播。
     * @param patch 运行标志及可选 tick。
     * @returns 当前模拟状态与遥测快照。
     */
    async control(patch: Partial<SimulationState>) {
      return serial(async () => {
        const next = { ...(await repository.simulation()), ...patch };
        const original = await snapshotAt(next.tick);
        const snapshot = transform ? await transform(original) : original;
        await repository.record(snapshot, next);
        onChange(snapshot, next);
        return { simulation: next, telemetry: snapshot };
      });
    },
    /** 生成只读回放快照，不改变公共模拟时钟。
     * @param tick 指定回放秒数。
     * @returns 回放遥测快照。
     */
    replay(tick: number) {
      return snapshotAt(tick);
    },
  };
}
