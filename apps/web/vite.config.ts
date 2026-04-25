import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: false, // Disable HMR to prevent auto-refresh
    watch: {
      usePolling: false,
      ignored: ['**/*'], // Ignore ALL file changes to prevent auto-refresh
    },
    proxy: {
      // All APIs now point to unified backend on port 3090
      // Rewrite /api/* → /v1/* to match backend route prefix
      '/api/auth': {
        target: 'http://localhost:3090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1'),
      },
      '/api/tasks': {
        target: 'http://localhost:3090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1'),
      },
      '/api/nodes': {
        target: 'http://localhost:3090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1'),
      },
      '/api/scheduler': {
        target: 'http://localhost:3090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1'),
      },
      '/api/metrics': {
        target: 'http://localhost:3090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1'),
      },
      '/api/webhooks': {
        target: 'http://localhost:3090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1'),
      },
      '/api/admin': {
        target: 'http://localhost:3090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1'),
      },
      '/api/workflows': {
        target: 'http://localhost:3090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1'),
      },
      '/api/cost': {
        target: 'http://localhost:3090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1'),
      },
      '/api/carbon': {
        target: 'http://localhost:3090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1'),
      },
      '/ws': {
        target: 'ws://localhost:3090',
        ws: true,
      },
      '/sse': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
    },
  },
})