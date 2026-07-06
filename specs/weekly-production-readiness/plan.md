# Implementation Plan: Weekly Production Readiness

**Workspace**: `weekly-production-readiness` | **Date**: 2026-07-06 | **Spec**: [spec.md](spec.md) | **Status**: closeout PASS  
**Input**: Feature specification from `specs/weekly-production-readiness/spec.md`

---

## Summary

用一个生产 readiness feature 收口后台、NAS 自动化、Quail dry-run 和 weekly Astro 前端发布链路。推荐方案是先把当前周 issue 和 worker/job 可靠性修到可验证，再建立 n8n/crontab 调度和前端 rebuild/deploy，最后用端到端 evidence 验收。

---

## Architecture Overview

```text
Karakeep/RSS/manual sources
  -> Admin /api/v1/jobs/sync
  -> Redis/BullMQ weekly-admin-worker
  -> inbox_items / contents / automation_runs
  -> score job + candidate/suggestion/apply
  -> weekly_issues + weekly_content_items
  -> weekly publish job -> Quail API -> quail_* fields
  -> weekly Astro build reads MySQL published issues
  -> static site / RSS / search.json
```

NAS 已有可复用服务：`weekly-admin`、`weekly-admin-worker`、`redis`、`mysql`、`karakeep`、`karakeep-meilisearch`、`n8n`、`hermes-agent`、`umami`、`traefik`。本 feature 不新建基础设施，优先让这些现有服务协同。

---

## Producer-Consumer Matrix

| Producer | Artifact | Consumer | Consumption Proof |
|---|---|---|---|
| Admin auto-create / manual DB operation | 当前周 `weekly_issues` draft | Admin workbench / Astro front-end | SQL 查询和前端构建输出包含 issue |
| Sync/score jobs | `automation_runs` + inbox/content 状态 | Candidate/suggest/apply | runs terminal status + candidate count |
| Workbench apply / manual fallback | `weekly_content_items` | Quail publisher / Astro front-end | issue content count 与页面/RSS 输出 |
| Weekly publish worker | `quail_post_id`, `quail_published_at` | 运营验收和后续 republish guard | SQL 查询 + worker logs |
| Astro build/deploy | static HTML/RSS/search JSON | 读者和订阅工具 | public URL smoke + Last-Modified 更新 |
| n8n/crontab | scheduled HTTP calls | Admin automation routes | cron/n8n config + latest run evidence |

**孤儿 artifact 处理**: 若 Hermes preview artifact 暂未进入本周生产，不视为阻塞；人工 fallback 可以消费 candidate/content 产物完成本周上线。

---

## Quality Attribute Targets

| 属性 | 目标 | 设计影响 | 验证方式 |
|---|---|---|---|
| 可用性 | 本周可发布 | 当前周优先，历史补齐后置 | SQL + public smoke |
| 可观测性 | 每个副作用有 evidence | 使用 automation_runs/worker logs/Actions | run id 和日志截图/摘要 |
| 安全 | 不泄露 secret | 只输出 sanitized env，token 不落仓库 | git diff 和命令输出检查 |
| 可恢复 | 失败可重试或回滚 | 使用 existing retry endpoint，前端 deploy 可回滚 | retry smoke / Actions status |

---

## Bugfix Strategy

| Field | Value |
|---|---|
| Observed Behavior | 公开站静态数据停留在 2025-11；production issue 只到 2026-03-28；worker 曾 unhealthy。 |
| Expected Behavior | 当前周 issue 可生产，worker running，前端 public 输出最新周刊。 |
| Reproduction Status | reproduced via NAS docker ps、public headers、production SQL。 |
| Root Cause Hypothesis | 已完成后台能力但缺少生产 readiness 编排：current-week issue 未创建，front rebuild 未接入，worker healthcheck 继承错误。 |
| Fix Boundary | 本周生产闭环、NAS 调度、前端 rebuild/deploy、运行手册；不做历史全量治理。 |
| Failed Attempt Handling | 若 dry-run publish/front deploy 失败，在 verify-evidence 记录 attempt、root cause、下一证据。 |
| Regression Guard Strategy | focused tests、type-check、lint/build、NAS worker status、SQL queries、public smoke。 |
| Diffusion Check Strategy | 检查 sync/score/publish/resync job、weekly issue status、RSS/search output 和 cron/n8n。 |
| Verification Path | local checks + GitHub Actions + NAS runtime + public URL + DB evidence。 |

---

## Key Design Decisions

