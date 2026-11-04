import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../apps/api-server/src/app';
import type { Asset, PowerLine, ServerEvent } from '../packages/power-types/src';
const instances: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  for (const { app } of instances.splice(0)) await app.close();
});
/** 建立隔离后端测试实例。
 * @param file 数据库位置，默认内存数据库。
 * @returns 关闭后可安全丢弃的后端实例。
 */
async function setup(file = ':memory:') {
  const instance = await buildApp({ databaseFile: file, intervalMs: 0 });
  instances.push(instance);
  return instance;
}
const newAsset: Asset = {
  id: 'test-station',
  name: '测试变电站',
  type: 'substation',
  region: 'core',
  position: [121.31, 31.19, 20],
  voltage: 110,
  capacity: 160,
  status: 'normal',
};
describe('后端完整业务与持久化', () => {
  it('初始化幂等，接口过滤及错误封装符合约定', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    const scene = (await app.inject('/api/catalog/shanghai')).json();
    expect(scene.data.assets).toHaveLength(8);
    expect(scene.data.lines).toHaveLength(7);
    expect(scene.requestId).toBeTruthy();
    const filtered = (await app.inject('/api/assets?regionId=core&type=substation')).json();
    expect(filtered.data.items.map((a: Asset) => a.id)).toEqual(['station-a', 'station-b']);
    expect((await app.inject('/api/assets?regionId=invalid!')).statusCode).toBe(400);
    expect((await app.inject('/api/telemetry/history?limit=100000')).statusCode).toBe(400);
    expect((await app.inject('/api/catalog/unknown')).statusCode).toBe(404);
  });
  it('资产与线路 CRUD、关系保护和事务审计一致', async () => {
    const { app, repository } = await setup();
    expect(
      (await app.inject({ method: 'POST', url: '/api/assets', payload: newAsset })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'POST', url: '/api/assets', payload: newAsset })).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/assets/test-station',
          payload: { ...newAsset, name: '已更新测试站' },
        })
      ).statusCode,
    ).toBe(200);
    const line: PowerLine = {
      id: 'test-line',
      name: '测试线路',
      fromId: 'test-station',
      toId: 'venue',
      voltage: 110,
      status: 'normal',
      load: 10,
    };
    expect(
      (await app.inject({ method: 'POST', url: '/api/power-lines', payload: line })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/assets/test-station' })).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/power-lines',
          payload: { ...line, id: 'broken', toId: 'missing' },
        })
      ).statusCode,
    ).toBe(422);
    expect((await repository.catalog()).lines.some((item) => item.id === 'broken')).toBe(false);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/power-lines/test-line' })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/assets/test-station' })).statusCode,
    ).toBe(200);
    expect(await repository.audit(50)).toHaveLength(5);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/assets',
          payload: { ...newAsset, position: [200, 31, 20] },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('暂停、告警确认、恢复、历史和只读回放保持一致', async () => {
    const { app, simulation, repository } = await setup();
    await simulation.control({ tick: 30, playing: false });
    expect((await simulation.advance()).tick).toBe(30);
    const alarms = (await app.inject('/api/alarms?status=active')).json().data.items;
    expect(alarms).toHaveLength(1);
    const ack = await app.inject({
      method: 'POST',
      url: `/api/alarms/${alarms[0].id}/acknowledge`,
      payload: { note: '已安排巡检' },
    });
    expect(ack.json().data.acknowledgedAt).toBeTypeOf('number');
    expect((await repository.latest()).alarms).toHaveLength(1);
    await simulation.control({ tick: 55 });
    const records = await repository.alarms('resolved');
    expect(records).toHaveLength(1);
    expect(records[0].note).toBe('已安排巡检');
    const replay = (await app.inject('/api/telemetry/replay?tick=35')).json().data;
    expect(replay.alarms).toHaveLength(1);
    expect((await repository.simulation()).tick).toBe(55);
    expect(
      (await app.inject('/api/telemetry/history?fromTick=0&toTick=55')).json().data.items,
    ).toHaveLength(3);
  });
  it('文件数据库重启后保留资产、模拟时钟及告警确认', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'innodl-api-'));
    try {
      const first = await setup(join(folder, 'app.sqlite'));
      await first.repository.saveAsset(newAsset, true);
      await first.simulation.control({ tick: 35, playing: false });
      await first.repository.acknowledge('alarm-0', '已现场核查');
      await first.app.close();
      instances.splice(instances.indexOf(first), 1);
      const second = await setup(join(folder, 'app.sqlite'));
      expect(await second.repository.assets()).toHaveLength(9);
      expect(await second.repository.simulation()).toEqual({ tick: 35, playing: false });
      expect((await second.repository.alarms())[0].note).toBe('已现场核查');
      expect(await second.repository.audit(50)).toHaveLength(2);
    } finally {
      for (const instance of instances.splice(0)) await instance.app.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it('WebSocket 推送完整遥测和目录变更，断线后释放连接', async () => {
    const { app, simulation } = await setup();
    const socket = await app.injectWS('/ws/scene-events');
    const received: ServerEvent[] = [];
    socket.on('message', (data) => received.push(JSON.parse(data.toString())));
    await simulation.control({ tick: 35 });
    await app.inject({ method: 'POST', url: '/api/assets', payload: newAsset });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received.some((event) => event.type === 'telemetry' && event.data.tick === 35)).toBe(
      true,
    );
    expect(
      received.some(
        (event) => event.type === 'catalog' && event.data.assets.some((a) => a.id === newAsset.id),
      ),
    ).toBe(true);
    socket.close();
  });
});
