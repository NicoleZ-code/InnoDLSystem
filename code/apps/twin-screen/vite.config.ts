import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  envDir: '../..',
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/') },
  server: {
    port: 5187,
    strictPort: true,
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:8787',
      '/models/uploaded': process.env.API_PROXY_TARGET ?? 'http://localhost:8787',
      '/ws': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:8787', ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { cesium: ['cesium'], three: ['three'], react: ['react', 'react-dom'] },
      },
    },
  },
});
