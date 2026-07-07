# Feature Specification: Frontend DB Deploy Automation

**Workspace**: `frontend-db-deploy-automation`
**Created**: 2026-07-07
**Status**: Verify Pending
**Input**: public weekly 前端已从数据库构建内容，但 Admin DB-only publish 后仍缺自动 rebuild/deploy；前端样式由另一个 agent 处理，本 feature 不改 Astro 样式组件。

---

## Scope

本 feature 补齐 Admin/NAS 到 public weekly 前端的构建触发链路。前端内容事实源仍是 MySQL；触发层通过 GitHub Actions `workflow_dispatch` 让 `NorthSeacoder/weekly` 重新 `astro build` 并部署到现有服务器。

## Requirements

- **FR-001**: 前端 workflow 必须支持 `workflow_dispatch`，远程触发时强制 build/deploy。
- **FR-002**: 前端 workflow 的普通 push 不应在无内容构建产物时继续 deploy。
- **FR-003**: Admin repo 必须提供 NAS 可执行触发脚本，通过 GitHub REST API dispatch 前端 workflow。
- **FR-004**: 触发脚本必须读取 `WEEKLY_FRONTEND_GITHUB_TOKEN` 或 `GITHUB_TOKEN`，且不打印 token。
- **FR-005**: 触发脚本必须支持 `dry-run`，用于验证配置和输出将要触发的 repo/workflow/ref/reason。
- **FR-006**: 触发脚本必须能在 dispatch 后查询最新 workflow run，便于运维确认。
- **FR-007**: 本 feature 不修改前端样式组件、页面布局或 Astro 内容渲染逻辑。

## Out of Scope

- 不接管另一个 agent 正在进行的 `weekly-frontend-revamp` 样式优化。
- 不改变前端 `WeeklyService` 的数据库读取逻辑。
- 不自动 apply/publish 周刊内容；这里只负责构建部署触发。

## Stage Readiness

- 当前阶段：`verify`
- 下一阶段：配置 `WEEKLY_FRONTEND_GITHUB_TOKEN` 后运行 dispatch smoke。
