import type { AssetType, RegionId, SceneCatalog, Telemetry } from '@innodl/power-types';
export interface EngineState {
  catalog: SceneCatalog;
  telemetry: Telemetry;
  tick: number;
  region: RegionId;
  category?: AssetType;
  protectedIds?: string[];
  selected: string;
  voltages: number[];
  buildings: boolean;
  labels: boolean;
  boundary: boolean;
}
export interface EngineBindings {
  getState: () => EngineState;
  select: (assetId: string) => void;
}
