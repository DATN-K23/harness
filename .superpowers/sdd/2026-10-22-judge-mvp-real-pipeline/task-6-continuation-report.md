# Task 6 continuation report — real local API/worker graph

## Outcome

The local `cli:serve` path now composes a real authenticated Judge API and polling worker over PostgreSQL and immutable disk snapshots. This is not an adjudication-capable or release-ready service: BCE is incomplete, so output is `UNVERIFIED`; PoC policy denies all and the Docker sandbox remains disabled.

## Production composition

- `PostgresRunStore` provides admission, outbox, state, events and cancellation; startup checks a live SQL query before listen.
- A fixed snapshot resolver loads only the admitted opaque snapshot ID from the canonical `HARNESS_SNAPSHOT_DIR` root using `SnapshotManager` manifests and `DiskSourceSnapshot` integrity checks. It performs no arbitrary path resolution from API input.
- The worker uses `SnapshotIngestion`, `ToolRegistry`, `ProductionContextEngine`, `ProductionSecurityFilter`, `PostgresCancellation`, production clock/random/sleep and ID sources, plus `RealModelGateway` created for actual executions only.
- The effective run config is deeply frozen and PoC execution is hardcoded false. Sanitizer is deny-only and Docker sandbox is disabled. No test fixture or fake adapter enters the composition.
- Startup never calls a provider endpoint, avoiding surprise spend; configured provider/model credentials are used on an admitted execution. API credential remains Keychain-only.
- Docker/image prerequisite was removed: sandbox is disabled in this runtime and image presence would be unrelated to serving its safe capability.

## TDD and verification

- Added a snapshot resolver test first. It failed as expected because `resolveProductionSnapshot` did not exist. After implementation it passed checks for exact snapshot access, mismatched IDs, traversal, and missing IDs.
- `bun run --cwd packages/server typecheck` — passed.
- `bun run --cwd packages/server test` — 61 passed, 1 skipped.
- `bun run --cwd packages/cli typecheck` — passed.
- `bun run --cwd packages/cli test` — 54 passed (existing Ctrl+C cancellation notice printed).
- No live PostgreSQL, provider, Keychain or Docker integration was run.

## Limits / open risk

- The guarded API→Postgres→worker core-runtime graph is implemented but was not run here. It runs only with `HARNESS_POSTGRES_E2E=1` and an explicitly dedicated, reachable `HARNESS_POSTGRES_E2E_DATABASE_URL`; it never falls back to `DATABASE_URL` and fails loudly if enabled without that URL or with an unreachable database.
- Bun's production server listener and the macOS Keychain boundary are still not exercised end-to-end; only their injected readiness/preflight behavior is covered.
- Provider connectivity is deferred until first real run; runs can fail with normalized provider errors if key/endpoint/model are invalid.
- BCE and PoC safety gates remain unchanged. No `PASS`, `FAIL`, or PoC runtime execution is authorized or claimed.

## Fix round 1 — provider boundary, provenance, filter, shutdown

- Provider routing now supports OpenAI directly and OpenRouter only with an explicit provider-specific OpenAI-compatible base URL; `anthropic` and `google` fail closed. The configured API key is never passed to the SDK's default OpenAI endpoint for OpenRouter. URL credentials are rejected.
- Moved the established secret patterns into the canonical production `ProductionSecurityFilter` under `@harness/core`; test `RegexSecurityFilter` delegates to it. Production no longer imports the testing namespace.
- Added optional, schema-validated `runtime` metadata to immutable run-config snapshots: provider/model, credential-free URL, timeout, pricing, profile/ingestion versions, sandbox mode, model bounds, Solidity compiler version, and pinned Foundry image. API keys are not represented. Runtime settings flow through `JudgeRunConfig` into the runner's `run.started` snapshot digest.
- Added polling lifecycle with a 5-second shutdown bound. The listener stops promptly; on timeout the store stays open until active `runOnce` settles, leaving the claim lease recoverable rather than closing the DB under in-flight writes.
- Regression coverage: provider routing/default-endpoint guard; runtime config change and secret omission; production filter redaction; active-work shutdown defers cleanup; runtime snapshot digest changes.
- Verification: `bun turbo typecheck` passed; `bun turbo test` passed (880 tests, 0 failures); `git diff --check` passed. No provider, PostgreSQL, Docker or Keychain integration was run.

