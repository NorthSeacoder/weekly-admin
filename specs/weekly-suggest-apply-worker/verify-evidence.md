# Verify Evidence: Weekly Suggest Apply Worker

**Workspace**: `weekly-suggest-apply-worker`
**Date**: 2026-07-07

## Local Verification

- PASS: `rtk pnpm vitest run src/lib/jobs/definitions.test.ts src/lib/jobs/worker-handlers.test.ts src/lib/automation/weekly-current.test.ts src/app/api/v1/weekly/current/route.test.ts src/app/api/v1/weekly/suggestions/route.test.ts 'src/app/api/v1/weekly/suggestions/[id]/apply/route.test.ts' src/app/api/v1/openapi.json/route.test.ts`
  - 7 test files passed.
  - 38 tests passed.
- PASS: `rtk pnpm type-check`
- PASS: `rtk pnpm lint --quiet`
- PASS: `rtk pnpm build`

## NAS Smoke

Pending deploy.
