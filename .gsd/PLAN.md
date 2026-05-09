---
phase: 1
plan: 1
wave: 1
depends_on: []
files_modified: ["tests/contract/v2-api-contract.test.ts", "tests/contract/schema-drift.test.ts", "tests/contract/v1-deprecation.test.ts"]
autonomous: true
---

# Plan 1.1: Create Contract Testing Suite

<objective>
Implement three specific contract test files as requested to ensure API integrity, prevent schema drift, and enforce deprecation policies.
</objective>

<context>
- apps/api/openapi-v2.yml
- apps/api/src/index.ts
- tests/contract/full-suite.test.ts (reference)
</context>

<tasks>

<task type="auto">
  <name>Create v2-api-contract.test.ts</name>
  <files>tests/contract/v2-api-contract.test.ts</files>
  <action>
    Create a test file that:
    1. Loads apps/api/openapi-v2.yml.
    2. Initializes the Fastify server from apps/api/src/index.ts.
    3. Iterates through all endpoints in the spec and sends requests.
    4. Asserts that the response matches the schema (status code, body shape).
    5. Asserts that no endpoint exists in the server that is NOT in the spec.
    AVOID: Starting a real network server; use app.inject for performance and reliability.
  </action>
  <verify>npx vitest tests/contract/v2-api-contract.test.ts</verify>
  <done>All spec endpoints are tested and undocumented endpoints are flagged.</done>
</task>

<task type="auto">
  <name>Create schema-drift.test.ts</name>
  <files>tests/contract/schema-drift.test.ts</files>
  <action>
    Create a test file that:
    1. Generates the OpenAPI spec fresh from the running server (using app.swagger()).
    2. Diffs it against the committed apps/api/openapi-v2.yml.
    3. Asserts zero diff and fails loudly if there is a mismatch.
    AVOID: Non-deterministic diffs; sort keys in both specs before comparison.
  </action>
  <verify>npx vitest tests/contract/schema-drift.test.ts</verify>
  <done>Schema drift is detected automatically.</done>
</task>

<task type="auto">
  <name>Create v1-deprecation.test.ts</name>
  <files>tests/contract/v1-deprecation.test.ts</files>
  <action>
    Create a test file that:
    1. Sends requests to v1 endpoints.
    2. Asserts 'Deprecation: true' and 'Sunset' headers are present.
    3. Asserts 'Sunset' date is at least 30 days in the future.
    4. Asserts v1 endpoints still return correct data.
  </action>
  <verify>npx vitest tests/contract/v1-deprecation.test.ts</verify>
  <done>V1 deprecation policies are enforced.</done>
</task>

</tasks>

<success_criteria>
- [x] v2-api-contract.test.ts passes
- [x] schema-drift.test.ts passes
- [x] v1-deprecation.test.ts passes
</success_criteria>
