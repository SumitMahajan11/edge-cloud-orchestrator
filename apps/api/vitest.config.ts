import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
      LOG_LEVEL: 'fatal',
    },
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
