# Verify Evidence: Weekly Production Readiness

Verified on 2026-07-06.

## Admin Code And Deploy

- Commit `614c53b`: fixed promoted content create data to use `categories.connect` and remove invalid fields.
- Commit `2b5a8f6`: auto-promoted contents now become `ready`.
- Commit `db35598`: Quail-published weekly issues are marked `published`.
- GitHub Actions `28798416636`: build and deploy succeeded for `db35598`.
- NAS status: `weekly-admin` running healthy; `weekly-admin-worker` running with health `none`.

Local checks:

```text
vitest inbox-promotion/inbox-scoring: 15 tests passed
vitest quail/worker-handlers/inbox-promotion: 13 tests passed
type-check: passed
lint: passed with existing warnings
build: passed
```

## Current Week

- Current issue created: `weekly_issues.id=92`, `issue_number=92`, slug `issue-92`, range starts `2026-07-06`.
- Sync job `auto_72cb0bb4-3c05-41f4-9095-cba3f4ba00c1`: terminal `empty` after source was already synced.
- Score job `auto_56f8e2b4-60d0-4e70-8165-b48ad3de50e5`: terminal `partial_success`; produced 47 ready contents, with parse errors isolated.
- Manual fallback apply run `auto_201ed424-464f-489f-bbc2-a4ae2f34c16b`: linked 12 contents to issue 92.
- Issue 92 totals: `total_items=12`.

## Publish And Public Site

- Quail publish run `auto_41734c48-14a7-45ae-9cfe-f699434cec9d`: `succeeded`, `deliverRequested=false`, Quail slug `issue-92`, post id `18583`.
- Production DB after manual status sync: issue 92 `status=published`, `published_at=2026-07-06 14:19:33`; linked contents status `published`.
- Astro frontend build generated `/weekly/issue-92/index.html`, `/rss.xml`, and `/search.json`.
- Deployed `dist/` to Aliyun OpenResty target.

Public smoke:

```text
https://weekly.mengpeng.tech/rss.xml -> HTTP 200, Last-Modified Mon, 06 Jul 2026 14:25:55 GMT, contains issue-92
https://weekly.mengpeng.tech/search.json -> contains 我不知道的周刊第 92 期 and /weekly/issue-92
https://weekly.mengpeng.tech/weekly/issue-92/ -> HTTP 200
```

## Scheduling

- NAS script installed: `/vol1/1000/Docker/weekly-admin/scripts/weekly-admin-job.sh`.
- Cron installed:
  - daily 09:15 sync
  - daily 09:30 score
  - Monday 09:45 candidates smoke
- Script smoke for candidates produced a non-empty JSON response.

## Known Residual Risk

- Weekly Astro GitHub Actions only builds when `sections/` changes, so DB-only weekly publishes still need manual build/deploy or a workflow fix.
- Quail publish before commit `db35598` required a manual DB status sync for issue 92; future deploys include the fix.
- `contents.auto_promoted` is documented in older specs but absent from current Prisma schema; use `inbox_items.auto_promoted` until a schema feature is opened.
