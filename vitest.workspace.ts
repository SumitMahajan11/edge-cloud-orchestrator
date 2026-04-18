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
    test: {
      ...sharedConfig.test,
      name: 'shared-kernel',
      root: './packages/shared-kernel',
      include: ['src/domain/__tests__/**/*.spec.ts'],
    }
  },
  {
    ...sharedConfig,
    test: {
      ...sharedConfig.test,
      name: 'ml-scheduler',
      root: './packages/ml-scheduler',
      include: ['src/__tests__/**/*.spec.ts'],
    }
  },
  {
    ...sharedConfig,
    test: {
      ...sharedConfig.test,
      name: 'api',
      root: './apps/api',
      include: ['src/services/__tests__/**/*.spec.ts'],
    }
  }
])
