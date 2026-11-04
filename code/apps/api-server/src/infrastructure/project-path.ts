import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
/** 从启动工作目录向上定位 Monorepo 根，兼容开发及容器构建产物。
 * @param relative 项目根目录下的相对路径。
 * @returns 对应资源的绝对路径；找不到根目录时抛错。
 */
export function projectPath(relative: string): string {
  let current = process.cwd();
  while (!existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
    const parent = dirname(current);
    if (parent === current) throw new Error('无法定位项目根目录');
    current = parent;
  }
  return resolve(current, relative);
}
