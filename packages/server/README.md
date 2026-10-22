# `@harness/server`

The server package exposes the local Judge API handler and runtime composition primitives. It does not start a process at import time.

## Local security requirements

- Bind only to `127.0.0.1`, `::1` or `localhost` using `listenLocal` / `startJudgeServer`.
- On macOS, `startJudgeServer` gets the installation credential from the generic-password item in Keychain (`com.harness.local-api`, account `installation`). On first launch it creates a random 256-bit URL-safe secret. Rotation replaces the item; clients must reacquire it through the native credential boundary.
- The Swift helper requires Xcode Command Line Tools (`swift`) and the user Keychain to be available. Any Keychain/helper error fails startup. Unsupported OS does not fall back to `.env`, a plaintext file, anonymous access or process arguments.
- Pass the credential to the client as `Authorization: Bearer <credential>`. Never put it in a URL, trajectory, log or renderer storage.

## Composition

`createJudgeRuntime` is an injectable test/runtime composition seam: it accepts a `RunStorePort`, `SourceSnapshotPort`, frozen `JudgeRunConfig`, ID generator, and a factory for `JudgeRunnerDeps` (provider gateway, context engine, tools, security filter, sandbox, cancellation, clocks/random/sleep). It exposes:

- `api.fetch(request)` — authenticated submission, safe run projection, ordered event pages and cancellation.
- `worker.runOnce()` — claim and execute available outbox work by stable run ID.

`startJudgeServer` is an injectable composition seam. `bun run cli:serve` binds only loopback, checks explicit database/model config, the accessible immutable snapshot root, live PostgreSQL, and macOS Keychain, and composes the real Postgres store, disk snapshot resolver, `RealModelGateway`, production context engine, tools, snapshot ingestion, cancellation, and polling worker. There is no provider call at startup; execution uses the configured gateway. The API credential comes only from Keychain.

**Judge release remains BLOCKED; this is a real local submission/worker path, not an adjudication-capable service.** BCE remains explicitly incomplete, so all supported submissions must resolve UNVERIFIED; PoC policy denies all and execution is hardcoded false (no API/config switch). Docker remains disabled in composition and macOS isolation is unverified. Health reports `judgeExecution: unverified-only`, `enablePocExecution: false`, and `bce-incomplete`. Startup does not incur a provider request; provider connectivity is discovered on first actual run.

## API

The local API accepts `POST /v1/judge/runs` with `Idempotency-Key` and JSON:

```json
{
  "finding": { "findingId": "finding-123", "reportMarkdown": "..." },
  "snapshotId": "snapshot-opaque-id"
}
```

For narrative-only, `reportMarkdown` can contain the bounded labeled report, for example `Target: Vault.withdraw\nRoot cause: ...\nAttack scenario: ...\nImpact: ...\nState: ...`. PoC is rejected by the deny-only policy and never executed. Both are candidate user input; neither may include ground-truth, adjudication or scoring metadata.

The API returns `202` only after durable admission with `runId`, state `accepted`, and `statusUrl`. Then use `GET /v1/judge/runs/{runId}`, `GET /v1/judge/runs/{runId}/events` (finite cursor pages), and `POST /v1/judge/runs/{runId}/cancel`. With BCE incomplete, verdict capability remains `unverified/UNVERIFIED`; no `valid/PASS` or `invalid/FAIL` claim is made.

## Manual local smoke test (readiness/submission path only)

This smoke test confirms local Keychain/Postgres/API admission/worker persistence for a deliberately unsupported narrative. Its expected result is **UNVERIFIED**, not a vulnerability decision. It requires macOS, a dedicated local Postgres database already migrated for Harness, a valid model endpoint/key (the endpoint is contacted only if the run reaches a model call), and a source snapshot.

1. Create a snapshot from a small sanitized Solidity project using the existing snapshot command/API, and record its opaque snapshot ID. Do not include ground-truth/adjudication/scoring data.
2. Create/apply the schema against that dedicated database with `DATABASE_URL='<dedicated URL>' bun run db:migrate`. Then set `.env` runtime values: `DATABASE_URL`, `PROVIDER_NAME=openai` (or `openrouter` with an explicit HTTPS-compatible URL), `MODEL_NAME`, `MODEL_API_KEY`, `HARNESS_SNAPSHOT_DIR`, `HARNESS_HOST=127.0.0.1`, and a free `HARNESS_PORT` (default `4318`). For OpenRouter, set `MODEL_BASE_URL=https://openrouter.ai/api/v1`; URL credentials/query/fragment are rejected.
3. Start `bun run cli:serve`. Startup checks loopback configuration, snapshot directory, PostgreSQL, provider configuration and Keychain before listening. For this shell smoke test, retrieve the installation credential from Keychain into a shell variable via the native helper (the secret is not passed as a process argument or written to a file):

