# Task 6 continuation report — real local API/worker graph

## Outcome

The local `cli:serve` path now composes a real authenticated Judge API and polling worker over PostgreSQL and immutable disk snapshots. This is not an adjudication-capable or release-ready service: BCE is incomplete, so output is `UNVERIFIED`; PoC policy denies all and the Docker sandbox remains disabled.

## Production composition

- `PostgresRunStore` provides admission, outbox, state, events and cancellation; startup checks a live SQL query before listen.
- A fixed snapshot resolver loads only the admitted opaque snapshot ID from the canonical `HARNESS_SNAPSHOT_DIR` root using `SnapshotManager` manifests and `DiskSourceSnapshot` integrity checks. It performs no arbitrary path resolution from API input.
- The worker uses `SnapshotIngestion`, `ToolRegistry`, `ProductionContextEngine`, `RegexSecurityFilter`, `PostgresCancellation`, production clock/random/sleep and ID sources, plus `RealModelGateway` created for actual executions only.
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

- Live HTTP→Postgres→worker integration remains unverified in this environment. Add/execute the guarded live database test before calling it operationally verified.
- Provider connectivity is deferred until first real run; runs can fail with normalized provider errors if key/endpoint/model are invalid.
- BCE and PoC safety gates remain unchanged. No `PASS`, `FAIL`, or PoC runtime execution is authorized or claimed.

## Fix round 1 — provider boundary, provenance, filter, shutdown

- Provider routing now supports OpenAI directly and OpenRouter only with an explicit provider-specific OpenAI-compatible base URL; `anthropic` and `google` fail closed. The configured API key is never passed to the SDK's default OpenAI endpoint for OpenRouter. URL credentials are rejected.
- Moved the established secret patterns into the canonical production `ProductionSecurityFilter` under `@harness/core`; test `RegexSecurityFilter` delegates to it. Production no longer imports the testing namespace.
- Added optional, schema-validated `runtime` metadata to immutable run-config snapshots: provider/model, credential-free URL, timeout, pricing, profile/ingestion versions, sandbox mode, model bounds, Solidity compiler version, and pinned Foundry image. API keys are not represented. Runtime settings flow through `JudgeRunConfig` into the runner's `run.started` snapshot digest.
- Added polling lifecycle with a 5-second shutdown bound. The listener stops promptly; on timeout the store stays open until active `runOnce` settles, leaving the claim lease recoverable rather than closing the DB under in-flight writes.
- Regression coverage: provider routing/default-endpoint guard; runtime config change and secret omission; production filter redaction; active-work shutdown defers cleanup; runtime snapshot digest changes.
- Verification: `bun turbo typecheck` passed; `bun turbo test` passed (880 tests, 0 failures); `git diff --check` passed. No provider, PostgreSQL, Docker or Keychain integration was run.
