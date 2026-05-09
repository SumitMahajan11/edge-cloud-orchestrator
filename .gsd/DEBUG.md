# Debug Session: API Versioning Test Failure

## Symptom
`DataCloneError` occurs when running `apps/api/tests/versioning.test.ts`.

**When:** During `vitest run`.
**Expected:** Tests should run and pass (or fail with assertion errors).
**Actual:** `DataCloneError: function transformRequest(data, headers) ... could not be cloned.`

## Evidence
- **Error Trace:**
```
DataCloneError: function transformRequest(data, headers) {
      const contentType = headers.getContentType() || '';
      cons...<omitted>... } could not be cloned.
 ❯ new DOMException node:internal/per_context/domexception:66:5
 ❯ post node_modules/.pnpm/vitest@1.6.0_@types+node@24.12.0/node_modules/vitest/dist/vendor/utils.0uYuCbzo.js:10:12
 ❯ node_modules/.pnpm/vitest@1.6.0_@types+node@24.12.0/node_modules/vitest/dist/vendor/index.8bPxjt7g.js:48:11
 ❯ sendCall node_modules/.pnpm/vitest@1.6.0_@types+node@24.12.0/node_modules/vitest/dist/vendor/index.8bPxjt7g.js:33:16
 ❯ node_modules/.pnpm/vitest@1.6.0_@types+node@24.12.0/node_modules/vitest/dist/vendor/rpc.joBhAkyK.js:79:18
```
- **Context:** The error happens in `versioning.test.ts` which uses `axios` to make requests to the API.

## Hypotheses

| # | Hypothesis | Likelihood | Status |
|---|------------|------------|--------|
| 1 | Vitest is trying to serialize an Axios response/error object that contains non-cloneable functions. | 90% | UNTESTED |
| 2 | Axios configuration in `beforeAll` is leaking non-serializable state. | 10% | UNTESTED |

## Attempts

### Attempt 1
**Testing:** H1 — Serialization issue.
**Action:** Inspect `versioning.test.ts` to see how responses are handled and if any large objects are being passed to `expect` or returned from tests.
**Result:** Pending.
