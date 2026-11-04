import { Pool } from 'pg';
import { userInfo } from 'node:os';
import { buildApp } from '../apps/api-server/src/app';
const url =
  process.env.TEST_DATABASE_URL ??
  `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/innodl_system`;
const schema = `e2e_innodl_${process.pid}`;
const { app } = await buildApp({
  databaseUrl: url,
  schema,
  bootstrapPassword: 'E2E-Only-InnoDL-2026!',
  intervalMs: 1000,
});
await app.listen({ host: '127.0.0.1', port: 8790 });
/** 关闭浏览器测试专属服务并删除它自己的隔离数据。
 * @returns 资源清理完成的 Promise。
 */
async function close() {
  await app.close();
  const pool = new Pool({ connectionString: url });
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
