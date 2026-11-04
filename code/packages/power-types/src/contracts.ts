import type { Alarm, Asset, PowerLine, RegionId, Telemetry } from './index';
/** HTTP 响应封装；演示属性是数据来源标记，不表示服务为 mock。 */
export interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
  isDemoData: boolean;
  requestId: string;
}
export interface ApiError {
  error: { code: string; message: string; requestId: string };
}
export interface Region {
  id: RegionId;
  name: string;
}
export interface ModelBinding {
  assetId: string;
  modelUri: string;
  transform: { scale?: number; heading?: number; height?: number };
}
export interface SceneCatalog {
  assets: Asset[];
  lines: PowerLine[];
  regions: Region[];
  revision: number;
  modelBindings?: ModelBinding[];
}
export interface AlarmRecord extends Alarm {
  status: 'active' | 'resolved';
  acknowledgedAt: number | null;
  note: string | null;
}
export interface AuditEntry {
  id: number;
  action: string;
  entityId: string;
  timestamp: number;
  details: string;
}
export interface SimulationState {
  playing: boolean;
  tick: number;
}
export interface SceneEvent {
  type: 'telemetry';
  data: Telemetry;
  simulation: SimulationState;
  isDemoData: true;
}
export interface CatalogEvent {
  type: 'catalog';
  data: SceneCatalog;
}
export interface DomainEvent {
  type: 'domain';
  event: string;
  seq: number;
  timestamp: number;
  data: unknown;
}
export type ServerEvent = SceneEvent | CatalogEvent | DomainEvent;
export interface AssetFilter {
  regionId?: RegionId;
  type?: Asset['type'];
}
export interface HistoryQuery {
  assetId?: string;
  fromTick?: number;
  toTick?: number;
  limit?: number;
}
export type UserRole = 'admin' | 'protection_manager' | 'supervisor' | 'operator' | 'viewer';
export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
}
export interface ProtectionEvent {
  id: string;
  name: string;
  level: string;
  status: 'draft' | 'active' | 'completed';
  startsAt: number;
  endsAt: number;
  plan: string;
  assetIds: string[];
}
export interface WorkOrder {
  id: string;
  alarmId: string | null;
  assetId: string;
  eventId: string | null;
  title: string;
  assignee: string;
  status: 'pending' | 'processing' | 'resolved' | 'closed';
  feedback: string;
  createdAt: number;
  updatedAt: number;
}
export interface SceneConfiguration {
  id: string;
  name: string;
  mode: string;
  configuration: {
    camera: { targetAssetId: string; duration: number };
    layers: { buildings: boolean; labels: boolean; boundary: boolean };
    models: { venue: string; equipment: string };
  };
  revision: number;
}
