import { defineWorkspace } from "vitest/config";
import path from "path";

const sharedConfig = {
  test: {
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "./vitest.setup.ts")],
    hookTimeout: 60000,
    testTimeout: 60000,
    passWithNoTests: true,
    alias: {
      "@edgecloud/shared-kernel": path.resolve(
        __dirname,
        "./packages/shared-kernel/src/index.ts",
      ),
      "@edgecloud/ml-scheduler": path.resolve(
        __dirname,
        "./packages/ml-scheduler/src/index.ts",
      ),
      "@edgecloud/observability": path.resolve(
        __dirname,
        "./packages/observability/src/index.ts",
      ),
      "@edgecloud/event-bus": path.resolve(
        __dirname,
        "./packages/event-bus/src/index.ts",
      ),
      "@edgecloud/circuit-breaker": path.resolve(
        __dirname,
        "./packages/circuit-breaker/src/index.ts",
      ),
      "@edgecloud/saga": path.resolve(
        __dirname,
        "./packages/saga/src/index.ts",
      ),
    },
  },
};

export default defineWorkspace([
  {
    ...sharedConfig,
    root: "./packages/shared-kernel",
    test: {
      ...sharedConfig.test,
      name: "shared-kernel",
      include: ["**/*.spec.ts", "**/*.test.ts"],
    },
  },
  {
    ...sharedConfig,
    root: "./packages/ml-scheduler",
    test: {
      ...sharedConfig.test,
      name: "ml-scheduler",
      include: ["**/*.spec.ts", "**/*.test.ts"],
    },
  },
  {
    ...sharedConfig,
    root: "./apps/api",
    test: {
      ...sharedConfig.test,
      name: "api",
      include: ["**/*.spec.ts", "**/*.test.ts"],
    },
  },
  {
    ...sharedConfig,
    root: "./tests/e2e",
    test: {
      ...sharedConfig.test,
      name: "e2e",
      include: ["**/*.test.ts"],
      env: {
        FORCE_MOCK_DB: "false",
        FORCE_MOCK_REDIS: "true",
      },
    },
  },
  {
    ...sharedConfig,
    root: "./tests/integration",
    test: {
      ...sharedConfig.test,
      name: "integration",
      include: ["**/*.test.ts"],
      alias: {
        ...sharedConfig.test?.alias,
        "@prisma/client": path.resolve(
          __dirname,
          "./tests/integration/client/index.js",
        ),
      },
      env: {
        FORCE_MOCK_DB: "false",
        FORCE_MOCK_REDIS: "true",
      },
    },
  },
  {
    ...sharedConfig,
    root: "./tests/contract",
    test: {
      ...sharedConfig.test,
      name: "contract",
      include: ["**/*.test.ts"],
    },
  },
]);
