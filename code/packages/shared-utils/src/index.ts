import type { Asset, PowerLine, RegionId, AssetType, Telemetry, Status } from '@innodl/power-types';
export const assets: Asset[] = [
  {
    id: 'venue',
    name: '国家会展中心',
    type: 'venue',
    region: 'core',
    position: [121.302, 31.188, 20],
    voltage: 10,
    capacity: 128,
    status: 'normal',
  },
  {
    id: 'station-a',
    name: '诸光变电站',
    type: 'substation',
    region: 'core',
    position: [121.285, 31.199, 20],
    voltage: 110,
    capacity: 160,
    status: 'normal',
  },
  {
    id: 'station-b',
    name: '会展中心站',
    type: 'substation',
    region: 'core',
    position: [121.318, 31.185, 20],
    voltage: 110,
    capacity: 160,
    status: 'normal',
  },
  {
    id: 'station-c',
    name: '虹桥变电站',
    type: 'substation',
    region: 'hongqiao',
    position: [121.343, 31.205, 20],
    voltage: 220,
    capacity: 240,
    status: 'normal',
  },
  {
    id: 'station-d',
    name: '徐泾变电站',
    type: 'substation',
    region: 'shanghai',
    position: [121.263, 31.175, 20],
    voltage: 500,
    capacity: 750,
    status: 'normal',
  },
  {
    id: 'station-e',
    name: '蟠龙变电站',
    type: 'substation',
    region: 'shanghai',
    position: [121.28, 31.228, 20],
    voltage: 220,
    capacity: 240,
    status: 'normal',
  },
  {
    id: 'transport',
    name: '虹桥综合交通枢纽',
    type: 'transport',
    region: 'hongqiao',
    position: [121.331, 31.196, 20],
    voltage: 35,
    capacity: 60,
    status: 'normal',
  },
  {
    id: 'hotel',
    name: '洲际酒店保障点',
    type: 'hotel',
    region: 'core',
    position: [121.306, 31.18, 20],
    voltage: 10,
    capacity: 12,
    status: 'normal',
  },
];
export const lines: PowerLine[] = [
  {
    id: 'line-a',
    name: '诸光—会展 Ⅰ线',
    fromId: 'station-a',
    toId: 'venue',
    voltage: 110,
    status: 'normal',
    load: 62.4,
  },
  {
    id: 'line-b',
    name: '会展—场馆 Ⅱ线',
    fromId: 'station-b',
    toId: 'venue',
    voltage: 110,
    status: 'normal',
    load: 58.1,
  },
  {
    id: 'line-c',
    name: '虹桥—会展联络线',
    fromId: 'station-c',
    toId: 'station-b',
    voltage: 220,
    status: 'normal',
    load: 48.7,
  },
  {
    id: 'line-d',
    name: '徐泾—诸光主干线',
    fromId: 'station-d',
    toId: 'station-a',
    voltage: 500,
    status: 'normal',
    load: 71.2,
  },
  {
    id: 'line-e',
    name: '蟠龙—诸光联络线',
    fromId: 'station-e',
    toId: 'station-a',
    voltage: 220,
    status: 'normal',
    load: 42.5,
  },
  {
    id: 'line-f',
    name: '虹桥枢纽专线',
    fromId: 'station-c',
    toId: 'transport',
    voltage: 35,
    status: 'normal',
    load: 36.8,
  },
  {
    id: 'line-g',
    name: '酒店保障专线',
    fromId: 'venue',
    toId: 'hotel',
    voltage: 10,
    status: 'normal',
    load: 29.3,
  },
];
export const regionNames: Record<RegionId, string> = {
  shanghai: '上海全网',
  core: '核心保电区',
  hongqiao: '虹桥枢纽区',
};
/** 根据区域筛选资产，上海全网包含全部演示对象。
 * @param region 当前区域标识。
 * @param type 可选资源类别。
 * @returns 满足区域及类别约束的资产数组。
 */
export function filterAssets(region: RegionId, type?: AssetType): Asset[] {
  return assets.filter(
    (asset) => (region === 'shanghai' || asset.region === region) && (!type || asset.type === type),
  );
}
/** 生成可重复的遥测快照，演示告警以周期产生并自动恢复。
 * @param tick 回放时间轴上的整数秒。
 * @returns 包含负荷、电压、电流与活动告警的遥测快照。
 */
export function telemetryAt(tick: number): Telemetry {
  const load = 62.4 + Math.sin(tick / 13) * 4.2;
  const active = tick % 90 >= 30 && tick % 90 < 55;
  return {
    tick,
    timestamp: Date.UTC(2026, 10, 4, 1, 0, 0) + tick * 1000,
    load,
    voltage: 10.48 + Math.sin(tick / 7) * 0.08,
    current: 432 + Math.sin(tick / 11) * 23,
    alarms: active
      ? [
          {
            id: `alarm-${Math.floor(tick / 90)}`,
            assetId: 'station-a',
            message: '诸光站 1# 柜温度偏高，请安排巡检',
            severity: 'attention',
            timestamp: Date.UTC(2026, 10, 4, 1, 0, 30) + Math.floor(tick / 90) * 90000,
          },
        ]
      : [],
  };
}
/** 计算资产实时状态，基础状态与遥测告警统一映射。
 * @param assetId 资产唯一标识。
 * @param telemetry 当前遥测快照。
 * @returns normal、attention 或 alarm 状态。
 */
export function assetStatus(assetId: string, telemetry: Telemetry): Status {
  return telemetry.alarms.find((alarm) => alarm.assetId === assetId)?.severity ?? 'normal';
}
/** 获取线路实时状态。
 * @param line 供电关系。
 * @param telemetry 当前遥测数据。
 * @returns 由端点告警映射的线路状态。
 */
export function lineStatus(line: PowerLine, telemetry: Telemetry): Status {
  return assetStatus(line.fromId, telemetry) !== 'normal'
    ? assetStatus(line.fromId, telemetry)
    : assetStatus(line.toId, telemetry);
}

/** 对任意来源的目录进行区域与类别交集筛选。
 * @param source 当前已加载资产数组。
 * @param region 目标区域，shanghai 表示全网。
 * @param type 可选资源类型。
 * @returns 满足过滤条件的资产数组。
 */
export function filterCatalogAssets(source: Asset[], region: RegionId, type?: AssetType): Asset[] {
  return source.filter(
    (asset) => (region === 'shanghai' || asset.region === region) && (!type || asset.type === type),
  );
}
