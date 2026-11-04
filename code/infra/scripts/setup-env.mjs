import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
const target = new URL('../../.env', import.meta.url);
if (existsSync(target)) console.info('.env 已存在，保留现有环境配置。');
else {
  const generated = [
    '# 本文件包含本地环境凭据，不纳入版本管理。',
    `DATABASE_URL=postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/innodl_system`,
    'API_PORT=8787',
    'API_HOST=127.0.0.1',
    `POSTGRES_USER=innodl`,
    `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`,
    `REDIS_PASSWORD=${randomBytes(24).toString('hex')}`,
    'MINIO_ROOT_USER=innodl',
    `MINIO_ROOT_PASSWORD=${randomBytes(24).toString('hex')}`,
    `BOOTSTRAP_ADMIN_PASSWORD=${randomBytes(18).toString('base64url')}`,
    'COOKIE_SECURE=false',
    'VITE_DATA_MODE=server',
    '',
  ].join('\n');
  writeFileSync(target, generated, { mode: 0o600 });
  console.info(
    '已生成 .env（权限 600），请按 README 配置数据库连接。管理员初始密码保存在该文件中。',
  );
}
