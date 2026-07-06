# Feature Specification: Weekly Production Readiness

**Workspace**: `weekly-production-readiness`  
**Created**: 2026-07-06  
**Status**: Accepted / PASS  
**Input**: 用户要求“完成上述所有任务，保证周刊能够顺利跑起来，且能利用 NAS 上的相关能力；可使用 SDD，并整体梳理完整实现这些功能。”

---

## Feature Traits

| Trait | 是否命中 | 依据 |
|---|---|---|
| `multi-stage-workflow` | yes | 周刊生产包含采集、评分、候选、建议、人工应用、发布、前端重建和监控多个阶段。 |
| `external-side-effects` | yes | 涉及 Quail 发布、NAS crontab/n8n、GitHub Actions 部署、Redis worker、公开站发布。 |
| `artifact-handoff` | yes | Admin 数据库、automation_runs、Quail post id、Astro 静态产物、RSS/search JSON 都是跨系统交接产物。 |
| `user-visible-output` | yes | 公开周刊页、RSS、搜索索引和邮件订阅是最终用户可见输出。 |
| `prior-closure-failure` | yes | 生产站 search/RSS Last-Modified 停留在 2025-11；最新 production issue 只到 2026-03-28；worker 曾因 Web healthcheck 被误判 unhealthy。 |
| `bugfix-loop-breaker` | yes | 本 feature 是生产闭环修复，涉及多个已部分完成但未真正端到端跑通的路径。 |

**结论**: 本 feature 必须保留端到端 evidence、Root Cause / Regression Guard、运行手册和 NAS runtime 验证，不得只以单元测试通过作为完成条件。

---

## User Scenarios & Testing

### User Story 1 - 本周 issue 可生产 (Priority: P1)

作为周刊运营者，我希望后台存在当前周可编辑的 weekly issue，并能关联足够候选内容，以便从本周开始恢复正常排刊。

**Acceptance Scenarios**:

1. Given production 数据库最新 issue 只到 2026-03-28  
   When 执行当前周创建/补齐流程  
   Then 数据库存在覆盖 2026-07-06 所在周的 draft issue，issue_number 连续递增；如果上一期和当前周之间存在断档，本期允许跨周覆盖断档，标题和 slug 可被前端读取。

2. Given contents/inbox 已有候选内容  
   When 执行 sync/score/suggest/apply 或人工 fallback  
   Then 当前周 issue 至少有可发布内容，`weekly_content_items` 与统计字段一致。

**Edge Cases**:

- 如果本周内容不足，允许人工从近期 published contents 中补齐，但必须记录来源和原因。
- 如果历史日期缺口很多，本 feature 只要求当前期号连续且当前周可生产；允许本期跨周覆盖缺口，历史细分补齐进入后续治理，不阻塞本周启用。

### User Story 2 - NAS 自动化链路可靠 (Priority: P1)

作为维护者，我希望周刊后台的 Redis worker、自动化 token、定时 job、Quail publish 都在 NAS 上可靠运行，以便不用靠本地手工脚本维持生产。

**Acceptance Scenarios**:

1. Given `weekly-admin-worker` 运行在 NAS  
   When 检查容器状态和 worker 日志  
   Then worker 为 running，继承的 Web healthcheck 不再将其标记为 unhealthy，日志显示 worker started。

2. Given automation token 有正确 scope  
   When n8n 或 crontab 调用 `/api/v1/jobs/sync`、`/api/v1/jobs/score`、`/api/v1/weekly/publish`  
   Then request 返回 queued/succeeded，`automation_runs` 可追踪，失败可 retry。

**Edge Cases**:

- Redis 不可达时，核心 app 可 degraded 但不能伪装 job 成功。
- Quail publish 已发布但未 force 时必须返回可理解的 already-published failure。

### User Story 3 - 公开站同步最新周刊 (Priority: P1)

作为读者，我希望 `weekly.mengpeng.tech`、RSS 和搜索索引能看到最新发布周刊，以便周刊恢复对外可用。

