import { readFileSync } from 'node:fs';
import { projectPath } from '../project-path';
import type { Pool } from 'pg';
/** 对已建库执行方案 B 的监测、场景和状态流转增量迁移。
 * @param pool 指向项目 schema 的 PostgreSQL 池。
 * @returns 完成可重复增量迁移的 Promise。
 */
export async function extendDatabase(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(583177)');
    await client.query(readFileSync(projectPath('database/migrations/002-domains.sql'), 'utf8'));
    await client.query(
      "INSERT INTO roles VALUES('protection_manager','保电管理员','[\"protection.manage\",\"*.read\"]'),('supervisor','运维主管','[\"alarms.manage\",\"workorders.manage\",\"*.read\"]') ON CONFLICT(id) DO NOTHING",
    );
    const available = await client.query(
      "SELECT name FROM pg_available_extensions WHERE name='postgis'",
    );
    if (available.rowCount) {
      await client.query(readFileSync(projectPath('database/migrations/003-spatial.sql'),'utf8'));
    }
    await client.query(
      "INSERT INTO roles VALUES('admin','超级管理员','[\"*\"]'),('operator','运维人员','[\"*.read\",\"alarms.manage\",\"workorders.manage\"]'),('viewer','指挥大屏用户','[\"*.read\"]') ON CONFLICT(id) DO NOTHING",
    );
    await client.query(
      "INSERT INTO topology_nodes SELECT 'node-'||id,id,'terminal','terminal-'||id FROM assets ON CONFLICT(id) DO NOTHING",
    );
    await client.query(
      "INSERT INTO topology_edges SELECT 'edge-'||id,'node-'||from_id,'node-'||to_id,id,'CLOSED' FROM power_lines ON CONFLICT(id) DO NOTHING",
    );
    await client.query(
      "INSERT INTO measurement_points(id,asset_id,name,unit,quality,metric) SELECT id||'-temperature',id,'柜内温度','°C','simulated','temperature' FROM assets ON CONFLICT(id) DO NOTHING",
    );
    await client.query(
      "INSERT INTO alarm_rules SELECT 'rule-'||id,id,'温度偏高','gt',55,'attention',true FROM measurement_points WHERE metric='temperature' ON CONFLICT(id) DO NOTHING",
    );
    await client.query(
      "INSERT INTO scene_models(id,name,file_key,format,status) VALUES('expo-model','国家会展中心','/models/exhibition-center.glb','glb','published'),('switchgear-model','智能配电柜','/models/switchgear.glb','glb','published') ON CONFLICT(id) DO NOTHING",
    );
    await client.query(
      "INSERT INTO scene_bindings VALUES('venue','venue','expo-model','{}') ON CONFLICT DO NOTHING",
    );
    await client.query(
      "INSERT INTO scene_layers SELECT s.id||'-assets',s.id,'电力资产','assets',true,'{}' FROM scenes s ON CONFLICT(id) DO NOTHING",
    );
    await client.query(
      'INSERT INTO camera_presets SELECT s.id||\'-home\',s.id,\'默认镜头\',\'{"lng":121.302,"lat":31.188,"height":2000}\',\'{"heading":15,"pitch":-48,"roll":0}\',2 FROM scenes s ON CONFLICT(id) DO NOTHING',
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
