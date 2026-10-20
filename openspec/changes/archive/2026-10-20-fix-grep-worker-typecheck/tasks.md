# Tasks

## 1. Confirm the Worker API and fix the handler

- [x] 1.1 (TV3 / core tools) Inspect the installed Bun Worker declarations/runtime and the available `.opencode_reference` worker examples; record the compatible event API and confirm the handler remains isolated from pathological regex execution.
- [x] 1.2 (TV3 / core tools) Update `runGrepWorker` to use the supported typed worker events, settle only once across message/error/exit/abort/timeout, and preserve timer/listener cleanup and worker termination; verify with focused grep handler tests.

## 2. Verify behavior and workspace

- [x] 2.1 (TV3 / core tools) Add or adjust focused tests for successful result, worker error or unexpected exit, timeout, caller abort, and cleanup; run the focused grep test file and `bun run --cwd packages/core test`.
- [x] 2.2 (TV3 / core tools) Run `bun turbo typecheck` and confirm all workspace packages complete with zero type errors; investigate any additional failures rather than masking them with `any` or type-check suppression.