**Acceptance Scenarios**:

1. Given 后台 issue 已发布  
   When Astro weekly 项目重新构建并部署  
   Then `/weekly`、对应 issue 页面、`/rss.xml`、`/search.json` 都包含最新 issue。

2. Given 前端读取 MySQL `weekly_issues.status='published'`  
   When 生产数据库有新发布 issue  
   Then 构建时不会继续输出 2025-11 的旧静态数据。

**Edge Cases**:

- 前端仍可保持静态部署，但必须有明确 rebuild 触发方式。
- 如果前端依赖升级分支未完成，不阻塞上线；本 feature 只要求当前生产构建可用。

---

## Requirements

### Functional Requirements

- **FR-001**: 系统必须创建或确认覆盖 2026-07-06 所在周的 production weekly issue，且期号连续；存在断档时允许该 issue 跨周。
- **FR-002**: 系统必须能把当前周候选内容关联到本周 issue，并保留人工 fallback 路径。
- **FR-003**: Admin `/api/v1/jobs/sync`、`/api/v1/jobs/score`、`/api/v1/weekly/publish` 必须通过 NAS Redis worker 跑通。
- **FR-004**: NAS 必须保留 `weekly-admin` Web 服务和 `weekly-admin-worker` worker 服务，worker 不应继承 Web-only healthcheck。
- **FR-005**: 必须配置一个可重复的自动化调度方案，优先复用 NAS n8n；若 n8n 不适合，使用 crontab + curl 脚本。
- **FR-006**: Quail dry-run publish 必须验证 `deliver=false` 下可入队、执行和写回，正式发信需要人工确认。
- **FR-007**: weekly Astro 前端必须完成一次生产 rebuild/deploy，并验证公开 URL、RSS、search JSON 包含最新 issue。
- **FR-008**: 必须沉淀一份运行手册，记录每周操作、自动化触发、失败排查和回滚。

### Non-Functional Requirements

- **NFR-001**: 所有外部副作用必须可审计，至少可通过 `automation_runs`、容器日志或 GitHub Actions run 追踪。
- **NFR-002**: 自动化 token 和 Quail/AI/DB secrets 不得写入仓库或日志。
- **NFR-003**: 当前周上线优先，历史 backfill 不得阻塞本周恢复。
- **NFR-004**: 前端生产构建应避免引入未完成依赖升级支线。

### Quality Attributes

| 属性 | 目标 | 为什么重要 | 验收 / 证据 | 是否阻塞 plan |
|---|---|---|---|---|
| 可用性 | 本周流程可重复执行 | 周刊要从本周恢复运营 | 当前周 issue + publish + front deploy evidence | 是 |
| 可观测性 | job/run/log 可追踪 | NAS 自动化失败要能定位 | automation_runs、worker logs、Actions run | 是 |
| 安全 | secret 不外泄 | 涉及 DB/Quail/automation token | sanitized 输出和文件审查 | 是 |
| 可演进性 | 后续接 n8n/Hermes/task-center | 已有 roadmap 需要继续推进 | roadmap 更新和任务拆分 | 否 |

### Key Entities

- **weekly_issues**: 周刊期次事实源，前端只读取 `status='published'`。
- **weekly_content_items**: issue 与内容的关联和排序。
- **automation_runs**: sync/score/publish/resync 的 durable run evidence。
- **BullMQ/Redis job**: NAS 上的异步执行控制层。
- **Astro static artifact**: 公开站、RSS、search JSON 的用户可见输出。

---

## Out of Scope

- 历史所有空周刊完整补齐。
- 前端依赖整体升级和设计大改。
- Hermes 外部 runtime 的完整接入。
- 任务中心 UI v1。
- Quail `deliver=true` 自动群发；正式发信必须单独人工确认。

---

## Stage Readiness

- 下一步建议：`plan`
- 阻塞项：无。当前需求足够清晰，进入方案设计和任务拆分。
