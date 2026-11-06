# `@harness/server`

The server package exposes the local Judge API handler and runtime composition primitives. It does not start a process at import time.

## Shared local server

The CLI uses a single authenticated HTTP daemon at `http://127.0.0.1:4318`. The first real `judge`, `run`, `view`,
`repo add` or `snapshot list` invocation starts it if necessary. Later invocations reuse it, and closing a client
leaves the daemon running. Help and offline `--mock` commands can run without it. Relative source and finding
paths are interpreted from the client working directory.

```sh
bun run cli:judge -- --snapshot <id> --finding <path-to-finding.md>
bun run cli:serve -- status
bun run cli:serve -- stop
```

Running `bun run cli:serve` without arguments also starts or reuses the same daemon. Its process-scoped HTTP Basic
password is generated at startup. CLI clients discover it through `~/.harness-server/endpoint.json`, protected by
user-only permissions on POSIX and the user profile ACL on Windows. The descriptor can remain after shutdown
and its password is no longer accepted once that daemon stops. The daemon captures configuration from the first
invocation. Stop it and start a new command after changing database, provider or snapshot settings. Snapshot
commands can run before database and provider settings are available. Judge worker startup is deferred until needed.

For an operator-managed listener, set `HARNESS_SERVER_PASSWORD` and run `bun run cli:serve -- --foreground`.
This listener honors `HARNESS_HOST` and `HARNESS_PORT` and only binds to loopback. An existing shared daemon must
be stopped first if the port is already in use. Use HTTP Basic username `harness` and the configured password.
The Judge CLI can explicitly attach to that listener with `--server http://127.0.0.1:4318`.

## Composition

`createJudgeRuntime` is an injectable test/runtime composition seam: it accepts a `RunStorePort`, `SourceSnapshotPort`, frozen `JudgeRunConfig`, ID generator, and a factory for `JudgeRunnerDeps` (provider gateway, context engine, tools, security filter, verification, cancellation, clocks/random/sleep). It exposes:

- `api.fetch(request)` — authenticated submission, safe run projection, ordered event pages and cancellation.
- `worker.runOnce()` — claim and execute available outbox work by stable run ID.

`startJudgeServer` is an injectable composition seam. The foreground server and the shared daemon's lazy Judge startup check explicit database/model config, the accessible immutable snapshot root, live PostgreSQL, and the configured server password before composing the real Postgres store, disk snapshot resolver, `RealModelGateway`, production context engine, tools, snapshot ingestion, cancellation, and polling worker. There is no provider call at startup; execution uses the configured gateway.

**Judge release remains BLOCKED; this is a real local submission/worker path, not an adjudication-capable service.** BCE remains explicitly incomplete, so all supported submissions must resolve UNVERIFIED; PoC policy denies all and execution is hardcoded false (no API/config switch). Ordinary Judge uses unavailable verification. Health reports `judgeExecution: unverified-only`, `enablePocExecution: false`, and `bce-incomplete`. Startup does not incur a provider request; provider connectivity is discovered on first actual run.

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

## Manual provider-backed Judge test (disposable local environment)

This single-run test uses the actual production `Bun.serve` API, Postgres adapter, worker, snapshot ingestion, `RealModelGateway`, and HTTP Basic authentication. Use only a dedicated disposable local Postgres database and an expendable provider key. The checked-in `manual-judge-live-20261022` snapshot resolves `Vault.withdraw`; its labeled narrative contains no PoC. AST incompleteness causes model analysis, but the only allowed terminal verdict is **UNVERIFIED**. PoCs remain denied and verification unavailable. The test caps the run at two steps, 4096 total tokens, 512 output tokens per attempt, 20-second model timeout and a 60-second polling deadline. It prints terminal state/reason/category and provider-attempt count/types/categories before checking success; it never emits prompts, responses, headers or raw provider errors.

Start a disposable Postgres container on a unique local port/name. Set `.env` model configuration, `HARNESS_SNAPSHOT_DIR` pointing at `data/snapshots`, and `HARNESS_MANUAL_JUDGE_SNAPSHOT_ID=manual-judge-live-20261022`. Set the dedicated connection URL only in `HARNESS_MANUAL_JUDGE_DATABASE_URL` (it must differ from `DATABASE_URL`), apply migrations to that disposable DB, then run:

```sh
HARNESS_MANUAL_JUDGE_DEDICATED=1 bun packages/server/scripts/manual-provider-judge.ts
```

The script refuses non-loopback databases and database names not marked `manual`, `e2e`, `test`, or `disposable`; the operator must still ensure the target container/database is disposable and remove it afterward. The script uses the configured `HARNESS_SERVER_PASSWORD` for authenticated requests. Do not enable shell tracing or use a production database/key.

## Manual local smoke test (readiness/submission path only)

This is an operator-run local API/admission smoke test for local API authentication, Postgres and worker persistence, using a deliberately unsupported narrative. The expected verdict is **UNVERIFIED**, not a vulnerability decision; this case intentionally makes no provider call and does not contact the provider. For actual provider coverage, use the separate manual provider-backed test above.

