# Plan 1.1: TypeScript Configuration Hardening

<objective>
Fix TS5101 baseUrl deprecation, enable strict mode across all packages, and resolve resulting type errors.
</objective>

<context>
- tsconfig.base.json
- tsconfig.json
- apps/*/tsconfig.json
- packages/*/tsconfig.json
</context>

<tasks>

<task type="auto">
  <name>Fix baseUrl deprecation and align apps configurations</name>
  <files>
    tsconfig.json
    apps/api/tsconfig.json
    apps/web/tsconfig.json
  </files>
  <action>
    - Remove "baseUrl" from root tsconfig.json.
    - Ensure apps/api uses "moduleResolution": "NodeNext".
    - Ensure apps/web uses "moduleResolution": "bundler".
  </action>
  <verify>pnpm tsc --noEmit</verify>
  <done>baseUrl is removed and apps compile.</done>
</task>

<task type="auto">
  <name>Enforce strict mode across all packages</name>
  <files>
    packages/*/tsconfig.json
  </files>
  <action>
    - Update all packages/*/tsconfig.json to extend ../../tsconfig.base.json.
    - Ensure "strict": true is present or inherited.
    - Add explicit strict flags if missing in tsconfig.base.json: noImplicitAny, strictNullChecks, noImplicitReturns, noFallthroughCasesInSwitch, noUncheckedIndexedAccess.
  </action>
  <verify>Check package tsconfigs</verify>
  <done>All packages have strict mode enabled.</done>
</task>

<task type="auto">
  <name>Resolve strict mode errors in packages</name>
  <files>
    packages/**/*.ts
  </files>
  <action>
    - Run tsc per package.
    - Resolve errors in order: shared-kernel, ml-scheduler, circuit-breaker, saga, etc.
  </action>
  <verify>pnpm tsc --noEmit in each package</verify>
  <done>Zero TS errors across all packages.</done>
</task>

</tasks>

<verification>
- [ ] No TS5101 warnings
- [ ] All packages have strict: true
- [ ] pnpm tsc --noEmit returns 0 errors
</verification>

<success_criteria>
- [ ] TypeScript configuration modernized
- [ ] Strict mode enabled everywhere
- [ ] Base codebase is type-safe
</success_criteria>
