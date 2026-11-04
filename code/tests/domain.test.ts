import { describe, expect, it } from 'vitest';
import {
  assets,
  lines,
  filterAssets,
  telemetryAt,
  assetStatus,
  lineStatus,
} from '../packages/shared-utils/src';
describe('跨视图资产一致性', () => {
  it('每条线路的两端均能解析为唯一资产', () => {
    const ids = assets.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const line of lines) {
      expect(ids).toContain(line.fromId);
      expect(ids).toContain(line.toId);
    }
  });
  it('核心区域与资源类型取交集', () => {
    const result = filterAssets('core', 'substation');
    expect(result.map((a) => a.id)).toEqual(['station-a', 'station-b']);
    expect(filterAssets('hongqiao', 'hotel')).toEqual([]);
  });
  it('回放同一秒得到相同快照，告警在30秒触发55秒恢复', () => {
    expect(telemetryAt(42)).toEqual(telemetryAt(42));
    expect(telemetryAt(29).alarms).toHaveLength(0);
    expect(assetStatus('station-a', telemetryAt(30))).toBe('attention');
    expect(lineStatus(lines[0], telemetryAt(30))).toBe('attention');
    expect(assetStatus('station-a', telemetryAt(55))).toBe('normal');
    expect(lineStatus(lines[0], telemetryAt(55))).toBe('normal');
  });
  it('遥测数值在设计范围内波动', () => {
    for (let tick = 0; tick < 3600; tick++) {
      const t = telemetryAt(tick);
      expect(t.load).toBeGreaterThan(58);
      expect(t.load).toBeLessThan(67);
      expect(t.voltage).toBeGreaterThan(10.3);
    }
  });
});
