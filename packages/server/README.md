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

`startJudgeServer` accepts a platform listener and a credential provider, composes the runtime, enforces loopback and auth, and returns `runWorkerOnce()` plus `stop()`. The deployment entrypoint must invoke worker polling under its supervised lifecycle and provide the real PostgreSQL/source/provider dependency graph. This package does not yet provide a turnkey production composition or continuously supervised daemon executable.

Production composition is **BLOCKED**: real ingestion, sanitizer, sandbox, PostgreSQL/provider/source wiring, and approved Docker image/isolation evidence are not available. `startJudgeServer` is a composition seam, not proof of production readiness; callers must supply the actual dependency graph. Task 3 BCE outcomes are incomplete, so the current runner cannot establish static PASS/FAIL either.

## API

`POST /v1/judge/runs` requires `Idempotency-Key` and JSON:

```json
{
  "finding": { "findingId": "finding-123", "reportMarkdown": "..." },
  "snapshotId": "snapshot-opaque-id"
}
```

Successful durable admission returns `202` with `runId`, state `accepted`, and `statusUrl`. Then use `GET /v1/judge/runs/{runId}`, `GET /v1/judge/runs/{runId}/events` (finite cursor pages), and `POST /v1/judge/runs/{runId}/cancel`. A model-only conclusion remains `unverified`; execution errors are not invalid verdicts.

API compatibility validation is available through `validateApiCompatibility`; the actual health/discovery endpoint still needs to be connected by the deployment composition.

## Verification

From repository root:

```sh
bun run --cwd packages/server typecheck
bun run --cwd packages/server test
swiftc -typecheck packages/server/native/keychain-credential.swift
```
