# Roadmap: Weekly Automation Runtime

**Umbrella**: `weekly-automation-runtime-roadmap`
**Created**: 2026-06-22
**Status**: active
**Current Feature**: `frontend-db-deploy-automation` (verify)
**Next Recommended Feature**: `frontend-db-deploy-automation`

---

## Summary

本 roadmap 将 `admin-modernization-roadmap` closeout 后剩余的自动化执行能力按可交付 feature 重新组织。优先级采用用户确认的“周刊自动化优先”：先把现有 Karakeep 重跑和周刊发布/建议/应用等长任务纳入 Redis/worker/status 体系，再补完整任务中心、Hermes 外部 runtime 和安全清债。

当前 `karakeep-resync-redis-state`、`weekly-publish-worker`、`weekly-production-readiness`、`weekly-suggest-apply-worker` 与 `hermes-runtime-integration` 已完成。现在进入 `frontend-db-deploy-automation`：补 public weekly 前端的 DB-only rebuild/deploy 自动化，同时不触碰另一个 agent 正在修改的 Astro 样式组件。

---

## Current State

| Field | Value |
|---|---|
| Current feature | `frontend-db-deploy-automation` |
| specs/.active expected | `frontend-db-deploy-automation` |
| Current stage | `verify` |
| Next stage | `closeout` after frontend GitHub token is configured and dispatch smoke passes |
| Current objective | 补齐 Admin/NAS 触发 public weekly Astro rebuild/deploy 的链路 |

---

## Feature Roadmap

| Feature | Goal | Status | Depends On | Start Condition | Recommended Stage | Notes |
|---|---|---|---|---|---|---|
| `karakeep-resync-redis-state` | 将 `/api/content/[id]/karakeep-resync` 的进程内 `Map` 状态迁到 Redis/worker/status，支持重启恢复和可观测失败 | done | `redis-job-orchestration` | 现有 sync/score Redis worker 已 PASS，Karakeep resync 仍为进程内状态 | closeout | 已 PASS；不迁移 weekly publish |
| `weekly-publish-worker` | 将周刊 Quail publish 从同步 automation route 迁入 queued worker，保留 idempotency 和 external side-effect evidence | done | `karakeep-resync-redis-state`, `agent-and-automation-contracts`, `redis-job-orchestration` | Karakeep slice closeout 后；现有 publish route contract 稳定 | closeout | 已 PASS；publish route 现在返回 queued job，由 worker 执行 Quail 发布 |
| `weekly-production-readiness` | 收口当前周 issue、NAS sync/score/publish 调度、Quail dry-run、weekly Astro 前端 rebuild/deploy 和运行手册 | done | `weekly-publish-worker` | 用户要求本周开始正常投入使用，并可利用 NAS 现有服务 | closeout | 已 PASS；历史 backfill、Hermes runtime 和任务中心后置 |
| `weekly-suggest-apply-worker` | 将 weekly suggest/apply 的耗时或副作用路径纳入 worker/status；人工确认仍是写回边界 | done | `weekly-publish-worker`, `hermes-weekly-intelligence` | publish worker 验证通过；明确 suggest/apply 哪些步骤需要异步化 | closeout | 已 PASS；current issue discovery、queued suggest/apply 和 Hermes/WeCom ops helper 已部署验证 |
| `hermes-runtime-integration` | 将外部 Hermes one-shot runtime 接入 Admin preview contract 和 WeCom 通知 | done | `weekly-suggest-apply-worker` | Admin-side preview/apply/status 已稳定，外部 Hermes runtime 归属明确 | closeout | 已 PASS；真实 Hermes dry-run/register/notify 和 WeCom smoke 已通过 |
| `frontend-db-deploy-automation` | 在 Admin DB-only 周刊变更后自动触发 public weekly Astro rebuild/deploy，不触碰前端样式 | in-progress | `weekly-production-readiness`, `hermes-runtime-integration` | public frontend 已确认读取数据库，但 DB-only publish 后仍需手动 rebuild/deploy | verify | 已补前端 workflow dispatch 和 Admin/NAS trigger script；待 `WEEKLY_FRONTEND_GITHUB_TOKEN` 后做 dispatch smoke |
| `task-center-v1` | 在已有 dashboard/workbench summary 之上建立统一任务中心页面或视图 | backlog | `weekly-publish-worker`, `weekly-suggest-apply-worker`, `hermes-runtime-integration` | 至少 3 类 workflow 已进入 Redis/status，任务中心有足够真实数据 | specify | 先有能力再做完整 UI，避免空壳任务中心 |
| `hermes-memory-read-model` | 评估并落地 hermes-db/PG/pgvector 读模型，用于偏好记忆、artifact search 或语义召回 | backlog | `hermes-runtime-integration` | runtime 已稳定后，再看是否需要独立读模型，不迁移 Admin MySQL 事实源 | specify | 不阻塞本周生产使用；避免为抽象记忆引入第二事实源 |
| `automation-runtime-hardening` | 补 secret rotation、token 管理 UI、审计面板、Meili circuit breaker、Prisma/GitHub Actions runtime 升级 | backlog | `weekly-publish-worker` | 自动化核心副作用 worker 化后，集中做安全和运行时清债 | specify | 用户选择自动化优先，因此本项后置但不取消 |

