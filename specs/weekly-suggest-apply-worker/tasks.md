# Tasks: Weekly Suggest Apply Worker

**Workspace**: `weekly-suggest-apply-worker`
**Date**: 2026-07-07

- [x] T001 Make `weekly.suggest` and `weekly.apply` submittable jobs.
- [x] T002 Queue `/api/v1/weekly/suggestions` while preserving route-side Hermes artifact secret/schema validation.
- [x] T003 Queue `/api/v1/weekly/suggestions/{id}/apply`.
- [x] T004 Add worker handlers for Admin suggestion generation, Hermes artifact registration, and suggestion apply.
- [x] T005 Add `/api/v1/weekly/current` for Hermes current issue discovery.
- [x] T006 Add Hermes/WeCom host helper script.
- [x] T007 Update OpenAPI and runbook/docs.
- [x] T008 Run focused tests, type-check, lint and build.
- [ ] T009 Run NAS smoke after deploy.
- [ ] T010 Closeout acceptance and roadmap.
