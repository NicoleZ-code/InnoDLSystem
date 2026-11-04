import { spawn } from 'node:child_process';
const processes = ['@innodl/api-server', '@innodl/twin-screen', '@innodl/admin-web'].map((name) =>
  spawn('pnpm', ['--filter', name, 'dev'], {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  }),
);
let closing = false;
/** 同时关闭开发进程及其子进程，避免端口残留。
 * @param code 根进程退出码。
 * @returns 无返回值，结束开发进程组。
 */
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of processes) {
    if (!child.pid) continue;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* 进程可能已经自然退出。 */
    }
  }
  process.exitCode = code;
}
for (const child of processes) {
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
