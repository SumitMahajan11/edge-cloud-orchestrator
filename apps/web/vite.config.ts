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
      '/api/auth': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
      '/api/tasks': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
      '/api/nodes': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
      '/api/scheduler': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
      '/api/metrics': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
      '/api/webhooks': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
      '/api/admin': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
      '/api/workflows': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
      '/api/cost': {
        target: 'http://localhost:3090',
        changeOrigin: true,
      },
      '/api/carbon': {
        target: 'http://localhost:3090',
        changeOrigin: true,
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