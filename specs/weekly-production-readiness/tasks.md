# Tasks: Weekly Production Readiness

**Workspace**: `weekly-production-readiness` | **Date**: 2026-07-06  
**Input**: `specs/weekly-production-readiness/spec.md` + `plan.md`  
**Prerequisites**: spec.md, plan.md

---

## Phase 1: SDD Workspace And Roadmap Alignment

**目标**: 把真实目标从已完成的 `weekly-publish-worker` 切换到生产 readiness feature。

- [x] T001 [SDD] 更新 `.active` 和 roadmap current
  - scope: `specs/.active`, `specs/weekly-automation-runtime-roadmap/roadmap.md`
  - slice: SDD continuation 能恢复到本 feature
  - blocked_by: none
  - maps_to: FR-008
  - verify: `.active` 为 `weekly-production-readiness`，roadmap Current Feature 一致

- [x] T002 [SDD] 建立 context manifest
  - scope: `context-manifest.md`
  - slice: implement/verify 有明确高信号上下文
  - blocked_by: none
  - maps_to: NFR-001
  - verify: manifest Required 本地文件存在且每条有 Reason

## Phase 2: Admin/NAS Runtime Baseline

**目标**: 后台和 NAS worker 处于可部署、可运行、可观测状态。

- [x] T003 [US2] 修复并验证 worker health 状态
  - scope: `docker/docker-compose.nas.yml`, NAS `/vol1/1000/Docker/weekly-admin/docker-compose.yml`
  - slice: worker 不再因 Web healthcheck 被标 unhealthy
  - blocked_by: none
  - maps_to: US2 / FR-004
  - verify: `docker inspect weekly-admin-worker` 显示 running + health none，日志显示 Worker started

- [x] T004 [US2] 验证 Admin 代码和部署
  - scope: Admin repo, GitHub Actions, NAS containers
  - slice: 最新 commit 构建部署到 NAS
  - blocked_by: T003
  - maps_to: FR-003 / FR-004 / NFR-001
  - verify: focused tests、type-check、lint、build、Actions deploy success、NAS app healthy/degraded 原因可解释

- [x] T005 [US2] 验证 automation token scopes
  - scope: production automation_tokens / env / route auth
  - slice: `sync:run`, `score:run`, `content:resync`, `weekly:publish`, `weekly:read`, `weekly:suggest` scope 足够
  - blocked_by: T004
  - maps_to: FR-003 / NFR-002
  - verify: sanitized scope 查询或 test request，不输出 token 明文

## Phase 3: Current Week Issue And Content

**目标**: 创建当前周 issue，并保证有可发布内容。

- [x] T006 [US1] 创建或确认 2026-07-06 所在周 issue
  - scope: production DB, `src/lib/services/weekly-automation.ts`
  - slice: 当前周 draft issue 存在；期号连续，允许跨周覆盖断档
  - blocked_by: T004
  - maps_to: FR-001
  - verify: SQL 查询显示 start/end 覆盖 2026-07-06，且 start 接上上一期 end 后一天

- [x] T007 [US1] 运行 sync/score 或确认候选池
  - scope: `/api/v1/jobs/sync`, `/api/v1/jobs/score`, `automation_runs`, `inbox_items`, `contents`
  - slice: 候选内容足以生成本周 issue
  - blocked_by: T005
  - maps_to: FR-002 / FR-003
  - verify: job terminal status + candidate count

- [x] T008 [US1] 应用建议或人工 fallback 关联内容
  - scope: weekly workbench apply/manual SQL/API
  - slice: 当前周 issue 有内容，统计字段一致
  - blocked_by: T006, T007
  - maps_to: FR-002
  - verify: `weekly_content_items` count > 0，issue totals 非零或有解释

## Phase 4: Publish And Scheduling

**目标**: Quail dry-run publish 可跑，后续每周有固定调度。

- [x] T009 [US2] Quail dry-run publish
  - scope: `/api/v1/weekly/publish`, worker handler, Quail fields
  - slice: `deliver=false` 入队、执行、写回，不群发邮件
  - blocked_by: T008
  - maps_to: FR-006 / NFR-001
  - verify: automation run succeeded，`quail_post_id/quail_published_at` 写回

- [x] T010 [US2] 配置 n8n 或 crontab 调度
  - scope: NAS n8n 或 `/vol1/1000/Docker/weekly-admin/scripts`, crontab
  - slice: sync/score 定时可重复触发
  - blocked_by: T005
  - maps_to: FR-005
  - verify: 调度配置存在，手动触发一次返回 queued/terminal status

## Phase 5: Weekly Frontend Production Deploy

**目标**: 公开站消费最新 published issue。

- [x] T011 [US3] 梳理 weekly 前端稳定部署路径
  - scope: `/Users/yqg/personal/weekly/weekly`, GitHub Actions/NAS/OpenResty path
  - slice: 明确 build/deploy 命令，不混入依赖升级支线
  - blocked_by: T008
  - maps_to: FR-007 / NFR-004
  - verify: deployment path documented in runbook

- [x] T012 [US3] 发布当前周 issue 并重建前端
  - scope: production DB status, weekly Astro build/deploy
  - slice: public `/weekly`, `/rss.xml`, `/search.json` 包含最新 issue
  - blocked_by: T009, T011
  - maps_to: FR-007
  - verify: `pnpm build` success + public smoke

## Phase 6: Evidence, Runbook, Closeout

**目标**: 证明端到端完成，并留下可复用运行手册。

- [x] T013 [Docs] 写运行手册
  - scope: `docs/runbooks/weekly-production.md`
  - slice: 每周 cadence、手动 fallback、Quail 发信确认、前端部署、故障排查
  - blocked_by: T010, T012
  - maps_to: FR-008
  - verify: runbook 覆盖所有 P1 操作

- [x] T014 [Verify] 写 fresh verification evidence
  - scope: `specs/weekly-production-readiness/verify-evidence.md`
  - slice: 完整证据链，不用记忆或意图替代
  - blocked_by: T003-T013
  - maps_to: all
  - verify: evidence 包含 commands、runtime 状态、DB、public smoke、known residual risk

- [x] T015 [Closeout] 写 acceptance 并更新 roadmap
  - scope: `acceptance.md`, roadmap
  - slice: feature PASS 后推荐下一 feature
  - blocked_by: T014
  - maps_to: closeout
  - verify: acceptance Overall PASS，roadmap current/next 更新

---

## 依赖与顺序

- 关键路径：T001 -> T003/T004 -> T005 -> T006/T007/T008 -> T009 -> T011/T012 -> T013/T014/T015。
- T010 可在 T005 后并行推进，但必须在 closeout 前完成。
- 历史 backfill、Hermes runtime、任务中心不在当前关键路径。

---

## 覆盖检查

| 场景 / 需求 | 对应任务 |
|---|---|
| US1 当前周 issue 和内容 | T006, T007, T008 |
| US2 NAS 自动化可靠 | T003, T004, T005, T009, T010 |
| US3 公开站同步 | T011, T012 |
| Runbook / handoff | T013 |
| Fresh evidence / closeout | T014, T015 |

| 架构决策 / 质量属性 | 对应任务 | 验证任务 |
|---|---|---|
| ADR-001 当前周优先 | T006-T008 | T014 |
| ADR-002 n8n/crontab | T010 | T014 |
| ADR-003 静态前端重建 | T011-T012 | T014 |
| 可观测性 | T004, T009, T010 | T014 |

---

## Stage Readiness

- 当前阶段：`closeout`
- 结论：P1 生产 readiness 已完成；后续进入 `weekly-suggest-apply-worker` / runtime hardening。
