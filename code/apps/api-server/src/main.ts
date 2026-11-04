import { buildApp } from './app';
import { readConfig } from './config';
const config = readConfig();
const { app } = await buildApp({
  databaseFile: config.DATABASE_FILE,
  databaseUrl: config.DATABASE_URL,
  bootstrapPassword: config.BOOTSTRAP_ADMIN_PASSWORD,
  intervalMs: config.SIMULATION_INTERVAL_MS,
  redisUrl: config.REDIS_URL,
  logger: config.LOG_LEVEL !== 'silent',
  serveWeb: true,
});
/** 释放服务器、WebSocket、模拟定时器和数据库。
 * @returns 完成资源清理的 Promise。
 */
async function shutdown() {
  await app.close();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
