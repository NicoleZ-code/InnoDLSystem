import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Alarm, Telemetry } from '@innodl/power-types';
export interface Measurement {
  pointId: string;
  assetId: string;
  metric: string;
  value: number;
  unit: string;
  quality: string;
  timestamp: number;
}
/** 建立测点采集与阈值告警服务，所有规则从后端业务表读取。
 * @param pool 业务 PostgreSQL 连接池。
 * @param onEvent 告警变化和批量测点的发布回调。
 * @returns 采样、最新值和历史查询服务。
 */
export function createMeasurements(pool: Pool, onEvent: (event: string, data: unknown) => void) {
  return {
    /** 对全部启用测点执行可重复模拟采样并保存独立时序记录。
     * @param snapshot 权威模拟时钟产生的快照。
     * @returns 包含真实规则检测结果的更新快照。
     */
    async sample(snapshot: Telemetry): Promise<Telemetry> {
      const points = (await pool.query('SELECT * FROM measurement_points WHERE enabled=true')).rows;
      const values: Measurement[] = points.map((p) => ({
        pointId: p.id,
        assetId: p.asset_id,
        metric: p.metric,
        unit: p.unit,
        quality: 'SIMULATED',
        timestamp: snapshot.timestamp,
        value:
          p.metric === 'temperature'
            ? p.asset_id === 'station-a' && snapshot.tick % 90 >= 30 && snapshot.tick % 90 < 55
              ? 60
              : 28.6 + Math.sin(snapshot.tick / 15) * 2
            : p.metric === 'current'
              ? snapshot.current
              : p.metric === 'load'
                ? snapshot.load
                : snapshot.voltage,
      }));
      const rules = (
        await pool.query(
          'SELECT r.* FROM alarm_rules r JOIN measurement_points p ON p.id=r.point_id WHERE r.enabled=true AND p.enabled=true',
        )
      ).rows;
      const changes: { event: string; data: Alarm }[] = [];
      const activeIds: string[] = [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (values.length) {
          const source = JSON.stringify(values);
          await client.query(
            `INSERT INTO telemetry_latest SELECT x."pointId",x."assetId",x.metric,x.value,x.unit,x.quality,x.timestamp FROM jsonb_to_recordset($1::jsonb) AS x("pointId" text,"assetId" text,metric text,value double precision,unit text,quality text,timestamp bigint) ON CONFLICT(point_id) DO UPDATE SET value=excluded.value,quality=excluded.quality,timestamp=excluded.timestamp`,
            [source],
          );
          await client.query(
            `INSERT INTO telemetry_history SELECT x."pointId",to_timestamp(x.timestamp/1000.0),x.value,x.quality FROM jsonb_to_recordset($1::jsonb) AS x("pointId" text,value double precision,quality text,timestamp bigint) ON CONFLICT(point_id,ts) DO UPDATE SET value=excluded.value,quality=excluded.quality`,
            [source],
          );
        }
        for (const rule of rules) {
          const point = values.find((p) => p.pointId === rule.point_id);
          if (!point) continue;
          const triggered =
            rule.operator === 'lt' ? point.value < rule.threshold : point.value > rule.threshold;
          if (!triggered) continue;
          const existing = (
            await client.query(
              "SELECT id,document FROM alarms WHERE rule_id=$1 AND status='active' ORDER BY timestamp DESC LIMIT 1",
              [rule.id],
            )
          ).rows[0];
          const id = existing?.id ?? randomUUID();
          activeIds.push(id);
          if (!existing) {
            const alarm: Alarm = {
              id,
              assetId: point.assetId,
              message: `${rule.name}：${point.value.toFixed(2)} ${point.unit}（阈值 ${rule.threshold}）`,
              severity: rule.severity,
              timestamp: snapshot.timestamp,
            };
            await client.query(
              "INSERT INTO alarms(id,asset_id,timestamp,status,document,rule_id,point_id) VALUES($1,$2,$3,'active',$4,$5,$6)",
              [id, point.assetId, snapshot.timestamp, alarm, rule.id, rule.point_id],
            );
            changes.push({ event: 'alarm.created', data: alarm });
          }
        }
        const cleared = await client.query(
          "UPDATE alarms SET status='resolved' WHERE rule_id IS NOT NULL AND status='active' AND NOT(id=ANY($1::text[])) RETURNING document",
          [activeIds],
        );
        for (const row of cleared.rows)
          changes.push({ event: 'alarm.updated', data: row.document });
        const active = (
          await client.query("SELECT document FROM alarms WHERE status='active'")
        ).rows.map((row) => row.document as Alarm);
        await client.query('COMMIT');
        for (const change of changes) onEvent(change.event, change.data);
        onEvent('telemetry.batch', values);
        return { ...snapshot, alarms: active };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    /** 读取最新采样值。
     * @param assetId 可选资产过滤。
     * @returns 最新值及质量、单位、采样时间。
     */
    async latest(assetId?: string) {
      return (
        await pool.query(
          'SELECT point_id AS "pointId",asset_id AS "assetId",metric,value,unit,quality,timestamp::double precision FROM telemetry_latest WHERE ($1::text IS NULL OR asset_id=$1) ORDER BY point_id',
          [assetId ?? null],
        )
      ).rows as Measurement[];
    },
  };
}
