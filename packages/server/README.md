# `@harness/server`

The server package exposes the local Judge API handler and runtime composition primitives. It does not start a process at import time.

## Local security requirements

- Bind only to `127.0.0.1`, `::1` or `localhost` using `listenLocal` / `startJudgeServer`.
- On macOS, `startJudgeServer` gets the installation credential from the generic-password item in Keychain (`com.harness.local-api`, account `installation`). On first launch it creates a random 256-bit URL-safe secret. Rotation replaces the item; clients must reacquire it through the native credential boundary.
- The Swift helper requires Xcode Command Line Tools (`swift`) and the user Keychain to be available. Any Keychain/helper error fails startup. Unsupported OS does not fall back to `.env`, a plaintext file, anonymous access or process arguments.
- Pass the credential to the client as `Authorization: Bearer <credential>`. Never put it in a URL, trajectory, log or renderer storage.

## Composition

Create `@harness/server`'s runtime with a `RunStorePort`, `SourceSnapshotPort`, frozen `JudgeRunConfig`, ID generator, and a factory for the other `JudgeRunnerDeps` (provider gateway, context engine, tools, security filter, sandbox, cancellation, clocks/random/sleep). `createJudgeRuntime` exposes:

- `api.fetch(request)` — authenticated submission, safe run projection, ordered event pages and cancellation.
- `worker.runOnce()` — claim and execute available outbox work by stable run ID.

`startJudgeServer` is a testable composition seam, not an approved production entrypoint. `bun run cli:serve` starts the fail-closed local health/API compatibility endpoint after validating explicit database/model config, an accessible snapshot directory, the exact pinned image digest, live PostgreSQL, and macOS Keychain. It binds only loopback and obtains its API credential from Keychain.

**Judge release remains BLOCKED.** The local process deliberately does not expose submission/worker execution: Task 3 BCE is always incomplete, Task 5 policy is deny-only, and Docker Desktop/macOS isolation validation is outstanding. PoC execution is hardcoded false; there is no API/config switch. Health reports `judgeExecution: unavailable`, `enablePocExecution: false`, and `bce-incomplete`. This endpoint is useful only for local dependency/readiness and compatibility checks, not as a working Judge service. Startup does not call the model endpoint; API-key presence/provider configuration are validated but connectivity is not.

## API

`POST /v1/judge/runs` requires `Idempotency-Key` and JSON:

```json
{
  "finding": { "findingId": "finding-123", "reportMarkdown": "..." },
  "snapshotId": "snapshot-opaque-id"
}
```

Successful durable admission returns `202` with `runId`, state `accepted`, and `statusUrl`. Then use `GET /v1/judge/runs/{runId}`, `GET /v1/judge/runs/{runId}/events` (finite cursor pages), and `POST /v1/judge/runs/{runId}/cancel`. A model-only conclusion remains `unverified`; execution errors are not invalid verdicts.

The local `/v1/health` handshake is authenticated and reports the API version (no contract digest is advertised because there is no canonical versioned contract serialization to hash). Clients must fail closed on API-version mismatch; `assertApiCompatibility` implements that check. The handshake also reports deliberately limited runtime capabilities.

## Verification

From repository root:

```sh
bun run --cwd packages/server typecheck
bun run --cwd packages/server test
swiftc -typecheck packages/server/native/keychain-credential.swift
```
