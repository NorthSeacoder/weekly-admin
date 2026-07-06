# Context Manifest: Weekly Production Readiness

**Workspace**: `weekly-production-readiness`
**Created**: 2026-07-06
**Status**: closed / PASS

---

## Implement Context

| File / Source | Reason | Phase | Required |
|---|---|---|---|
| `specs/weekly-production-readiness/spec.md` | 定义本周生产 readiness 的范围、P1 场景和明确排除项。 | implement | yes |
| `specs/weekly-production-readiness/plan.md` | 记录当前周优先、n8n/crontab fallback、静态前端重建等 ADR。 | implement | yes |
| `specs/weekly-production-readiness/tasks.md` | 规定任务顺序、关键路径和每个任务的验证方式。 | implement | yes |
| `specs/weekly-automation-runtime-roadmap/roadmap.md` | 本 feature 归属于现有自动化 runtime roadmap，需要保持 current/next 一致。 | implement | yes |
| `docs/nas-deployment.md` | NAS worker、Redis、Quail publish 和部署检查的既有运维说明。 | implement | yes |
| `/Users/yqg/personal/weekly/weekly` | weekly Astro 前端项目，负责公开站、RSS 和 search JSON。 | implement | yes |

---

## Check Context

| File / Source | Reason | Phase | Required |
|---|---|---|---|
| `specs/weekly-production-readiness/spec.md` | 验证每个 FR/US 是否有 evidence。 | verify | yes |
| `specs/weekly-production-readiness/plan.md` | 检查实现是否遵守 ADR 和 out-of-scope。 | verify | yes |
| `specs/weekly-production-readiness/tasks.md` | 检查任务是否全部完成且没有跳过关键路径。 | verify | yes |
| `specs/weekly-production-readiness/verify-evidence.md` | 保存 fresh runtime evidence。 | verify | yes |
| `specs/weekly-automation-runtime-roadmap/roadmap.md` | closeout 时更新 current/next recommendation。 | verify | yes |

---

## Research Context

| File / Source | Reason | Phase | Verified |
|---|---|---|---|
| NAS Docker state via `ssh nas docker ps` | 证明 worker/Redis/MySQL/n8n/Karakeep/Hermes/Umami 已部署并可复用。 | implement / verify | yes |
| GitHub Actions run `28794884748` | 证明 admin commit `95811f8` 已 build/deploy 成功。 | verify | yes |
| Public `https://weekly.mengpeng.tech/rss.xml` and `/search.json` headers | 证明当前公开站静态产物仍停留在旧时间，需要前端 rebuild。 | plan / verify | yes |

---

## Rules

- 不输出或提交任何 token、DB URL、Quail key、AI key。
- Quail `deliver=true` 不在本 feature 自动执行。
- 若 frontend deploy 无法自动完成，必须记录 blocker 和可执行 fallback，而不能假装完成。
