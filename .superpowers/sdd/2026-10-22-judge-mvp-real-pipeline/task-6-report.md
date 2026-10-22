# Task 6 report — production local composition gate

## Outcome: PARTIAL / RELEASE BLOCKED

No production composition was delivered. The proposed `startProductionJudgeServer` wrapper and its exports/tests were removed after review found its readiness callbacks and runtime factory caller-controlled: a caller could supply no-op checks and arbitrary adapters, while the wrapper checked a config value it discarded. That API could not prove actual adapter identity or effective runtime configuration and provided false assurance. `startJudgeServer` remains unchanged; the README explicitly records production composition as BLOCKED.

Task 5 has no approved production sanitizer/sandbox or image, and Task 3 reports its BCE as incomplete; no production verdict capability is claimed. Do not treat caller-provided readiness callbacks as evidence of production dependencies.

No Docker command, image pull, container, model endpoint or PostgreSQL was used. This task did not create a CLI executable or assert live dependency readiness.

## Verification

- Review disposition: addressed by deleting the unsafe wrapper/export/tests; the existing `startJudgeServer` API was not changed.
- `bun run --cwd packages/server typecheck` — passed.
- `bun test packages/server/test` — **32 pass, 0 fail**.

## Resume implementation — safe local readiness endpoint

- Added `bun run cli:serve` using a real Bun listener, loopback-only binding, required explicit CLI runtime config, snapshot-root directory check, pinned Foundry image digest inspection, real Postgres `select 1`, and existing macOS Keychain credential provider before listen. The listener has authenticated health only; all other paths return 503. No test/scripted infrastructure is composed.
- Health reports API compatibility and the limited capabilities `poc-execution-disabled` and `bce-incomplete`; it explicitly says Judge execution is unavailable. PoC remains literal false and is not configurable by API/env/args. The model key is validated for presence but no model request is made; provider connectivity is not claimed.
- Judge release remains **BLOCKED**, accurately: Task 3 BCE remains incomplete, Task 5 sanitizer is deny-only, and Docker Desktop/macOS isolation is unvalidated. The listener does not pretend to offer a functional Judge pipeline.
- Added a regression asserting production config rejects `enablePocExecution: true` and defaults to false.
- Verification: focused test 2 pass; server tests 56 pass; CLI tests 53 pass (test runner printed its existing cancellation notice); `bun turbo typecheck` 6/6; `git diff --check` passed. No external provider, DB, Docker command, or Keychain was exercised here.
- Remaining limitations: no integration test can establish readiness without approved live local dependencies; startup's non-network provider validation is only presence/config validation. Existing `startJudgeServer` and callback API remain untouched.