1. Set `HARNESS_SNAPSHOT_DIR` to a local storage root and ingest a small sanitized Solidity project with `bun run cli:repo -- add <path-to-project> --snapshot-id manual-judge-snapshot`. The command prints a summary including the opaque snapshot ID; use that ID below. Do not include ground-truth/adjudication/scoring data.
2. Set the runtime values in `.env`: a dedicated local `DATABASE_URL`, `PROVIDER_NAME=openai` (or `openrouter` with an explicit HTTPS-compatible URL), `MODEL_NAME`, `MODEL_API_KEY`, `HARNESS_SNAPSHOT_DIR`, `HARNESS_HOST=127.0.0.1`, a strong `HARNESS_SERVER_PASSWORD`, and a free `HARNESS_PORT` (default `4318`). For OpenRouter, set `MODEL_BASE_URL=https://openrouter.ai/api/v1`; URL credentials/query/fragment are rejected. Apply schema using `bun run db:migrate` (the CLI resolves `.env` upward). Never print or paste the key into logs, commands, chat, or documentation.
3. In terminal A, start `bun run cli:serve -- --foreground`. In terminal B, run this from the repository root with the same password in the environment or the local `.env`:

```sh
HARNESS_AUTH="$(bun -e 'const password = Bun.env.HARNESS_SERVER_PASSWORD; if (!password) process.exit(1); process.stdout.write("Basic " + Buffer.from("harness:" + password).toString("base64"))')"
```

Never enable shell tracing (`set -x`) while using this variable. From terminal B, send a narrative-only request (no PoC) with a unique idempotency key. The `curl` output is the run response, not a secret; avoid verbose/debug flags:

```sh
curl -sS --config - <<CURL_CONFIG
header = "Authorization: $HARNESS_AUTH"
header = "Idempotency-Key: manual-judge-001"
header = "content-type: application/json"
data = "{\"finding\":{\"findingId\":\"manual-001\",\"reportMarkdown\":\"Target: Vault.withdraw\\nRoot cause: candidate ordering issue\\nAttack scenario: an untrusted caller invokes withdraw\\nImpact: claimed balance change\\nState: balances[caller]\"},\"snapshotId\":\"<OPAQUE_SNAPSHOT_ID>\"}"
url = "http://127.0.0.1:${HARNESS_PORT:-4318}/v1/judge/runs"
CURL_CONFIG
```

5. Poll `GET /v1/judge/runs/{runId}` and `/events` using the returned ID and the same Basic credentials. The expected verdict is `UNVERIFIED` (currently `UNRESOLVED`), because semantic BCE is incomplete; the service does not confirm or refute the finding. PoC-bearing submissions are denied by policy, state probes are unavailable, and no automatic witness is generated.
6. Stop with Ctrl-C or SIGTERM. The worker stops polling and closes the listener/database pool after active work settles. Runs/events remain in the dedicated database; do not clear shared tables as cleanup.

Never use a production key/database for manual smoke tests. The live guarded listener integration is separate and requires `HARNESS_POSTGRES_E2E=1` plus `HARNESS_POSTGRES_E2E_DATABASE_URL`; it intentionally never falls back to `DATABASE_URL`. Run it only with a fresh disposable PostgreSQL container/database, for example:

```sh
HARNESS_POSTGRES_E2E=1 HARNESS_POSTGRES_E2E_DEDICATED=1 HARNESS_POSTGRES_E2E_DATABASE_URL='postgresql://judge_e2e:password@127.0.0.1:<PORT>/judge_e2e' \
  bun test packages/server/test/postgres-judge-runtime.test.ts
```

The opt-in requires `HARNESS_POSTGRES_E2E_DEDICATED=1`, refuses a matching normalized PostgreSQL host/port/database identity with `DATABASE_URL` (ignoring role, query parameters, and options; `localhost`, `127.0.0.1`, and `::1` are treated as the same loopback host), never falls back to `DATABASE_URL`, applies migrations, and retains uniquely identified test runs/events. The acknowledgement is the operator's responsibility: no software check can prove a database is disposable. Use only a disposable database. That automated test uses a fixed test-only credential operation through the internal startup seam so it needs no configured server password. It binds a real `Bun.serve` listener on an ephemeral loopback port and uses real PostgreSQL/snapshot/worker composition; it is not a substitute for the manual workflow above.

## Bounds, coverage and recovery

- API JSON is capped at 256 KiB; report extraction defaults to 64,000 UTF-8 bytes. Snapshot ingestion examines at most 128 Solidity files, 120 lines per file and 512 KiB total source, and returns incomplete when limits/toolchain/import mapping prevent analysis. AST slices are retrieval context, not proof of a complete call/data-flow graph.
- The offline demo is scripted test material, not a supported Solidity coverage claim. It now records incomplete-BCE claims as UNVERIFIED, does not run PoCs by default, and emits no generated witness. PoC policy currently rejects every input.
- Stop the shared daemon with `bun run cli:serve -- stop`. Ctrl-C stops a foreground listener. The worker and database pool are closed on shutdown.
- Toolchain evidence recorded for BCE is `solc-js 0.8.30+commit.73712a01`; native Foundry fixture evidence is documented in the core package. The opt-in disposable-Postgres listener test covers HTTP→Postgres→worker→production-adapter using a test-only credential seam; its no-call assertion is not provider-routing coverage. Provider routing against a controlled endpoint remains a release gate.

The local `/v1/health` handshake is authenticated and reports the API version (no contract digest is advertised because there is no canonical versioned contract serialization to hash). Clients must fail closed on API-version mismatch; `assertApiCompatibility` implements that check. The handshake also reports deliberately limited runtime capabilities.

## Verification

From repository root:

```sh
bun run --cwd packages/server typecheck
bun run --cwd packages/server test
```

See the core package for the reviewed native fixture test. The production composition uses PostgreSQL but a live HTTP→Postgres integration test remains unavailable in this environment.
