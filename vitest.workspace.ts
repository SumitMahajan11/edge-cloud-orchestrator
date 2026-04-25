import { defineWorkspace } from 'vitest/config'
import path from 'path'

const sharedConfig = {
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
    alias: {
      '@edgecloud/shared-kernel': path.resolve(__dirname, './packages/shared-kernel/src/index.ts'),
      '@edgecloud/ml-scheduler': path.resolve(__dirname, './packages/ml-scheduler/src/index.ts'),
      '@edgecloud/observability': path.resolve(__dirname, './packages/observability/src/index.ts'),
    }
  }
}

export default defineWorkspace([
  {
    ...sharedConfig,
    root: './packages/shared-kernel',
    test: {
      ...sharedConfig.test,
      name: 'shared-kernel',
      include: ['src/domain/__tests__/**/*.spec.ts', 'src/**/*.spec.ts'],
    }
  },
  {
    ...sharedConfig,
    root: './packages/ml-scheduler',
    test: {
      ...sharedConfig.test,
      name: 'ml-scheduler',
      include: ['src/__tests__/**/*.spec.ts'],
    }
  },
  {
    ...sharedConfig,
    root: './apps/api',
    test: {
      ...sharedConfig.test,
      name: 'api',
      include: ['src/services/__tests__/**/*.spec.ts', 'tests/**/*.test.ts'],
    }
  }
])
