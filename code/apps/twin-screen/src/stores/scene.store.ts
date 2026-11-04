import type { CameraSnapshot } from '@innodl/twin-engine';
import { create } from 'zustand';
import {
  type AssetType,
  type RegionId,
  type SceneMode,
  type SceneCatalog,
  type Telemetry,
} from '@innodl/power-types';
import { assets, lines, regionNames, telemetryAt } from '@innodl/shared-utils';
interface State {
  camera?: CameraSnapshot;
  catalog: SceneCatalog;
  telemetry: Telemetry;
  connection: 'connecting' | 'online' | 'offline' | 'error';
  dataError: string;
  mode: SceneMode;
  region: RegionId;
  selected: string;
  category: AssetType | undefined;
  protectedIds?: string[];
  voltages: number[];
  buildings: boolean;
  labels: boolean;
  boundary: boolean;
  topology: boolean;
  playing: boolean;
  tour: boolean;
  tick: number;
  exploded: boolean;
  cutaway: boolean;
  component: string;
  revision: number;
  set: (patch: Partial<Omit<State, 'set' | 'select' | 'reset'>>) => void;
  select: (id: string) => void;
  reset: () => void;
}
export const useStore = create<State>((set) => ({
  catalog: {
    assets,
    lines,
    regions: Object.entries(regionNames).map(([id, name]) => ({ id: id as RegionId, name })),
    revision: 0,
  },
  telemetry: telemetryAt(0),
  connection: 'connecting',
  dataError: '',
  mode: 'venue',
  region: 'shanghai',
  selected: 'venue',
  category: undefined,
  voltages: [500, 220, 110, 35, 10],
  buildings: true,
  labels: true,
  boundary: true,
  topology: false,
  playing: true,
  tour: false,
  tick: 0,
  exploded: false,
  cutaway: false,
  component: 'breaker',
  revision: 0,
  /** 更新局部业务状态。
   * @param patch 需要合并的状态字段。
   * @returns 无返回值，订阅组件自动更新。
   */
  set: (patch) => set(patch),
  /** 联动资产选择。
   * @param id 资产或线路的唯一标识。
   * @returns 无返回值，更新共享选择状态。
   */
  select: (id) => set({ selected: id }),
  /** 返回全景并恢复默认可见图层。
   * @returns 无返回值，恢复场景与筛选状态。
   */
  reset: () =>
    set((state) => ({
      mode: 'city',
      region: 'shanghai',
      selected: 'venue',
      category: undefined,
      voltages: [500, 220, 110, 35, 10],
      buildings: true,
      labels: true,
      boundary: true,
      topology: false,
      tour: false,
      revision: state.revision + 1,
    })),
}));
