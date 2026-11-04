import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(new URL('../apps/twin-screen/package.json', import.meta.url));
const root = resolve(dirname(require.resolve('cesium/package.json')), 'Build/Cesium');
const target = new URL('../apps/twin-screen/public/cesium/', import.meta.url);
mkdirSync(target, { recursive: true });
for (const folder of ['Workers', 'Assets', 'Widgets', 'ThirdParty']) {
  const dest = new URL(folder, target);
  if (!existsSync(dest)) cpSync(resolve(root, folder), dest, { recursive: true });
}
