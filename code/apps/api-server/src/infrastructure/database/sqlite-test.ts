import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

import { assets, lines, telemetryAt, regionNames } from '@innodl/shared-utils';
/** 打开 SQLite、执行版本迁移并在空库幂等初始化演示数据。
 * @param filename SQLite 文件路径，测试可用 :memory:。
 * @returns 已开启外键、迁移与初始化完成的数据库连接。
 */
export function openDatabase(filename: string): DatabaseSync {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, region_id TEXT NOT NULL REFERENCES regions(id), document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS power_lines (id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT, to_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS telemetry (tick INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL, document TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS telemetry_timestamp ON telemetry(timestamp);
    CREATE TABLE IF NOT EXISTS alarms (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, acknowledged_at INTEGER, note TEXT, document TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS alarms_timestamp ON alarms(timestamp);
    CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity_id TEXT NOT NULL, timestamp INTEGER NOT NULL, details TEXT NOT NULL);
  `);
  transaction(db, () => {
    if (db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get()) return;
    for (const [id, name] of Object.entries(regionNames))
      db.prepare('INSERT INTO regions VALUES (?,?)').run(id, name);
    for (const asset of assets)
      db.prepare('INSERT INTO assets VALUES (?,?,?)').run(
        asset.id,
        asset.region,
        JSON.stringify(asset),
      );
    for (const line of lines)
      db.prepare('INSERT INTO power_lines VALUES (?,?,?,?)').run(
        line.id,
        line.fromId,
        line.toId,
        JSON.stringify(line),
      );
    const snapshot = telemetryAt(0);
    db.prepare('INSERT INTO telemetry VALUES (?,?,?)').run(
      0,
      snapshot.timestamp,
      JSON.stringify(snapshot),
    );
    db.prepare('INSERT INTO app_state VALUES (?,?)').run(
      'simulation',
      JSON.stringify({ playing: true, tick: 0 }),
    );
    db.prepare('INSERT INTO app_state VALUES (?,?)').run('revision', '1');
    db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(1, Date.now());
  });
  return db;
}
/** 执行可回滚的同步事务。
 * @param db 已打开的数据库。
 * @param operation 事务内的同步操作。
 * @returns 操作返回值，失败时回滚并抛出原始错误。
 */
export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