---

## Completion Log

| Feature | Date | Verdict | Evidence | Impact On Roadmap |
|---|---|---|---|---|
| `redis-job-orchestration` | 2026-06-08 | PASS | `specs/redis-job-orchestration/acceptance.md` | 提供 BullMQ/Redis submit、worker、status、retry、health 基础 |
| `agent-and-automation-contracts` | 2026-06-08 | PASS | `specs/agent-and-automation-contracts/acceptance.md` | 提供 `/api/v1` automation auth、scope、idempotency 和 OpenAPI 契约 |
| `hermes-weekly-intelligence` | 2026-06-08 | PASS | `specs/hermes-weekly-intelligence/acceptance.md` | 提供 Hermes preview artifact 和 human apply 边界 |
| `karakeep-resync-redis-state` | 2026-06-22 | PASS | `specs/karakeep-resync-redis-state/acceptance.md` | Karakeep resync 已进入 automation job 体系；下一推荐 `weekly-publish-worker` |
| `weekly-publish-worker` | 2026-06-22 | PASS | `specs/weekly-publish-worker/acceptance.md` | 周刊 Quail publish 已进入 queued worker/retry/status 体系；下一推荐 `weekly-suggest-apply-worker` |
| `weekly-production-readiness` | 2026-07-06 | PASS | `specs/weekly-production-readiness/acceptance.md` | 本周 issue 92 已通过 NAS job、Quail 和 Astro public site 端到端上线；下一推荐 `weekly-suggest-apply-worker` |
| `weekly-suggest-apply-worker` | 2026-07-07 | PASS | `specs/weekly-suggest-apply-worker/acceptance.md` | 周刊 suggest/apply 已进入 queued worker；Hermes/WeCom 运营入口已通过 NAS smoke；下一推荐 `hermes-runtime-integration` |
| `hermes-runtime-integration` | 2026-07-07 | PASS | `specs/hermes-runtime-integration/acceptance.md` | NAS Hermes one-shot runtime 已可生成/登记 preview artifact 并发 WeCom；下一推荐 `frontend-db-deploy-automation` |

---

## Next Recommendation

完成 `hermes-runtime-integration` 后，推荐进入 `frontend-db-deploy-automation`。理由是 public weekly 前端已经从数据库构建内容，但 DB-only publish 后仍缺自动 rebuild/deploy；这比任务中心更直接影响“本周开始正常投入使用”。

完成前端自动部署后，再做 `task-center-v1`。如果需要更长期的偏好记忆或语义召回，再启动 `hermes-memory-read-model`，但不要让 PG/pgvector 成为 Admin MySQL 的第二事实源。

---

## Deferred Features

- `legacy-image-field-drop`: 与自动化执行控制无直接依赖，需先确认 Astro 和历史脚本读取点清零。
- `meili-tuning-and-circuit-breaker`: 可并入 `automation-runtime-hardening` 或单独做，但不阻塞 worker 化。
- `prisma-7-seed-config`: 维护项，适合与 runtime hardening 一起处理。
- `github-actions-runtime-upgrade`: 维护项，适合与 runtime hardening 一起处理。
- `content-fetch-quality-governance`: `inbox-scoring-robustness` 已完成主要闭环；若出现新的抓取失败证据，再单独开 feature。
