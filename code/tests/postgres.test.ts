import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userInfo } from 'node:os';
import { Pool } from 'pg';
import { buildApp } from '../apps/api-server/src/app';
const url =
  process.env.TEST_DATABASE_URL ??
  `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/innodl_system`;
const schema = `test_innodl_${Date.now()}`;
let service: Awaited<ReturnType<typeof buildApp>>;
let token = '';
let alarmId = '';
let orderId = '';
/** 发送包含测试会话的 API 请求。
 * @param method HTTP 方法。
 * @param path 版本化资源路径。
 * @param payload 可选请求数据。
 * @returns Fastify 注入响应。
 */
async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  payload?: unknown,
) {
  return service.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: payload as Record<string, unknown>,
  });
}
// 真实 PostgreSQL 集成测试只使用专属 schema，不修改开发业务表。
describe('方案 B PostgreSQL 纵向业务验收', () => {
  beforeAll(async () => {
    service = await buildApp({
      databaseUrl: url,
      schema,
      intervalMs: 0,
      bootstrapPassword: 'Test-Only-InnoDL-2026!',
    });
    const login = await service.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Test-Only-InnoDL-2026!' },
    });
    expect(login.statusCode).toBe(200);
    token = login.json().data.token;
  }, 30000);
  afterAll(async () => {
    if (service) await service.app.close();
    const pool = new Pool({ connectionString: url });
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }, 30000);
  it('未登录拒绝资源访问，登录返回 HttpOnly 轮换 Cookie', async () => {
    expect((await service.app.inject('/api/v1/assets')).statusCode).toBe(401);
    const result = await service.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Test-Only-InnoDL-2026!' },
    });
    expect(result.headers['set-cookie']).toContain('HttpOnly');
    const refresh = await service.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: String(result.headers['set-cookie']).split(';')[0] },
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().data.token).toBeTruthy();
  });
  it('资产目录和测点规则由 PostgreSQL 与 Prisma 读取', async () => {
    const assets = await call('GET', '/assets');
    expect(assets.statusCode).toBe(200);
    expect(assets.json().data.items).toHaveLength(8);
    expect(assets.json().data.total).toBe(8);
    const points = await call('GET', '/measurement-points');
    expect(points.statusCode).toBe(200);
    expect(points.json().data.total).toBe(16);
    const rules = await call('GET', '/alarm-rules');
    expect(rules.json().data.total).toBe(8);
  });
  it('保电活动绑定资产，测点超阈值只生成一个有效告警', async () => {
    const event = await call('POST', '/protection-events', {
      id: 'test-event',
      name: '集成验收保电活动',
      level: '一级',
      status: 'active',
      startsAt: Date.now(),
      endsAt: Date.now() + 86400000,
      plan: '现场巡检与双路电源保障',
      assetIds: ['venue', 'station-a'],
    });
    expect(event.statusCode).toBe(201);
    await service.simulation.control({ tick: 35, playing: false });
    await service.simulation.control({ tick: 36, playing: false });
    const alarms = (await call('GET', '/alarms?status=active')).json().data.items;
    expect(alarms).toHaveLength(1);
    expect(alarms[0].assetId).toBe('station-a');
    alarmId = alarms[0].id;
    const ack = await call('POST', `/alarms/${alarmId}/acknowledge`, { note: '已安排现场核查' });
    expect(ack.statusCode).toBe(200);
    expect(
      (await call('GET', '/telemetry/latest?assetId=station-a'))
        .json()
        .data.items.some(
          (p: { metric: string; value: number }) => p.metric === 'temperature' && p.value > 55,
        ),
    ).toBe(true);
  });
  it('工单指派、处理反馈、恢复复核与活动归档闭环', async () => {
    const created = await call('POST', '/work-orders', {
      title: '温度异常现场核查',
      assetId: 'station-a',
      alarmId,
      eventId: 'test-event',
      assignee: 'admin',
    });
    expect(created.statusCode).toBe(201);
    orderId = created.json().data.id;
    expect(
      (await call('POST', `/work-orders/${orderId}/assign`, { version: 1, assignee: 'admin' }))
        .statusCode,
    ).toBe(200);
    expect((await call('POST', `/work-orders/${orderId}/start`, { version: 2 })).statusCode).toBe(
      200,
    );
    expect(
      (
        await call('POST', `/work-orders/${orderId}/submit`, {
          version: 3,
          feedback: '已完成模拟散热检查',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call('POST', `/work-orders/${orderId}/review`, { version: 4, approved: true }))
        .statusCode,
    ).toBe(409);
    await service.simulation.control({ tick: 55, playing: false });
    const close = await call('POST', `/work-orders/${orderId}/review`, {
      version: 4,
      approved: true,
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().data.status).toBe('closed');
    const repeated = await call('POST', `/work-orders/${orderId}/review`, {
      version: 4,
      approved: true,
    });
    expect(repeated.json().data.idempotent).toBe(true);
    const detail = await call('GET', `/work-orders/${orderId}`);
    expect(detail.json().data.logs).toHaveLength(4);
    const report = await call('GET', '/reports/protection');
    expect(report.json().data.closedOrders).toBe(1);
  });
  it('viewer 只能查看，无法新增资产和操作工单', async () => {
    const user = await call('POST', '/users', {
      username: 'readonly-test',
      password: 'Viewer-Only-2026!',
      role: 'viewer',
    });
    expect(user.statusCode).toBe(201);
    const login = await service.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'readonly-test', password: 'Viewer-Only-2026!' },
    });
    const viewer = login.json().data.token;
    const result = await service.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { authorization: `Bearer ${viewer}` },
      payload: {},
    });
    expect(result.statusCode).toBe(403);
  });
  it('模型绑定、版本发布、拓扑和历史报告接口可读', async () => {
    for (const endpoint of [
      '/scene-models',
      '/model-bindings',
      '/scene-configurations',
      '/camera-presets',
      '/topology/graph',
      '/measurement-history?pointId=station-a-temperature',
      '/roles',
      '/audit',
    ])
      expect((await call('GET', endpoint)).statusCode).toBe(200);
    expect(
      (await call('GET', '/topology/trace?assetId=venue&direction=upstream')).json().data.lineIds
        .length,
    ).toBeGreaterThan(0);
  });
  it('区域授权裁剪目录并拒绝越界详情，功能权限修改立即生效', async () => {
    const created = (
      await call('POST', '/users', {
        username: 'scoped-viewer',
        password: 'Scoped-Viewer-2026!',
        role: 'viewer',
      })
    ).json().data;
    expect(
      (await call('PATCH', `/users/${created.id}`, { role: 'viewer', regionIds: ['hongqiao'] }))
        .statusCode,
    ).toBe(200);
    const login = (
      await service.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'scoped-viewer', password: 'Scoped-Viewer-2026!' },
      })
    ).json().data;
    const headers = { authorization: `Bearer ${login.token}` };
    const catalog = await service.app.inject({ url: '/api/v1/catalog/shanghai', headers });
    expect(catalog.json().data.assets).toHaveLength(2);
    expect((await service.app.inject({ url: '/api/v1/assets/venue', headers })).statusCode).toBe(
      403,
    );
    expect((await service.app.inject({ url: '/api/v1/users', headers })).statusCode).toBe(403);
  });
  it('上传 GLB、完成登记、绑定并发布目录；重复工单创建复用幂等结果', async () => {
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync('assets/expo/exhibition-center.glb');
    const upload = (
      await call('POST', '/scene-models/upload-url', {
        name: 'integration.glb',
        size: bytes.length,
      })
    ).json().data;
    expect(
      (
        await service.app.inject({
          method: 'PUT',
          url: upload.url,
          headers: { 'content-type': 'model/gltf-binary' },
          payload: bytes,
        })
      ).statusCode,
    ).toBe(200);
    expect((await call('POST', `/scene-models/${upload.id}/complete`, {})).statusCode).toBe(200);
    expect(
      (
        await call('PUT', '/scenes/venue/bindings', {
          bindings: [{ assetId: 'venue', modelId: upload.id, transform: { scale: 1 } }],
        })
      ).statusCode,
    ).toBe(200);
    const published = await call('POST', '/scenes/venue/publish', {});
    expect(published.statusCode).toBe(200);
    expect(
      (await call('GET', '/catalog/shanghai')).json().data.modelBindings[0].modelUri,
    ).toContain(upload.id);
    const headers = { authorization: `Bearer ${token}`, 'idempotency-key': 'test-once' };
    const payload = { title: '重复请求验收', assetId: 'venue', assignee: 'admin' };
    const first = await service.app.inject({
      method: 'POST',
      url: '/api/v1/work-orders',
      headers,
      payload,
    });
    const repeated = await service.app.inject({
      method: 'POST',
      url: '/api/v1/work-orders',
      headers,
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(repeated.json().data.id).toBe(first.json().data.id);
  });
  it('扩展种子可重复执行且提供方案 B 验收规模', async()=>{
    const {readFileSync}=await import('node:fs');
    const pool=new Pool({connectionString:url,options:`-c search_path=${schema},public`});
    try {
      const sql=readFileSync('database/seed/demo.sql','utf8');
      await pool.query(sql);await pool.query(sql);
      expect(Number((await pool.query("SELECT count(*) FROM assets WHERE id LIKE 'demo-station-%'")).rows[0].count)).toBe(12);
      expect(Number((await pool.query("SELECT count(*) FROM assets WHERE id LIKE 'demo-device-%'")).rows[0].count)).toBe(300);
      expect(Number((await pool.query("SELECT count(*) FROM power_lines WHERE id LIKE 'demo-line-%'")).rows[0].count)).toBe(120);
      expect(Number((await pool.query("SELECT count(*) FROM measurement_points WHERE id LIKE 'demo-point-%'")).rows[0].count)).toBe(800);
    } finally {await pool.end();}
  });

});