### ADR-001: 当前周优先，历史缺口后置

- **背景**: 生产库最新 issue 到 2026-03-28，距离 2026-07-06 有多周缺口。
- **选项**:
  - A: 一次性补齐所有历史 issue 和内容。
  - B: 先创建当前周 issue 并完成本周发布链路。
- **结论**: 选择 B。历史补齐容易放大风险，不应阻塞本周恢复运营。
- **影响**: 验收以当前周可运行作为 P1；历史 backfill 作为后续 feature。
- **来源**: production SQL evidence, UNVERIFIED business preference inferred from user goal.

### ADR-002: 调度优先复用 n8n，crontab 作为 fallback

- **背景**: NAS 已运行 n8n，当前 crontab 没有 weekly-admin sync/score。
- **结论**: 优先在 n8n 配置定时 HTTP workflow；若 n8n 权限或操作成本高，写 NAS crontab 脚本调用 `/api/v1/jobs/*`。
- **影响**: 本 feature 至少落地一种可重复调度，并记录另一种作为 fallback。

### ADR-003: 前端保持静态构建，但必须显式重建

- **背景**: weekly Astro 前端读取 MySQL published issue 后生成静态站；当前公开 `search.json/rss.xml` 仍是 2025-11。
- **结论**: 不在本 feature 改成动态站，先建立 rebuild/deploy 触发和验收。
- **影响**: 当前周发布后必须跑 front build/deploy；未来可接 webhook 或 Actions dispatch。

---

## Module Design

### Module: Admin Production Issue Bootstrap

**职责**: 创建或确认当前周 issue，关联内容，保持统计字段正确。

**改动概述**: 优先调用现有 `autoCreateWeeklyIssue`/workbench 服务；必要时使用受控 SQL 或 API fallback，并记录 evidence。

### Module: NAS Job Orchestration

**职责**: 让 sync/score/publish/resync 由 NAS Redis worker 处理。

**改动概述**: worker healthcheck 已在 `docker/docker-compose.nas.yml` 禁用；继续验证 token scopes、job submission、worker terminal status、retry。

### Module: Schedule Integration

**职责**: 给每周运营提供自动触发入口。

**改动概述**: 优先 n8n workflow；fallback 是 `/vol1/1000/Docker/weekly-admin/scripts/*.sh` + crontab。每个 request 必须带 stable `Idempotency-Key`。

### Module: Frontend Rebuild/Deploy

**职责**: 让 public weekly site 消费最新 published issue。

**改动概述**: 确认 weekly repo build/deploy 命令和 NAS/GitHub Actions 路径；避免混入依赖升级支线；完成一次 production smoke。

### Module: Runbook And Evidence

**职责**: 让后续每周可以照着跑。

**改动概述**: 新增 docs/runbooks/weekly-production.md，记录 weekly issue、job、Quail dry-run、front deploy、monitoring、rollback。

---

## Project Structure

```text
specs/weekly-production-readiness/
  spec.md
  plan.md
  tasks.md
  context-manifest.md
  verify-evidence.md
  acceptance.md

docs/runbooks/
  weekly-production.md
```

---

## Risks and Tradeoffs

- 直接触发 Quail `deliver=true` 风险高，本 feature 只 dry-run publish，正式发信人工确认。
- 当前 weekly 前端可能有未完成依赖升级计划，应使用稳定 main/生产部署路径。
- n8n UI 配置可能无法从 CLI 完全自动化；若受阻，先落 crontab fallback。
- production DB 标题在 mysql CLI 显示乱码可能是终端字符集，不直接作为阻塞，但 public 输出需正常验证。

---

## Verification Strategy

- Local Admin: focused tests、`pnpm type-check`、`pnpm lint`、`pnpm build`。
- GitHub Actions: latest deploy run success for Admin.
- NAS: `weekly-admin` healthy，`weekly-admin-worker` running health none，Redis/MySQL/Karakeep/n8n present。
- DB: current-week issue exists，content count > 0，publish fields after dry-run。
- API/job: sync/score/publish returns queued/terminal status with automation_runs.
- Frontend: weekly build succeeds and public `/weekly`, `/rss.xml`, `/search.json` include latest issue.
- Docs: runbook exists and includes weekly cadence + failure recovery.

---

## Stage Readiness

- 是否需要 `data-model.md`：不需要。使用既有 `weekly_issues`、`weekly_content_items`、`automation_runs`、Redis job，不新增 schema。
- 下一步建议：`tasks`
- 阻塞项：无；可直接拆任务并执行。
