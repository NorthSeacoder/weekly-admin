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

- PASS: GitHub Actions `Build and Deploy to NAS` run `28825070968` completed with `success` for commit `0bb9f12`.
- PASS: NAS containers are running image revision `0bb9f1214631c77bbba42ff06be5c5a73b5b0d13`.
- PASS: `GET /api/v1/weekly/current?weekOffset=0` returned issue `92`, range `2026-07-05` to `2026-07-11`, issue dates `2026-03-29` to `2026-07-11`, status `published`, linked `12`.
- PASS: `POST /api/v1/weekly/suggestions` with a Hermes `empty` register artifact returned queued run `auto_9b69e2ac-33e8-43bc-805e-c4aa4aa8d512`.
- PASS: `GET /api/v1/jobs/auto_9b69e2ac-33e8-43bc-805e-c4aa4aa8d512` returned status `empty`, durable status `empty`, worker `worker-34`, attempts `2`.
- PASS: `/vol1/1000/Docker/weekly-admin/scripts/weekly-hermes-ops.sh notify` sent to `wecom:MengPeng`.

## Notes

- The host-side Hermes helper was copied to NAS scripts because the deployment path does not check out the repository on the host.
- The helper streams the generated message into `docker exec -i hermes-agent hermes send --file -`; passing a host temp path into the container does not work.
