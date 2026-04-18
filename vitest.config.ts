import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      '@edgecloud/shared-kernel': path.resolve(__dirname, './packages/shared-kernel/src/index.ts'),
      '@edgecloud/ml-scheduler': path.resolve(__dirname, './packages/ml-scheduler/src/index.ts'),
      '@edgecloud/observability': path.resolve(__dirname, './packages/observability/src/index.ts'),
    },
    // Ensure we don't try to mock built-ins that we need
    deps: {
      interopDefault: true,
    }
  },
})
