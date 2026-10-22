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

`startJudgeServer` is a testable composition seam, not an approved production entrypoint. One local readiness-only command is `bun run cli:serve`; it validates explicit database/model config, an accessible snapshot directory, the exact pinned image digest, live PostgreSQL, and macOS Keychain, then binds only loopback and obtains its API credential from Keychain. It does **not** probe provider connectivity or expose Judge submission/worker execution.

**Judge release remains BLOCKED; this is readiness-only, not a working Judge service.** Task 3's BCE is explicitly incomplete for verdict purposes, Task 5's PoC policy denies all and Docker was exercised only on Linux ARM64 (macOS unverified), and Task 6 does not expose the API/runtime. PoC execution is hardcoded false; there is no API/config switch. Health reports `judgeExecution: unavailable`, `enablePocExecution: false`, and `bce-incomplete`. Startup does not call the model endpoint; API-key presence/provider configuration are validated but connectivity is not.

## API

The injectable API/runtime seam accepts `POST /v1/judge/runs` with `Idempotency-Key` and JSON (not served by `cli:serve`):

```json
{
  "finding": { "findingId": "finding-123", "reportMarkdown": "..." },
  "snapshotId": "snapshot-opaque-id"
}
```

For narrative-only, `reportMarkdown` can contain the bounded labeled report, for example `Target: Vault.withdraw\nRoot cause: ...\nAttack scenario: ...\nImpact: ...\nState: ...`. For a submitter-PoC input, use the same labels and append a fenced `solidity` or `forge` block containing the test. Both are candidate user input; neither may include ground-truth, adjudication or scoring metadata. The present deny-only policy rejects PoC inputs, and this request example is for the injectable seam only—not a callable `cli:serve` endpoint.

For either narrative-only or a report with a fenced Solidity/Foundry PoC, put the candidate report text in `reportMarkdown`; the runtime seam returns `202` only after durable admission with `runId`, state `accepted`, and `statusUrl`. Then use `GET /v1/judge/runs/{runId}`, `GET /v1/judge/runs/{runId}/events` (finite cursor pages), and `POST /v1/judge/runs/{runId}/cancel`. `valid/PASS` requires verified evidence and is not currently demonstrated; `invalid/FAIL` is reserved for validated refutation, not process errors; incomplete BCE, absent/unsafe PoC, and sandbox infrastructure failure must remain `unverified/UNVERIFIED`. No runtime PASS is claimed.

## Bounds, coverage and recovery

- API JSON is capped at 256 KiB; report extraction defaults to 64,000 UTF-8 bytes. Snapshot ingestion examines at most 128 Solidity files, 120 lines per file and 512 KiB total source, and returns incomplete when limits/toolchain/import mapping prevent analysis. AST slices are retrieval context, not proof of a complete call/data-flow graph.
- The offline demo is scripted test material, not a supported Solidity coverage claim. It now records incomplete-BCE claims as UNVERIFIED, does not run PoCs by default, and emits no generated witness. PoC policy currently rejects every input.
- On interrupted local readiness startup, stop with Ctrl-C; `cli:serve` closes its listener and database pool. On a stuck test container, the adapter uses its bounded timeout/cancellation cleanup; inspect/remove only the uniquely named disposable test container if Docker itself is unavailable during cleanup. Do not run production/repository PoCs.
- Toolchain evidence recorded for BCE is `solc-js 0.8.30+commit.73712a01`; sandbox evidence is Foundry Forge 1.5.1 in the pinned ARM64 image, tested on Linux only. Docker Desktop/macOS behavior is unverified. PostgreSQL production-path integration and full HTTP→Postgres→worker→production-adapter testing remain unverified.

The local `/v1/health` handshake is authenticated and reports the API version (no contract digest is advertised because there is no canonical versioned contract serialization to hash). Clients must fail closed on API-version mismatch; `assertApiCompatibility` implements that check. The handshake also reports deliberately limited runtime capabilities.

## Verification

From repository root:

```sh
bun run --cwd packages/server typecheck
bun run --cwd packages/server test
swiftc -typecheck packages/server/native/keychain-credential.swift
TASK5_DOCKER_INTEGRATION=1 TASK5_ARTIFACT_ROOT="$HOME/Library/Caches/harness-task5/artifacts" bun test packages/server/test/docker-foundry-sandbox.test.ts
```

The Docker command is explicitly opt-in and uses disposable benign/assertion fixtures only; it does not validate macOS isolation. A live PostgreSQL Judge E2E is not currently available because the production composition is not exposed.
