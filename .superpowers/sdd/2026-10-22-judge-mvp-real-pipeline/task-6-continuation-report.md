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
