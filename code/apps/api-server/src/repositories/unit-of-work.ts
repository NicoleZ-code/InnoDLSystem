import type { Pool, PoolClient } from 'pg';
/** 建立包含业务审计的事务执行器。
 * @param pool PostgreSQL 连接池。
 * @returns 接收操作类型、实体 ID 和事务回调的异步执行函数。
 */
export function createMutation(pool: Pool) {
  /** 原子写入平台业务并记录审计。
   * @param action 业务操作标识。
   * @param id 业务实体 ID。
   * @param operation 同一事务中的操作。
   * @returns 事务提交后的业务结果。
   */
  async function mutate<T>(
    action: string,
    id: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query(
        'INSERT INTO audit_log(action,entity_id,timestamp,details) VALUES($1,$2,$3,$4)',
        [action, id, Date.now(), action],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return mutate;
}
