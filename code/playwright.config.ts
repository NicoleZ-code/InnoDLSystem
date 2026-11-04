import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: 'http://localhost:5187',
    viewport: { width: 1920, height: 1080 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
      args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
    },
  },
  webServer: [
    {
      command: 'pnpm --filter @innodl/api-server exec tsx ../../tests/e2e-server.ts',
      url: 'http://127.0.0.1:8790/api/v1/health',
      reuseExistingServer: false,
      timeout: 90000,
      env: { LOG_LEVEL: 'silent' },
    },
    {
      command: 'pnpm dev:web',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:8790' },
      url: 'http://localhost:5187',
      reuseExistingServer: false,
      timeout: 90000,
    },
    {
      command: 'pnpm dev:admin',
      url: 'http://localhost:5198',
      reuseExistingServer: false,
      timeout: 90000,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:8790', ADMIN_PORT: '5198' },
    },
  ],
});
