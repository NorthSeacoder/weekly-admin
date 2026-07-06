# Verify Evidence: Weekly Production Readiness

Verified on 2026-07-06.

## Admin Code And Deploy

- Commit `614c53b`: fixed promoted content create data to use `categories.connect` and remove invalid fields.
- Commit `2b5a8f6`: auto-promoted contents now become `ready`.
- Commit `db35598`: Quail-published weekly issues are marked `published`.
- Commit `fde3f72`: auto-create and the editor now keep issue numbers continuous and allow one issue to span missed weeks; `getWeekRange` now uses the historical Sunday-Saturday weekly cycle with date-only boundaries.
- Post-closeout editor guard: existing cross-week issues preserve their stored `start_date` and `end_date` when opened in the editor, instead of being normalized back to a single week.
- GitHub Actions `28798416636`: build and deploy succeeded for `db35598`.
- GitHub Actions `28801071716`: build and deploy succeeded for `fde3f72`.
- NAS status: `weekly-admin` running healthy; `weekly-admin-worker` running with health `none`.

Local checks:

```text
vitest inbox-promotion/inbox-scoring: 15 tests passed
vitest quail/worker-handlers/inbox-promotion: 13 tests passed
type-check: passed
lint: passed with existing warnings
build: passed
post-closeout focused vitest/type-check/lint/build: passed after the editor guard
```

## Current Week

- Current issue created: `weekly_issues.id=92`, `issue_number=92`, slug `issue-92`.
- Continuity correction: issue 92 should cover `2026-03-29` through `2026-07-11`, preserving issue numbering while allowing a cross-week range instead of generating empty gap issues.
- Production DB after correction: issue 92 is `published`, `total_items=12`, `quail_post_slug=issue-92`; issue 91 ends `2026-03-28`, so issue 92 starts on the next day.
- Sync job `auto_72cb0bb4-3c05-41f4-9095-cba3f4ba00c1`: terminal `empty` after source was already synced.
- Score job `auto_56f8e2b4-60d0-4e70-8165-b48ad3de50e5`: terminal `partial_success`; produced 47 ready contents, with parse errors isolated.
- Manual fallback apply run `auto_201ed424-464f-489f-bbc2-a4ae2f34c16b`: linked 12 contents to issue 92.
- Issue 92 totals: `total_items=12`.
- Candidate smoke after deploy: `/api/v1/weekly/candidates?weekOffset=0&limit=3&status=ready` returned `range.startDate=2026-07-05`, `range.endDate=2026-07-11`, `total=3`, status `succeeded`.

## Publish And Public Site

- Quail publish run `auto_41734c48-14a7-45ae-9cfe-f699434cec9d`: `succeeded`, `deliverRequested=false`, Quail slug `issue-92`, post id `18583`.
- Production DB after manual status sync: issue 92 `status=published`, `published_at=2026-07-06 14:19:33`; linked contents status `published`.
- Astro frontend build generated `/weekly/issue-92/index.html`, `/rss.xml`, and `/search.json`.
- Deployed `dist/` to Aliyun OpenResty target.

Public smoke:

```text
https://weekly.mengpeng.tech/rss.xml -> HTTP 200, Last-Modified Mon, 06 Jul 2026 15:03:07 GMT, contains issue-92
https://weekly.mengpeng.tech/search.json -> contains 我不知道的周刊第 92 期, date 2026-07-10T16:00:00.000Z, and /weekly/issue-92
https://weekly.mengpeng.tech/weekly/issue-92/ -> HTTP 200, Last-Modified Mon, 06 Jul 2026 15:03:19 GMT
```

## Scheduling

- NAS script installed: `/vol1/1000/Docker/weekly-admin/scripts/weekly-admin-job.sh`.
- Cron installed:
  - daily 09:15 sync
  - daily 09:30 score
  - Monday 09:45 candidates smoke
- Script smoke for candidates produced a non-empty JSON response.
- Runtime health after deploy: database healthy, jobQueue healthy with `waiting=0`, `delayed=0`, `active=0`, `failed=0`; overall `/api/health` is degraded only because Meilisearch health at `http://100.113.231.101:7700/health` is unavailable.

## Known Residual Risk

- Weekly Astro GitHub Actions only builds when `sections/` changes, so DB-only weekly publishes still need manual build/deploy or a workflow fix.
- Quail publish before commit `db35598` required a manual DB status sync for issue 92; future deploys include the fix.
- `contents.auto_promoted` is documented in older specs but absent from current Prisma schema; use `inbox_items.auto_promoted` until a schema feature is opened.
- Admin human `/api/weekly/auto-create` is cookie-auth only; cron/automation should continue using `/api/v1/*` routes and DB/workbench evidence for production checks.
