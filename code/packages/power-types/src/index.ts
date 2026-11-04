/** 场景书签类型。 */
export type SceneMode = 'city' | 'grid' | 'venue' | 'equipment';
export type AssetType = 'venue' | 'substation' | 'transport' | 'hotel' | 'switchgear' | 'transformer' | 'sensor' | 'feeder';
export type Status = 'normal' | 'attention' | 'alarm';
export type RegionId = string;
export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  region: RegionId;
  position: [number, number, number];
  voltage: number;
  capacity: number;
  status: Status;
}
export interface PowerLine {
  id: string;
  name: string;
  fromId: string;
  toId: string;
  voltage: number;
  status: Status;
  load: number;
}
export interface Alarm {
  id: string;
  assetId: string;
  message: string;
  severity: 'attention' | 'alarm';
  timestamp: number;
}
export interface Telemetry {
  tick: number;
  timestamp: number;
  load: number;
  voltage: number;
  current: number;
  alarms: Alarm[];
}
export type * from './contracts';
