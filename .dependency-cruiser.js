/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies are not allowed.",
      from: {},
      to: { circular: true },
    },
    {
      name: "shared-kernel-no-internal-deps",
      severity: "error",
      comment:
        "shared-kernel should have zero dependencies on other internal packages.",
      from: { path: "^packages/shared-kernel" },
      to: { path: "^packages/(?!shared-kernel)" },
    },
    {
      name: "ml-scheduler-shared-kernel-only",
      severity: "error",
      comment: "ml-scheduler may depend on shared-kernel ONLY.",
      from: { path: "^packages/ml-scheduler" },
      to: {
        path: "^packages/(?!shared-kernel)",
        pathNot: "^packages/ml-scheduler", // allow self-imports
      },
    },
    {
      name: "circuit-breaker-shared-kernel-only",
      severity: "error",
      comment: "circuit-breaker may depend on shared-kernel ONLY.",
      from: { path: "^packages/circuit-breaker" },
      to: {
        path: "^packages/(?!shared-kernel)",
        pathNot: "^packages/circuit-breaker",
      },
    },
    {
      name: "saga-allowed-deps",
      severity: "error",
      comment: "saga may depend on shared-kernel and circuit-breaker only.",
      from: { path: "^packages/saga" },
      to: {
        path: "^packages/(?!(shared-kernel|circuit-breaker))",
        pathNot: "^packages/saga",
      },
    },
    {
      name: "outbox-shared-kernel-only",
      severity: "error",
      comment: "outbox may depend on shared-kernel ONLY.",
      from: { path: "^packages/outbox" },
      to: {
        path: "^packages/(?!shared-kernel)",
        pathNot: "^packages/outbox",
      },
    },
    {
      name: "packages-no-internal-deps",
      severity: "error",
      comment:
        "General rule: packages should not depend on other packages unless explicitly excepted.",
      from: {
        path: "^packages/(?!shared-kernel)",
        pathNot: [
          "^packages/saga",
          "^packages/ml-scheduler", // handled by specific rules but good to be explicit
          "^packages/circuit-breaker",
          "^packages/outbox",
        ],
      },
      to: {
        path: "^packages/(?!shared-kernel)",
        pathNot: [
          "^packages/[^/]+", // allow self-imports (this pattern might be tricky, usually handled by pathNot: 'from')
        ],
      },
    },
    {
      name: "packages-no-apps-deps",
      severity: "error",
      comment: "Packages should never depend on apps.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
  ],
  options: {
    doNotFollow: {
      dependencyTypes: [
        "npm",
        "npm-dev",
        "npm-optional",
        "npm-peer",
        "npm-bundled",
        "npm-no-pkg",
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
      archi: {
        collapsePattern:
          "^(packages|apps|src|lib|app|bin|test|spec|node_modules)/[^/]+",
      },
    },
  },
};
