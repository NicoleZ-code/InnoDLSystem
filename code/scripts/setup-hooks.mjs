import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// 仅在本项目已有 Git 仓库时安装，避免修改父级仓库的 hooks。
if (existsSync('.git')) execFileSync('pnpm', ['exec', 'husky'], { stdio: 'inherit' });
else console.info('Husky 配置已就绪；在本目录初始化 Git 后运行 pnpm prepare 启用。');
