# Verify Evidence: Hermes Runtime Integration

**Workspace**: `hermes-runtime-integration`
**Date**: 2026-07-07

## Local Verification

- PASS: `bash -n scripts/weekly-hermes-runtime.sh`
- PASS: `git diff --check`

## NAS Smoke

- PASS: copied `scripts/weekly-hermes-runtime.sh` to `/vol1/1000/Docker/weekly-admin/scripts/weekly-hermes-runtime.sh` and set executable mode `750`.
- PASS: stub dry-run with `HERMES_ONESHOT_CMD=/tmp/weekly-hermes-stub.py` returned a valid `weekly-suggestion.v1` empty artifact for issue `92`.
- PASS: stub register returned queued run `auto_f09284a5-f8eb-48a1-8a1f-268a3932b336`; `/api/v1/jobs/{runId}` returned durable status `empty`.
- PASS: stub notify returned queued run `auto_7917bb03-e0c2-4db2-80fa-fdbdd815fe56`, durable status `empty`, and sent to `wecom:MengPeng`.
- PASS: real Hermes dry-run using NAS default Hermes runtime generated a valid preview artifact for issue `92` with content ids `1459`, `1568`, `1583`.
- PASS: real Hermes register using `krill/gpt-5.5` returned queued run `auto_08bdbf57-2fe6-44bb-8727-47ca9599b2c2`; worker returned durable status `succeeded` and preview items `1568`, `1583`, `1459`.
- PASS: real Hermes notify using `krill/gpt-5.5` returned queued run `auto_d9f720b7-3a1d-4faa-9c03-e382455e41fe`; worker returned durable status `succeeded` and sent to `wecom:MengPeng`.
- PASS: after setting the script default to `krill/gpt-5.5`, default `dry-run` generated a valid preview artifact for issue `92` with content ids `1441`, `1443`.

## Provider Note

- The global Hermes default `krill/deepseek-v4-flash:free` failed during register with `HTTP 500: Service is temporarily unavailable`.
- `wong/z-ai/glm-5.1` failed with `HTTP 503: No available channel`.
- Probe confirmed `krill/gpt-5.5`, `sensenova/deepseek-v4-flash`, and `deepseek/deepseek-v4-flash` can return JSON.
- Runtime default was set to the verified `krill/gpt-5.5` command, while keeping `HERMES_ONESHOT_CMD` override support.
