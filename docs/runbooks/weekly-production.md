# Weekly Production Runbook

Last updated: 2026-07-06

## Weekly Cadence

1. Sync source inbox on NAS:
   - `/vol1/1000/Docker/weekly-admin/scripts/weekly-admin-job.sh sync`
2. Score and auto-promote high-value inbox items:
   - `/vol1/1000/Docker/weekly-admin/scripts/weekly-admin-job.sh score`
3. Review candidates in Admin weekly workbench, or inspect:
   - `/api/v1/weekly/candidates?weekOffset=0&limit=30&status=ready`
4. Apply suggestions or manual fallback to the current weekly issue.
5. Publish to Quail with `deliver=false` first. Send email only after manual confirmation.
6. Mark the issue published if needed, then rebuild and deploy the Astro frontend.

## NAS Schedule

Cron is installed on the NAS user crontab:

```cron
15 9 * * * /vol1/1000/Docker/weekly-admin/scripts/weekly-admin-job.sh sync >> /vol1/1000/Docker/weekly-admin/logs/cron.log 2>&1
30 9 * * * /vol1/1000/Docker/weekly-admin/scripts/weekly-admin-job.sh score >> /vol1/1000/Docker/weekly-admin/logs/cron.log 2>&1
45 9 * * 1 /vol1/1000/Docker/weekly-admin/scripts/weekly-admin-job.sh candidates >> /vol1/1000/Docker/weekly-admin/logs/cron.log 2>&1
```

The script reads `/vol1/1000/Docker/weekly-admin/.env` and uses `CRON_API_TOKEN`. Do not print or commit token values.

## Frontend Deploy

The public site lives in `/Users/yqg/personal/weekly/weekly`.

```bash
pnpm build
scp -r /Users/yqg/personal/weekly/weekly/dist/. ali:/opt/1panel/apps/openresty/openresty/www/sites/weekly.mengpeng.tech/index/
```

Smoke checks:

```bash
curl -sS -i https://weekly.mengpeng.tech/rss.xml
curl -sS https://weekly.mengpeng.tech/search.json | rg 'issue-92'
curl -sS -i https://weekly.mengpeng.tech/weekly/issue-92/
```

## Troubleshooting

- Worker unhealthy: `weekly-admin-worker` should be `running` with `health=none`; it must not inherit the web `/api/health` check.
- Sync/score run stuck: check `automation_runs`, BullMQ worker logs, then submit a fresh idempotency key. If a deploy interrupted a job, record the superseding run.
- Candidate empty: confirm promoted contents are `status='ready'` and `created_at` falls in the target week.
- Published in Quail but missing on public site: ensure `weekly_issues.status='published'`, linked contents are `published`, then rebuild and deploy Astro.
- Quail publish should use `deliver=false` first. `deliver=true` is a manual send step.
