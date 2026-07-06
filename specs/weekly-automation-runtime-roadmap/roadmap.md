# Roadmap: Weekly Automation Runtime

**Umbrella**: `weekly-automation-runtime-roadmap`
**Created**: 2026-06-22
**Status**: active
**Current Feature**: `weekly-suggest-apply-worker` (verify)
**Next Recommended Feature**: `hermes-runtime-integration`

---

## Summary

本 roadmap 将 `admin-modernization-roadmap` closeout 后剩余的自动化执行能力按可交付 feature 重新组织。优先级采用用户确认的“周刊自动化优先”：先把现有 Karakeep 重跑和周刊发布/建议/应用等长任务纳入 Redis/worker/status 体系，再补完整任务中心、Hermes 外部 runtime 和安全清债。

当前 `karakeep-resync-redis-state`、`weekly-publish-worker` 与 `weekly-production-readiness` 已完成。2026-07-07 已开始实现 `weekly-suggest-apply-worker`：suggest/apply 进入 Redis worker，Hermes 可通过 Admin API 发现当前 issue，NAS 可通过 Hermes/WeCom helper 发运营摘要。

---

## Current State

| Field | Value |
|---|---|
| Current feature | `weekly-suggest-apply-worker` |
| specs/.active expected | `weekly-suggest-apply-worker` |
| Current stage | `verify` |
| Next stage | `closeout` after tests/deploy smoke |
| Current objective | 将周刊建议/应用和 Hermes/企微运营入口接入 worker/status 体系 |

---

## Feature Roadmap

| Feature | Goal | Status | Depends On | Start Condition | Recommended Stage | Notes |
|---|---|---|---|---|---|---|
| `karakeep-resync-redis-state` | 将 `/api/content/[id]/karakeep-resync` 的进程内 `Map` 状态迁到 Redis/worker/status，支持重启恢复和可观测失败 | done | `redis-job-orchestration` | 现有 sync/score Redis worker 已 PASS，Karakeep resync 仍为进程内状态 | closeout | 已 PASS；不迁移 weekly publish |
| `weekly-publish-worker` | 将周刊 Quail publish 从同步 automation route 迁入 queued worker，保留 idempotency 和 external side-effect evidence | done | `karakeep-resync-redis-state`, `agent-and-automation-contracts`, `redis-job-orchestration` | Karakeep slice closeout 后；现有 publish route contract 稳定 | closeout | 已 PASS；publish route 现在返回 queued job，由 worker 执行 Quail 发布 |
| `weekly-production-readiness` | 收口当前周 issue、NAS sync/score/publish 调度、Quail dry-run、weekly Astro 前端 rebuild/deploy 和运行手册 | done | `weekly-publish-worker` | 用户要求本周开始正常投入使用，并可利用 NAS 现有服务 | closeout | 已 PASS；历史 backfill、Hermes runtime 和任务中心后置 |
| `weekly-suggest-apply-worker` | 将 weekly suggest/apply 的耗时或副作用路径纳入 worker/status；人工确认仍是写回边界 | in-progress | `weekly-publish-worker`, `hermes-weekly-intelligence` | publish worker 验证通过；明确 suggest/apply 哪些步骤需要异步化 | verify | 已补 current issue discovery 和 Hermes/WeCom ops helper；待完整验证/部署 |
| `task-center-v1` | 在已有 dashboard/workbench summary 之上建立统一任务中心页面或视图 | backlog | `weekly-publish-worker`, `weekly-suggest-apply-worker` | 至少 3 类 workflow 已进入 Redis/status，任务中心有足够真实数据 | specify | 先有能力再做完整 UI，避免空壳任务中心 |
| `hermes-runtime-integration` | 将外部 Hermes skill/runtime、NAS deployment、hermes-db/PG migrations 接入 Admin preview contract | backlog | `weekly-suggest-apply-worker` | Admin-side preview/apply/status 已稳定，外部 Hermes runtime 归属明确 | specify | 可能跨仓，不应只在 Admin repo 内完成 |
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

---

## Next Recommendation

完成 `weekly-suggest-apply-worker` 后，推荐进入 `hermes-runtime-integration`。理由是 Admin-side contract、worker/status 和 WeCom helper 已具备，下一步才是外部 Hermes skill runtime、NAS 调度和 hermes-db/PG read model 的跨仓交付。

若 suggest/apply 评估发现 apply 必须保持同步，应至少将 generate/register preview 的长任务纳入 worker，并保留 human apply 写回边界。

---

## Deferred Features

- `legacy-image-field-drop`: 与自动化执行控制无直接依赖，需先确认 Astro 和历史脚本读取点清零。
- `meili-tuning-and-circuit-breaker`: 可并入 `automation-runtime-hardening` 或单独做，但不阻塞 worker 化。
- `prisma-7-seed-config`: 维护项，适合与 runtime hardening 一起处理。
- `github-actions-runtime-upgrade`: 维护项，适合与 runtime hardening 一起处理。
- `content-fetch-quality-governance`: `inbox-scoring-robustness` 已完成主要闭环；若出现新的抓取失败证据，再单独开 feature。