## Fix round 2 — endpoint and URL credential policy

- Native OpenAI configuration now permits only the default `api.openai.com` host. OpenRouter remains the sole explicit OpenAI-compatible router and may not target `api.openai.com`; no arbitrary OpenAI-key proxy endpoint is accepted.
- For both supported provider routes, base URLs reject username/password, URL fragments, and query keys matching key/api-key/token/secret/password/authorization/credential(s), case-insensitively. Thus URL query values cannot be persisted in runtime metadata.
- TDD: tests for OpenAI wrong-host and URL query/fragment secrets were added first and failed against the previous permissive routing. After the policy change, focused routing tests pass.
- Verification: focused server runtime tests pass; `bun turbo typecheck` passes all six packages; `bun turbo test` passes (880 tests, 0 failures); `git diff --check` passes. No live services were contacted.

## Fix round 3 — HTTPS-only provider endpoints

- Both explicit supported base URLs must use HTTPS. All query strings (including unknown `x`/`auth` parameters) and fragments are rejected, along with userinfo, before a gateway config can be returned or persisted.
- Regression coverage includes OpenAI HTTP, OpenRouter HTTP, `?x=secret`, and `?auth=...`; these are rejected by the same production provider resolver used to construct `RealModelGateway`.
- TDD red observed: focused runtime tests failed before the policy update.
- Verification: focused server runtime tests pass; `bun run --cwd packages/server typecheck` passes; `bun turbo typecheck` passes all six packages; `bun turbo test` passes (880 tests, 0 failures). `git diff --check` passes. No provider/Postgres/Docker/Keychain services used.

## Fix round 4 — validate endpoint before durable admission

- `startProductionLocalServer` now resolves provider configuration before constructing `PostgresRunStore`, checking snapshots, or listening. Invalid URLs therefore cannot reach submission admission or become run configuration snapshots.
- The single resolved provider config is reused for `RealModelGateway`; its normalized base URL is passed to `makeProductionJudgeConfig` and persisted. The OpenAI default URL is explicit. Config tests assert the runtime URL contains no query, fragment, or userinfo markers.
- TDD: startup regression with an invalid query URL and invalid DB/snapshot prerequisites failed before implementation; it now rejects on URL credentials before opening those dependencies.
- Verification: `bun test packages/server/test/production-runtime.test.ts` — 14 pass; `bun turbo typecheck` — all six packages pass. No live provider/Postgres/Docker/Keychain checks performed.

## Fix round 5 — observable provider preflight ordering

- The production startup keeps its public options fixed, while an internal-only operations seam now makes ordering observable in the focused test without caller-controlled readiness callbacks.
- TDD: the new malformed URL test initially failed because the internal preflight seam did not exist. It covers query (`?auth=`), plain HTTP, and credential-bearing URL forms. Each rejects with PostgreSQL construction, snapshot-root resolution, Keychain/startup orchestration, and listener counters still zero.
- Verification: `bun test packages/server/test/production-runtime.test.ts` — 15 pass; `bun run --cwd packages/server typecheck` — passed. No live services were contacted.

## Fresh tracking verification — 2026-10-22

- Task 6 lifecycle coverage is present for local binding/startup, worker polling and recovery/shutdown, and health compatibility. It does not start a live listener or exercise the macOS Keychain; those remain unverified end-to-end.
- The guarded PostgreSQL integration test exists at `packages/server/test/postgres-judge-runtime.test.ts` and covers API handler → Postgres → worker → real `JudgeRunner`. It was not run because `HARNESS_POSTGRES_E2E` was absent; with both opt-in variables unset, `env -u HARNESS_POSTGRES_E2E -u HARNESS_POSTGRES_E2E_DATABASE_URL bun test packages/server/test/postgres-judge-runtime.test.ts` reports 1 skipped. It must not be described as unavailable or unimplemented.
- Fresh verification: `bun turbo typecheck` — 6 packages successful; `bun turbo test` — 880 pass, 0 fail across 62 files; `swiftc -typecheck packages/server/native/keychain-credential.swift` — passed; `git diff --check` — passed. No live PostgreSQL, Docker, Keychain, or live-model integration was run.
- Release remains blocked: BCE is incomplete, PoC policy is deny-only, macOS sandbox is unvalidated, and production PostgreSQL/Keychain/live-model integrations have not run.
