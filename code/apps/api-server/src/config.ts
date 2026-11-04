import { config as loadEnvironment } from 'dotenv';
import { z } from 'zod';
loadEnvironment({ path: new URL('../../../.env', import.meta.url), quiet: true });
const environment = z.object({
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_FILE: z.string().optional(),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/innodl_system'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
  SIMULATION_INTERVAL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  REDIS_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
});
/** 读取并校验后端环境配置。
 * @returns 数据库、端口、模拟周期和日志配置对象。
 */
export function readConfig() {
  return environment.parse(process.env);
}
