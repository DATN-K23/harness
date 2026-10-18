## Why

The Sprint 3 code for Track A (repository snapshots), Track B (source tools) and Track C (multi-turn runner) runs and its tests pass, but a review on 2026-10-18 (Codex plus manual reproduction) found defects in exactly the research controls the project cannot trade away. Some were reproduced by running the code:

- a `snapshotId` of `..` makes snapshot deletion and re-ingestion operate outside the storage directory;
- nested `.git` and `node_modules` directories are copied into snapshots;
- `read_file` silently cuts files at 2,000 lines with no truncation marker;
- tool errors return absolute host paths to the model;
- `grep` runs model-supplied regular expressions with no time bound (`^(a+)+$` on a 32-character line took 0.8 s, and each extra character doubles that).

Other defects were confirmed by reading the code:

- snapshots are not write-once;
- tool arguments reach events and later requests unfiltered;
- the runner and the tool registry can point at different snapshots;
- budgets are not re-checked before tool dispatch and reset on resume;
- `MultiTurnRunner.execute` can reject on a store error;
- the CLI typecheck fails.

These must be fixed before Track D wires the chain to the CLI and real providers. Otherwise every RQ1 measurement taken on this chain would rest on a harness that can leak host paths, read outside its snapshot, or misreport cost. This change serves RQ1 (direct versus Harness on the same model) and the cost and reproducibility outcomes. It is corrective work, not an experimental result.

## What Changes

- **Track A, snapshot integrity:**
  - Validate snapshot IDs as a single safe path component and confirm every resolved storage path stays inside the storage root before any filesystem call.
  - Derive the default snapshot ID from the content and make snapshots write-once: identical content returns the existing snapshot, conflicting content fails.
  - Verify each file's digest against the manifest when it is read.
  - Make deletion refuse snapshots still referenced by a non-terminal run, using an optional run-store query.
- **Track A, ingestion policy:**
  - Apply the deny policy at every directory depth and case-insensitively (`.git`, `node_modules`, ground-truth and adjudication names, `.env*`, `*.pem`, `*.key`, `id_rsa*`).
  - Add an optional include-roots allow-list, and warn in the manifest on report-like file names.
  - Skip symlinks and junctions instead of following them.
  - Bound per-file size, file count and total bytes, and skip binary files.
  - Record every skipped path and its reason in the manifest.
- **Track B, deny policy:** the tool registry always enforces the default deny policy in addition to any configured prefixes.
- **Track B, path-free errors:** every error that can reach the model is free of host paths. The registry no longer forwards raw exception text.
- **Track B, `read_file`:** always marks truncation, whether by lines or bytes, and reports the line range it actually returned.
- **Track B, `grep`:** runs in an isolated worker with a hard timeout, caps scanned bytes and matched-line length, and marks truncation. `glob` and `grep` get separate limits. Truncation is read from the `isTruncated` flag, not guessed from the text.
- **Track C, two-tier sanitizer:** model-visible text is sanitized before it is persisted or assembled into a request. URLs stay intact in both tiers.
  - Full tier (host paths, credentials, ground-truth markers): applies to the prompt, tool arguments and generated messages.
  - Credentials-only tier: applies to content read from the snapshot, so the model sees the source exactly as stored and `file:line` evidence stays valid.
- **Track C, unreadable files and tool limits:** the initial source information lists files skipped as too large or binary. Each run records its effective tool limits.
- **Track C, snapshot binding:** the runner refuses to start when the registry is bound to a different snapshot than the run. On resume it checks the stored snapshot ID and prompt.
- **Track C, budgets:**
  - Re-evaluate limits after every model response, before tool approval or dispatch.
  - Restore the run start time and the tool-call count from history on resume.
  - Enforce `maxPromptLength`.
- **Track C, persistence:**
  - Persist each tool result before its `tool.completed` event.
  - Write the attempt row before its `provider.attempted` event.
  - Fail closed (`persistence_failure`, no model call) when resumed history cannot be hydrated.
  - Key run-query reconstruction by (step, call ID).
- **Track C, error handling:**
  - Classify transient provider errors as `provider_transient_primary` instead of `provider_permanent`.
  - Wrap `MultiTurnRunner.execute` so it never rejects.
- **Cross-cutting:**
  - Fix the `@harness/cli` typecheck (`process.loadEnvFile` typing).
  - Add one end-to-end test through real disk snapshot → `ToolRegistry` → `MultiTurnRunner` with a scripted gateway.
- **BREAKING (internal):**
  - Snapshot ingestion now rejects an existing `snapshotId` and changes which files are copied.
  - `SnapshotManager.deleteSnapshot` requires an in-use check.
  - `MultiTurnRunnerDeps.registry` must be bound to the run's snapshot.
  - Existing snapshots stay readable because the manifest format stays compatible.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `secure-source-tools`: adds requirements for snapshot identity validation, write-once storage with read-time integrity checks, reference-aware cleanup, depth-independent and case-insensitive ingestion policy with bounded and skipped-file accounting, registry-enforced deny policy, path-free tool errors, always-marked truncation, and a time-bounded `grep`.
- `multi-turn-runner`: adds requirements for snapshot binding and resume identity checks, one model-visible sanitizer, post-response and resumed budget enforcement, crash-consistent tool-result and attempt persistence, fail-closed hydration, transient/permanent provider error classification, and a never-reject guarantee.

## Impact

- **Code:** `packages/core/src/source/*`, `packages/core/src/tool/*` (registry, handlers, a grep worker), `packages/core/src/runner/{multi-turn-runner,request-assembly,run-queries}.ts`, a new `packages/core/src/util/sanitize.ts`, `packages/cli/src/config.ts`, plus tests under `packages/core/test/{source,tool,runner}` and one new e2e test.
- **Contracts:** additive only, and no database migration.
  - `SnapshotManifest` gets optional `skipped` and `warnings` lists.
  - `ToolRegistry` exposes a read-only `snapshotId` and `limits()`.
  - `@harness/protocol` gets two optional additions: `RunStorePort.findActiveRunsBySnapshot` and `toolLimits` in `RunConfigSnapshotSchema`. Existing events still parse.
- **Data:** snapshots created before this change remain readable. Re-ingesting them under the same ID is refused by design. Cleanup now needs a run-usage check supplied by the caller (Track C/D through the run store).
- **Research controls:** strengthened. Ground-truth isolation, the snapshot-only reading surface, no host paths or credentials in requests or events, and correct cost and stop accounting are all preserved or restored.
- **Non-goals:**
  - Track D gateway and CLI wiring.
  - Context compaction.
  - A PostgreSQL-backed snapshot metadata table.
  - Changes to the Judge pipeline.
  - Relaxing any blueprint gate.
