import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: true,
    watch: {
      usePolling: false,
    },
    proxy: {
      // Task Service API
      '/api/tasks': {
        target: 'http://localhost:5010',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tasks/, '/tasks'),
      },
      // Node Service API
      '/api/nodes': {
        target: 'http://localhost:5011',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nodes/, '/nodes'),
      },
      // Scheduler Service API
      '/api/scheduler': {
        target: 'http://localhost:5003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/scheduler/, ''),
      },
      // WebSocket Gateway
      '/ws': {
        target: 'ws://localhost:5004',
        ws: true,
      },
      // SSE fallback
      '/sse': {
        target: 'http://localhost:5004',
        changeOrigin: true,
      },
      // Auth API (backend)
      '/api/auth': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Metrics API (backend)
      '/api/metrics': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Webhooks API (backend)
      '/api/webhooks': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Admin API (backend)
      '/api/admin': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Workflows API (backend)
      '/api/workflows': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Cost API (backend)
      '/api/cost': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Carbon API (backend)
      '/api/carbon': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
