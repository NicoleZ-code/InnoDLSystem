import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: process.env.ADMIN_BASE ?? '/',
  envDir: '../..',
  server: {
    port: Number(process.env.ADMIN_PORT ?? 5189),
    strictPort: true,
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:8787',
      '/models/uploaded': process.env.API_PROXY_TARGET ?? 'http://localhost:8787',
      '/ws': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:8787', ws: true },
    },
  },
  build: { rollupOptions: { output: { manualChunks: { antd: ['antd'], echarts: ['echarts'] } } } },
});