```sh
KEYCHAIN_HELPER="${TMPDIR:-/private/var/folders}/harness-keychain-credential"
swiftc packages/server/native/keychain-credential.swift -o "$KEYCHAIN_HELPER"
HARNESS_LOCAL_API_TOKEN="$("$KEYCHAIN_HELPER" get com.harness.local-api installation)"
```

Never enable shell tracing (`set -x`) while using this variable. 4. Send a narrative-only request (no PoC) with a unique idempotency key:

```sh
curl -sS -H "Authorization: Bearer $HARNESS_LOCAL_API_TOKEN" \
  -H 'Idempotency-Key: manual-judge-001' -H 'content-type: application/json' \
  -d '{"finding":{"findingId":"manual-001","reportMarkdown":"Target: Vault.withdraw\nRoot cause: candidate ordering issue\nAttack scenario: an untrusted caller invokes withdraw\nImpact: claimed balance change\nState: balances[caller]"},"snapshotId":"<OPAQUE_SNAPSHOT_ID>"}' \
  "http://127.0.0.1:${HARNESS_PORT:-4318}/v1/judge/runs"
```

5. Poll `GET /v1/judge/runs/{runId}` and `/events` using the returned ID and Keychain credential. The current bounded ingestion may return `UNVERIFIED/UNRESOLVED`; the service must not be interpreted as confirming or refuting the finding. PoC-bearing submissions are denied by policy, state probes are unavailable, and no automatic witness is generated.
6. Stop with Ctrl-C or SIGTERM. The worker stops polling and closes the listener/database pool after active work settles. Runs/events remain in the dedicated database; do not clear shared tables as cleanup.

Never use a production key/database for manual smoke tests. The live guarded listener integration is separate and requires `HARNESS_POSTGRES_E2E=1` plus `HARNESS_POSTGRES_E2E_DATABASE_URL`; it intentionally never falls back to `DATABASE_URL`. Run it only with a fresh disposable PostgreSQL container/database, for example:

```sh
HARNESS_POSTGRES_E2E=1 HARNESS_POSTGRES_E2E_DEDICATED=1 HARNESS_POSTGRES_E2E_DATABASE_URL='postgresql://judge_e2e:password@127.0.0.1:<PORT>/judge_e2e' \
  bun test packages/server/test/postgres-judge-runtime.test.ts
```

The opt-in requires `HARNESS_POSTGRES_E2E_DEDICATED=1`, refuses a matching normalized PostgreSQL host/port/database/user identity with `DATABASE_URL`, never falls back to `DATABASE_URL`, applies migrations, and retains uniquely identified test runs/events. The acknowledgement is the operator's responsibility: no software check can prove a database is disposable. Use only a disposable database. That automated test uses a fixed test-only credential operation through the internal startup seam so it never reads, creates, or changes a macOS Keychain item. It binds a real `Bun.serve` listener on an ephemeral loopback port and uses real PostgreSQL/snapshot/worker composition; it is not a substitute for the Keychain-backed manual workflow above.

## Bounds, coverage and recovery

- API JSON is capped at 256 KiB; report extraction defaults to 64,000 UTF-8 bytes. Snapshot ingestion examines at most 128 Solidity files, 120 lines per file and 512 KiB total source, and returns incomplete when limits/toolchain/import mapping prevent analysis. AST slices are retrieval context, not proof of a complete call/data-flow graph.
- The offline demo is scripted test material, not a supported Solidity coverage claim. It now records incomplete-BCE claims as UNVERIFIED, does not run PoCs by default, and emits no generated witness. PoC policy currently rejects every input.
- On interrupted local startup, stop with Ctrl-C; `cli:serve` stops polling, closes its listener and database pool. Docker is not invoked by this runtime. Do not run production/repository PoCs.
- Toolchain evidence recorded for BCE is `solc-js 0.8.30+commit.73712a01`; sandbox evidence is Foundry Forge 1.5.1 in the pinned ARM64 image, tested on Linux only. Docker Desktop/macOS behavior is unverified. The opt-in disposable-Postgres listener test covers HTTP→Postgres→worker→production-adapter using a test-only credential seam; its no-call assertion is not provider-routing coverage. Real Keychain interaction and provider routing against a controlled endpoint remain release gates.

The local `/v1/health` handshake is authenticated and reports the API version (no contract digest is advertised because there is no canonical versioned contract serialization to hash). Clients must fail closed on API-version mismatch; `assertApiCompatibility` implements that check. The handshake also reports deliberately limited runtime capabilities.

## Verification

From repository root:

```sh
bun run --cwd packages/server typecheck
bun run --cwd packages/server test
swiftc -typecheck packages/server/native/keychain-credential.swift
TASK5_DOCKER_INTEGRATION=1 TASK5_ARTIFACT_ROOT="$HOME/Library/Caches/harness-task5/artifacts" bun test packages/server/test/docker-foundry-sandbox.test.ts
```

The Docker command is explicitly opt-in and uses disposable benign/assertion fixtures only; it does not validate macOS isolation. The production composition uses PostgreSQL but a live HTTP→Postgres integration test remains unavailable in this environment.
