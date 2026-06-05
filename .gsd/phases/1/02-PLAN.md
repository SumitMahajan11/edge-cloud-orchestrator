---
phase: 2
plan: 1
wave: 1
depends_on: ["1-1"]
files_modified: []
autonomous: true
must_haves:
  truths:
    - "No floating promises remain in production files"
  artifacts: []
---

# Plan 2.1: Fix Floating Promises

<objective>
Find and fix all @typescript-eslint/no-floating-promises errors in production files by either adding await or marking them as void.
</objective>

<context>
- lint_results.txt
</context>

<tasks>

<task type="auto">
  <name>Identify files with floating promises</name>
  <files></files>
  <action>
    Extract all files and line numbers with no-floating-promises from lint_results.txt.
  </action>
  <verify>Check extracted list exists</verify>
  <done>List of files to fix is ready</done>
</task>

<task type="auto">
  <name>Fix floating promises in batches</name>
  <files></files>
  <action>
    For each identified line, either add 'await' (if inside async function and should be awaited) or 'void' (if fire-and-forget).
  </action>
  <verify>pnpm lint 2>&1 | grep "no-floating-promises" | wc -l</verify>
  <done>Zero floating promise errors remain</done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] No @typescript-eslint/no-floating-promises errors remain
</verification>

<success_criteria>

- [ ] 0 errors for no-floating-promises
      </success_criteria>
