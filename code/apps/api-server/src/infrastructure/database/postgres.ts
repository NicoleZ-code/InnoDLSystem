import { readFileSync } from 'node:fs';
import { projectPath } from '../project-path';
import { Pool, type PoolClient } from 'pg';
import { extendDatabase } from './extended';
import {
  type Asset,
  type PowerLine,
  type AlarmRecord,
  type Telemetry,
  type SimulationState,
  type AuditEntry,
  type Region,
} from '@innodl/power-types';
import { assets, lines, regionNames, telemetryAt } from '@innodl/shared-utils';
import { DomainError, type Repository } from '../../repositories/repository';
/** PostgreSQL 独立业务表迁移，不把资产、拓扑、监测和工单合并为大 JSON。 */
const migration = readFileSync(projectPath('database/migrations/001-core.sql'), 'utf8');
/** 建立 PostgreSQL 连接池与持久化仓储。
 * @param connectionString 专属项目数据库连接串。
 * @param schema 可选隔离 schema，仅允许安全标识符。
 * @returns 仓储、连接池和资源关闭函数。
 */
export async function openPostgres(connectionString: string, schema = 'public') {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('非法数据库 schema');
  const pool = new Pool({ connectionString, max: 8, options: `-c search_path=${schema},public` });
  if (schema !== 'public') await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  /** 在独立连接中执行事务。
   * @param operation 同一连接中的原子操作。
   * @returns 操作结果，失败时回滚。
   */
  async function tx<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  await tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(583177)');
    await client.query(migration);
    if ((await client.query('SELECT version FROM schema_migrations WHERE version=1')).rowCount)
      return;
    for (const [id, name] of Object.entries(regionNames))
      await client.query('INSERT INTO regions VALUES($1,$2)', [id, name]);
    for (const a of assets)
      await client.query('INSERT INTO assets VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        a.id,
        a.name,
        a.type,
        a.region,
        ...a.position,
        a.voltage,
        a.capacity,
        a.status,
      ]);
    for (const l of lines)
      await client.query('INSERT INTO power_lines VALUES($1,$2,$3,$4,$5,$6,$7)', [
        l.id,
        l.name,
        l.fromId,
        l.toId,
        l.voltage,
        l.status,
        l.load,
      ]);
    await client.query('INSERT INTO telemetry VALUES($1,$2,$3)', [
      0,
      telemetryAt(0).timestamp,
      telemetryAt(0),
    ]);
    await client.query("INSERT INTO app_state VALUES('simulation',$1),('revision','1')", [
      { playing: true, tick: 0 },
    ]);
    await client.query('INSERT INTO protection_events VALUES($1,$2,$3,$4,$5,$6,$7)', [
      'ciie-2026',
      '进博会重点供电保障',
      '一级',
      'active',
      Date.UTC(2026, 10, 4),
      Date.UTC(2026, 10, 10),
      '双路电源保障，巡检与应急队伍全天候值守',
    ]);
    for (const a of assets.filter((a) => a.region === 'core'))
      await client.query('INSERT INTO protected_assets VALUES($1,$2)', ['ciie-2026', a.id]);
    for (const mode of ['city', 'grid', 'venue', 'equipment'])
      await client.query('INSERT INTO scenes(id,name,mode,configuration) VALUES($1,$2,$1,$3)', [
        mode,
        { city: '全景态势', grid: '电网运行', venue: '重点保电', equipment: '设备监测' }[mode],
        {
          camera: { targetAssetId: 'venue', duration: 2 },
          layers: { buildings: true, labels: true, boundary: true },
          models: { venue: '/models/exhibition-center.glb', equipment: '/models/switchgear.glb' },
        },
      ]);
    await client.query('INSERT INTO asset_model_bindings VALUES($1,$2)', [
      'venue',
      '/models/exhibition-center.glb',
    ]);
    for (const a of assets)
      await client.query('INSERT INTO measurement_points VALUES($1,$2,$3,$4,$5)', [
        `${a.id}-voltage`,
        a.id,
        '运行电压',
        'kV',
        'simulated',
      ]);
    await client.query('INSERT INTO schema_migrations VALUES(1,$1)', [Date.now()]);
  });
  await extendDatabase(pool);
  /** 变更审计与目录版本同事务提交。
   * @param client 当前事务连接。
   * @param action 操作类型。
   * @param id 业务实体 ID。
   * @param detail 变更摘要。
   * @returns 无返回值。
   */
  async function audit(client: PoolClient, action: string, id: string, detail: string) {
    await client.query(
      'INSERT INTO audit_log(action,entity_id,timestamp,details) VALUES($1,$2,$3,$4)',
      [action, id, Date.now(), detail],
    );
    await client.query(
      "UPDATE app_state SET value=to_jsonb((value::text)::integer+1) WHERE key='revision'",
    );
  }
  /** 查询资产或线路是否存在，并处理创建冲突。
   * @param client 当前事务连接。
   * @param table 固定表名。
   * @param id 实体 ID。
   * @param create 是否为创建操作。
   * @returns 无返回值，冲突时抛出领域错误。
   */
  async function existence(
    client: PoolClient,
    table: 'assets' | 'power_lines',
    id: string,
    create: boolean,
  ) {
    const exists = !!(await client.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]))
      .rowCount;
    if (create && exists) throw new DomainError(409, 'CONFLICT', '该 ID 已存在');
    if (!create && !exists) throw new DomainError(404, 'NOT_FOUND', '未找到该资源');
  }
  const repository: Repository = {
    /** 获取目录。
     * @returns 独立业务表聚合后的场景目录。
     */
    async catalog() {
      const [assetList, lineList, regions, revision] = await Promise.all([
        repository.assets(),
        pool.query(
          'SELECT id,name,from_id AS "fromId",to_id AS "toId",voltage,status,load FROM power_lines ORDER BY id',
        ),
        pool.query('SELECT * FROM regions ORDER BY id'),
        pool.query("SELECT value FROM app_state WHERE key='revision'"),
      ]);
      return {
        assets: assetList,
        lines: lineList.rows as PowerLine[],
        regions: regions.rows as Region[],
        revision: Number(revision.rows[0].value),
        modelBindings:
          (await pool.query("SELECT value FROM app_state WHERE key='published-scene-venue'"))
            .rows[0]?.value?.bindings ?? [],
      };
    },
    /** 查询区域资产。
     * @param filter 可选区域及类别。
     * @returns 资产实体列表。
     */
    async assets(filter = {}) {
      const result = await pool.query(
        "SELECT id,name,type,region,ARRAY[longitude,latitude,height] AS position,voltage,capacity,status FROM assets WHERE ($1::text IS NULL OR $1='shanghai' OR region=$1) AND ($2::text IS NULL OR type=$2) ORDER BY CASE WHEN id='venue' THEN 0 ELSE 1 END,id",
        [filter.regionId ?? null, filter.type ?? null],
      );
      return result.rows as Asset[];
    },
    /** 保存资产与审计。
     * @param a 资产元数据。
     * @param create 是否创建。
     * @returns 无返回值，原子提交数据。
     */
    async saveAsset(a, create) {
      await tx(async (c) => {
        await existence(c, 'assets', a.id, create);
        await c.query(
          'INSERT INTO assets VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,region=excluded.region,longitude=excluded.longitude,latitude=excluded.latitude,height=excluded.height,voltage=excluded.voltage,capacity=excluded.capacity,status=excluded.status',
          [a.id, a.name, a.type, a.region, ...a.position, a.voltage, a.capacity, a.status],
        );
        await c.query(
          'INSERT INTO topology_nodes(id,asset_id,electrical_code) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
          [`node-${a.id}`, a.id, `terminal-${a.id}`],
        );
        await audit(c, create ? 'asset.created' : 'asset.updated', a.id, a.name);
      });
    },
    /** 删除未被业务引用的资产。
     * @param id 资产 ID。
     * @returns 无返回值，引用冲突时拒绝删除。
     */
    async deleteAsset(id) {
      await tx(async (c) => {
        await existence(c, 'assets', id, false);
        const refs = await c.query(
          'SELECT 1 FROM power_lines WHERE from_id=$1 OR to_id=$1 UNION ALL SELECT 1 FROM protected_assets WHERE asset_id=$1 UNION ALL SELECT 1 FROM work_orders WHERE asset_id=$1',
          [id],
        );
        if (refs.rowCount)
          throw new DomainError(409, 'ASSET_IN_USE', '资产仍被线路、保障活动或工单引用');
        await c.query('DELETE FROM assets WHERE id=$1', [id]);
        await audit(c, 'asset.deleted', id, '删除资产元数据');
      });
    },
    /** 保存线路拓扑关系。
     * @param l 线路对象。
     * @param create 是否创建。
     * @returns 无返回值，拒绝无效端点。
     */
    async saveLine(l, create) {
      await tx(async (c) => {
        await existence(c, 'power_lines', l.id, create);
        if (l.fromId === l.toId) throw new DomainError(422, 'INVALID_TOPOLOGY', '线路两端不能相同');
        const found = await c.query('SELECT id FROM assets WHERE id=ANY($1::text[])', [
          [l.fromId, l.toId],
        ]);
        if (found.rowCount !== 2)
          throw new DomainError(422, 'INVALID_ENDPOINT', '线路端点必须引用已有资产');
        await c.query(
          'INSERT INTO power_lines VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,from_id=excluded.from_id,to_id=excluded.to_id,voltage=excluded.voltage,status=excluded.status,load=excluded.load',
          [l.id, l.name, l.fromId, l.toId, l.voltage, l.status, l.load],
        );
        await c.query(
          "INSERT INTO topology_edges VALUES($1,$2,$3,$4,'CLOSED') ON CONFLICT(id) DO UPDATE SET from_node_id=excluded.from_node_id,to_node_id=excluded.to_node_id",
          [`edge-${l.id}`, `node-${l.fromId}`, `node-${l.toId}`, l.id],
        );
        await audit(c, create ? 'line.created' : 'line.updated', l.id, l.name);
      });
    },
    /** 删除线路。
     * @param id 线路 ID。
     * @returns 无返回值。
     */
    async deleteLine(id) {
      await tx(async (c) => {
        await existence(c, 'power_lines', id, false);
        await c.query('DELETE FROM power_lines WHERE id=$1', [id]);
        await audit(c, 'line.deleted', id, '删除线路元数据');
      });
    },
    /** 获取权威时钟对应快照。
     * @returns 已持久化的完整遥测。
     */
    async latest() {
      const state = await repository.simulation();
      return (await pool.query('SELECT document FROM telemetry WHERE tick=$1', [state.tick]))
        .rows[0].document as Telemetry;
    },
    /** 查询历史范围。
     * @param from 起始秒。
     * @param to 截止秒。
     * @param limit 结果数量上限。
     * @returns 升序遥测列表。
     */
    async history(from, to, limit) {
      return (
        await pool.query(
          'SELECT document FROM telemetry WHERE tick BETWEEN $1 AND $2 ORDER BY tick LIMIT $3',
          [from, to, limit],
        )
      ).rows.map((row) => row.document as Telemetry);
    },
    /** 提交遥测、告警生命周期与模拟时钟。
     * @param snapshot 遥测快照。
     * @param state 模拟器状态。
     * @returns 无返回值。
     */
    async record(snapshot, state) {
      await tx(async (c) => {
        await c.query(
          'INSERT INTO telemetry VALUES($1,$2,$3) ON CONFLICT(tick) DO UPDATE SET timestamp=excluded.timestamp,document=excluded.document',
          [snapshot.tick, snapshot.timestamp, snapshot],
        );
        await c.query("UPDATE app_state SET value=$1 WHERE key='simulation'", [state]);
        await c.query("UPDATE alarms SET status='resolved' WHERE status='active'");
        for (const alarm of snapshot.alarms)
          await c.query(
            "INSERT INTO alarms VALUES($1,$2,$3,'active',NULL,NULL,$4) ON CONFLICT(id) DO UPDATE SET status='active',document=excluded.document",
            [alarm.id, alarm.assetId, alarm.timestamp, alarm],
          );
        await c.query(
          'DELETE FROM telemetry WHERE tick IN(SELECT tick FROM telemetry ORDER BY tick DESC OFFSET 86400)',
        );
      });
    },
    /** 读取模拟时钟。
     * @returns 当前运行与时间轴状态。
     */
    async simulation() {
      return (await pool.query("SELECT value FROM app_state WHERE key='simulation'")).rows[0]
        .value as SimulationState;
    },
    /** 获取告警记录。
     * @param status 可选生命周期状态。
     * @returns 已包含确认信息的告警数组。
     */
    async alarms(status) {
      return (
        await pool.query(
          'SELECT * FROM alarms WHERE ($1::text IS NULL OR status=$1) ORDER BY timestamp DESC LIMIT 500',
          [status ?? null],
        )
      ).rows.map(
        (row) =>
          ({
            ...row.document,
            status: row.status,
            acknowledgedAt: row.acknowledged_at ? Number(row.acknowledged_at) : null,
            note: row.note,
          }) as AlarmRecord,
      );
    },
    /** 确认告警并记录审计。
     * @param id 告警 ID。
     * @param note 处理说明。
     * @returns 更新后的告警。
     */
    async acknowledge(id, note) {
      await tx(async (c) => {
        const result = await c.query('UPDATE alarms SET acknowledged_at=$1,note=$2 WHERE id=$3', [
          Date.now(),
          note,
          id,
        ]);
        if (!result.rowCount) throw new DomainError(404, 'NOT_FOUND', '未找到告警');
        await audit(c, 'alarm.acknowledged', id, note);
      });
      return (await repository.alarms()).find((alarm) => alarm.id === id)!;
    },
    /** 查询审计日志。
     * @param limit 最大数量。
     * @returns 最近操作记录。
     */
    async audit(limit) {
      return (
        await pool.query(
          'SELECT id::integer,action,entity_id AS "entityId",timestamp::double precision,details FROM audit_log ORDER BY id DESC LIMIT $1',
          [limit],
        )
      ).rows as AuditEntry[];
    },
  };
  return { repository, pool, close: () => pool.end() };
}
