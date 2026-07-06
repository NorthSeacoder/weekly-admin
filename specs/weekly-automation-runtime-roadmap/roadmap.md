# Roadmap: Weekly Automation Runtime

**Umbrella**: `weekly-automation-runtime-roadmap`  
**Created**: 2026-06-22  
**Status**: active  
**Current Feature**: none  
**Next Recommended Feature**: `weekly-suggest-apply-worker`

---

## Summary

本 roadmap 将 `admin-modernization-roadmap` closeout 后剩余的自动化执行能力按可交付 feature 重新组织。优先级采用用户确认的“周刊自动化优先”：先把现有 Karakeep 重跑和周刊发布/建议/应用等长任务纳入 Redis/worker/status 体系，再补完整任务中心、Hermes 外部 runtime 和安全清债。

当前 `karakeep-resync-redis-state` 与 `weekly-publish-worker` 已完成。下一步推荐进入 `weekly-suggest-apply-worker`，继续把周刊 suggest/apply 的长任务或副作用路径纳入 worker/status 体系。

---

## Current State

| Field | Value |
|---|---|
| Current feature | none |
| specs/.active expected | `weekly-publish-worker` until next feature is opened |
| Current stage | `closeout` |
| Next stage | `specify` for `weekly-suggest-apply-worker` |
| Current objective | `weekly-publish-worker` PASS，等待用户确认进入下一 feature |

---

## Feature Roadmap

| Feature | Goal | Status | Depends On | Start Condition | Recommended Stage | Notes |
|---|---|---|---|---|---|---|
| `karakeep-resync-redis-state` | 将 `/api/content/[id]/karakeep-resync` 的进程内 `Map` 状态迁到 Redis/worker/status，支持重启恢复和可观测失败 | done | `redis-job-orchestration` | 现有 sync/score Redis worker 已 PASS，Karakeep resync 仍为进程内状态 | closeout | 已 PASS；不迁移 weekly publish |
| `weekly-publish-worker` | 将周刊 Quail publish 从同步 automation route 迁入 queued worker，保留 idempotency 和 external side-effect evidence | done | `karakeep-resync-redis-state`, `agent-and-automation-contracts`, `redis-job-orchestration` | Karakeep slice closeout 后；现有 publish route contract 稳定 | closeout | 已 PASS；publish route 现在返回 queued job，由 worker 执行 Quail 发布 |
| `weekly-suggest-apply-worker` | 将 weekly suggest/apply 的耗时或副作用路径纳入 worker/status；人工确认仍是写回边界 | backlog | `weekly-publish-worker`, `hermes-weekly-intelligence` | publish worker 验证通过；明确 suggest/apply 哪些步骤需要异步化 | specify | 不改变 Hermes preview-only 和 human apply 边界 |
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

---

## Next Recommendation

完成 `weekly-publish-worker` 后，推荐进入 `weekly-suggest-apply-worker` 的 `specify` 阶段。理由是 publish 已经覆盖外部副作用 worker 化，下一瓶颈是周刊建议/应用流程的耗时步骤、preview evidence、人工确认边界和 status 统一。

若 suggest/apply 评估发现 apply 必须保持同步，应至少将 generate/register preview 的长任务纳入 worker，并保留 human apply 写回边界。

---

## Deferred Features

- `legacy-image-field-drop`: 与自动化执行控制无直接依赖，需先确认 Astro 和历史脚本读取点清零。
- `meili-tuning-and-circuit-breaker`: 可并入 `automation-runtime-hardening` 或单独做，但不阻塞 worker 化。
- `prisma-7-seed-config`: 维护项，适合与 runtime hardening 一起处理。
- `github-actions-runtime-upgrade`: 维护项，适合与 runtime hardening 一起处理。
- `content-fetch-quality-governance`: `inbox-scoring-robustness` 已完成主要闭环；若出现新的抓取失败证据，再单独开 feature。
