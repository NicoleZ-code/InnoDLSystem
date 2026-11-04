import type { DatabaseSync } from 'node:sqlite';
import type {
  AlarmRecord,
  Asset,
  AssetFilter,
  AuditEntry,
  PowerLine,
  Region,
  SceneCatalog,
  SimulationState,
  Telemetry,
} from '@innodl/power-types';
import { transaction } from '../infrastructure/database/sqlite-test';
/** 数据仓储接口，数据库迁移时替换此实现即可。 */
export interface SceneRepository {
  catalog(): SceneCatalog;
  assets(filter?: AssetFilter): Asset[];
  saveAsset(asset: Asset, create: boolean): void;
  deleteAsset(id: string): void;
  saveLine(line: PowerLine, create: boolean): void;
  deleteLine(id: string): void;
  latest(): Telemetry;
  history(from: number, to: number, limit: number): Telemetry[];
  record(snapshot: Telemetry, simulation: SimulationState): void;
  simulation(): SimulationState;
  alarms(status?: string): AlarmRecord[];
  acknowledge(id: string, note: string): AlarmRecord;
  audit(limit: number): AuditEntry[];
}
/** 可公开给调用者的领域异常。 */
export class DomainError extends Error {
  /** 建立可映射为 HTTP 的领域错误。
   * @param status HTTP 状态码。
   * @param code 稳定业务错误码。
   * @param message 可供界面展示的中文原因。
   * @returns 领域错误实例。
   */
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
/** 创建 SQLite 仓储，屏蔽 SQL 与业务服务之间的依赖。
 * @param db 已完成迁移的数据库连接。
 * @returns 实现资产、线路、遥测、告警和审计的仓储对象。
 */
export function createRepository(db: DatabaseSync): SceneRepository {
  /** 解码文档型数据列。
   * @param rows SQLite 查询返回的行数组。
   * @returns 从 document 字段解码的业务实体数组。
   */
  function decode<T>(rows: Record<string, unknown>[]): T[] {
    return rows.map((row) => JSON.parse(String(row.document)) as T);
  }
  /** 添加持久化审计记录。
   * @param action 操作标识。
   * @param id 被操作实体 ID。
   * @param detail 审计摘要。
   * @returns 无返回值，持久化一条审计记录。
   */
  function log(action: string, id: string, detail: string) {
    db.prepare('INSERT INTO audit_log(action,entity_id,timestamp,details) VALUES (?,?,?,?)').run(
      action,
      id,
      Date.now(),
      detail,
    );
  }
  /** 更新目录修订号。
   * @returns 无返回值，增加已持久化的目录版本。
   */
  function bump() {
    db.prepare(
      "UPDATE app_state SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'",
    ).run();
  }
  /** 检查唯一性或存在性。
   * @param exists 实体是否已经存在。
   * @param create 是否为创建操作。
   * @returns 无返回值；冲突或缺失时抛出领域异常。
   */
  function requireExistence(exists: boolean, create: boolean) {
    if (create && exists) throw new DomainError(409, 'CONFLICT', '该 ID 已存在');
    if (!create && !exists) throw new DomainError(404, 'NOT_FOUND', '未找到该资源');
  }
  const repository: SceneRepository = {
    /** 读取完整场景目录。
     * @returns 包含资产、线路、区域和修订号的目录。
     */
    catalog() {
      return {
        assets: repository.assets(),
        lines: decode<PowerLine>(
          db.prepare('SELECT document FROM power_lines ORDER BY rowid').all(),
        ),
        regions: db
          .prepare('SELECT id,name FROM regions ORDER BY rowid')
          .all() as unknown as Region[],
        revision: Number(
          db.prepare("SELECT value FROM app_state WHERE key = 'revision'").get()?.value,
        ),
      };
    },
    /** 查询资产并执行区域与类别交集过滤。
     * @param filter 可选区域及资产类型。
     * @returns 符合过滤条件的资产数组。
     */
    assets(filter = {}) {
      return decode<Asset>(db.prepare('SELECT document FROM assets ORDER BY rowid').all()).filter(
        (asset) =>
          (!filter.regionId ||
            filter.regionId === 'shanghai' ||
            asset.region === filter.regionId) &&
          (!filter.type || asset.type === filter.type),
      );
    },
    /** 保存资产元数据，创建及更新均与审计同事务提交。
     * @param asset 校验后的资产。
     * @param create 是否为新建。
     * @returns 无返回值，提交资产与目录修订。
     */
    saveAsset(asset, create) {
      transaction(db, () => {
        requireExistence(!!db.prepare('SELECT id FROM assets WHERE id=?').get(asset.id), create);
        db.prepare(
          'INSERT INTO assets VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET region_id=excluded.region_id,document=excluded.document',
        ).run(asset.id, asset.region, JSON.stringify(asset));
        bump();
        log(create ? 'asset.created' : 'asset.updated', asset.id, asset.name);
      });
    },
    /** 删除未被线路引用的资产。
     * @param id 资产唯一标识。
     * @returns 无返回值，有线路引用时返回冲突错误。
     */
    deleteAsset(id) {
      transaction(db, () => {
        requireExistence(!!db.prepare('SELECT id FROM assets WHERE id=?').get(id), false);
        if (db.prepare('SELECT id FROM power_lines WHERE from_id=? OR to_id=?').get(id, id))
          throw new DomainError(409, 'ASSET_IN_USE', '该资产仍被供电线路引用，请先调整线路');
        db.prepare('DELETE FROM assets WHERE id=?').run(id);
        bump();
        log('asset.deleted', id, '删除资产元数据');
      });
    },
    /** 保存供电线路，拒绝缺失端点及自环。
     * @param line 校验后的线路对象。
     * @param create 是否为新建。
     * @returns 无返回值，提交线路和审计。
     */
    saveLine(line, create) {
      transaction(db, () => {
        requireExistence(
          !!db.prepare('SELECT id FROM power_lines WHERE id=?').get(line.id),
          create,
        );
        if (line.fromId === line.toId)
          throw new DomainError(422, 'INVALID_TOPOLOGY', '线路两端不能相同');
        for (const id of [line.fromId, line.toId])
          if (!db.prepare('SELECT id FROM assets WHERE id=?').get(id))
            throw new DomainError(422, 'INVALID_ENDPOINT', '线路端点必须引用已有资产');
        db.prepare(
          'INSERT INTO power_lines VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET from_id=excluded.from_id,to_id=excluded.to_id,document=excluded.document',
        ).run(line.id, line.fromId, line.toId, JSON.stringify(line));
        bump();
        log(create ? 'line.created' : 'line.updated', line.id, line.name);
      });
    },
    /** 删除线路元数据。
     * @param id 线路唯一标识。
     * @returns 无返回值，提交删除及审计。
     */
    deleteLine(id) {
      transaction(db, () => {
        requireExistence(!!db.prepare('SELECT id FROM power_lines WHERE id=?').get(id), false);
        db.prepare('DELETE FROM power_lines WHERE id=?').run(id);
        bump();
        log('line.deleted', id, '删除线路元数据');
      });
    },
    /** 读取最新遥测。
     * @returns 当前时间轴位置对应的已存储遥测。
     */
    latest() {
      const state = repository.simulation();
      return decode<Telemetry>(
        db.prepare('SELECT document FROM telemetry WHERE tick=?').all(state.tick),
      )[0];
    },
    /** 查询已采集的遥测历史。
     * @param from 起始 tick，包含边界。
     * @param to 截止 tick，包含边界。
     * @param limit 最大结果数量。
     * @returns 按 tick 升序排列的遥测数组。
     */
    history(from, to, limit) {
      return decode<Telemetry>(
        db
          .prepare(
            'SELECT document FROM telemetry WHERE tick BETWEEN ? AND ? ORDER BY tick LIMIT ?',
          )
          .all(from, to, limit),
      );
    },
    /** 原子保存遥测、告警生命周期及模拟时钟。
     * @param snapshot 当前模拟遥测。
     * @param simulation 模拟器运行状态。
     * @returns 无返回值，持久化数据并限制历史最多 86400 个样本。
     */
    record(snapshot, simulation) {
      transaction(db, () => {
        db.prepare('INSERT OR REPLACE INTO telemetry VALUES (?,?,?)').run(
          snapshot.tick,
          snapshot.timestamp,
          JSON.stringify(snapshot),
        );
        db.prepare("UPDATE app_state SET value=? WHERE key='simulation'").run(
          JSON.stringify(simulation),
        );
        db.prepare("UPDATE alarms SET status='resolved' WHERE status='active'").run();
        for (const alarm of snapshot.alarms)
          db.prepare(
            "INSERT INTO alarms VALUES (?,?,?,'active',NULL,NULL,?) ON CONFLICT(id) DO UPDATE SET status='active',document=excluded.document",
          ).run(alarm.id, alarm.assetId, alarm.timestamp, JSON.stringify(alarm));
        db.prepare(
          'DELETE FROM telemetry WHERE tick IN (SELECT tick FROM telemetry ORDER BY tick DESC LIMIT -1 OFFSET 86400)',
        ).run();
      });
    },
    /** 读取持久化模拟时钟。
     * @returns 是否运行及当前 tick。
     */
    simulation() {
      return JSON.parse(
        String(db.prepare("SELECT value FROM app_state WHERE key='simulation'").get()!.value),
      ) as SimulationState;
    },
    /** 查询告警及确认信息。
     * @param status 可选 active 或 resolved 生命周期。
     * @returns 时间倒序的告警记录，最多 500 条。
     */
    alarms(status) {
      const rows = status
        ? db
            .prepare('SELECT * FROM alarms WHERE status=? ORDER BY timestamp DESC LIMIT 500')
            .all(status)
        : db.prepare('SELECT * FROM alarms ORDER BY timestamp DESC LIMIT 500').all();
      return rows.map(
        (row) =>
          ({
            ...JSON.parse(String(row.document)),
            status: row.status,
            acknowledgedAt: row.acknowledged_at,
            note: row.note,
          }) as AlarmRecord,
      );
    },
    /** 确认告警，仅记录处理说明，不改变设备状态。
     * @param id 告警 ID。
     * @param note 人工处理说明。
     * @returns 带确认时间及备注的告警记录。
     */
    acknowledge(id, note) {
      return transaction(db, () => {
        const exists = db.prepare('SELECT id FROM alarms WHERE id=?').get(id);
        requireExistence(!!exists, false);
        db.prepare('UPDATE alarms SET acknowledged_at=?,note=? WHERE id=?').run(
          Date.now(),
          note,
          id,
        );
        log('alarm.acknowledged', id, note);
        return repository.alarms().find((alarm) => alarm.id === id)!;
      });
    },
    /** 获取近期审计记录。
     * @param limit 最大返回条数。
     * @returns 时间倒序审计数组。
     */
    audit(limit) {
      return db
        .prepare(
          'SELECT id,action,entity_id AS entityId,timestamp,details FROM audit_log ORDER BY id DESC LIMIT ?',
        )
        .all(limit) as unknown as AuditEntry[];
    },
  };
  return repository;
}
/** 同步测试仓储与异步 PostgreSQL 仓储的统一边界。 */
export type Repository = {
  [K in keyof SceneRepository]: (
    ...args: Parameters<SceneRepository[K]>
  ) => ReturnType<SceneRepository[K]> | Promise<ReturnType<SceneRepository[K]>>;
};
