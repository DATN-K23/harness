# Proposal

## Why

To evaluate LLM-assisted smart-contract security auditing against real repositories (Sprint 3), the agent loop and reading tools need access to real code without risking data contamination, secret leakage, or non-reproducible mutations. Current tests and runners rely on in-memory fixtures (`InMemorySnapshot`). We need a real snapshot implementation that registers a local repository directory, freezes it into an immutable snapshot identified by an opaque ID and tree digest, and enforces strict path isolation (no host paths, traversal, symlink escapes, or ground-truth access).

## What Changes

- **Repository Registration & Ingestion**: Provide an ingestion routine to import a local repository directory into a managed snapshot directory (`.harness/snapshots/<snapshotId>`) or equivalent storage.
- **Exclusion Filters**: Filter out secret files (`.env*`, `*.pem`, `*.key`), version control internals (`.git`), ground-truth findings, adjudication reports, and benchmark labels before freezing.
- **Snapshot Immutability & Digest**: Compute deterministic SHA-256 digests for each file and the root manifest to guarantee source immutability across runs and program restarts.
- **Real `SourceSnapshotPort` Implementation**: Implement `DiskSourceSnapshot` (or `ManagedSourceSnapshot`) implementing `SourceSnapshotPort` (`readLines`, `listFiles`), reusing OpenCode path validation algorithms (`checkSnapshotPath`, `splitLines`, `comparePaths`).
- **Snapshot Inventory & Listing**: Expose file metadata (line counts, file paths relative to snapshot root) by `snapshotId` for consumption by Tool handlers (Sprint 3 Task B) and CLI (Sprint 3 Task D).
- **Error & Edge-Case Handling**: Cleanly handle missing snapshots, incomplete/corrupt snapshots, out-of-bounds line reads, and directory traversal attempts.

## Capabilities

### Modified Capabilities
- `secure-source-tools`: Extend requirements to specify disk-based snapshot ingestion, manifest persistence, and validation of real repository imports while preserving path isolation and ground-truth exclusion.

## Impact

- **Affected Packages**:
  - `@harness/core`: Add disk snapshot manager and implementation under `src/source/` (e.g. `disk-source-snapshot.ts`, `snapshot-manager.ts`).
  - `@harness/protocol`: Update or verify `SourceSnapshotPort` contracts if registry metadata queries are needed.
  - `@harness/schema`: Schema or disk metadata definitions for registered snapshots.
- **Integration Seams**:
  - Task B (Tools) consumes `SourceSnapshotPort` via `snapshotId`.
  - Task D (CLI) uses snapshot registration and selection commands.
- **Research Controls**:
  - Ground-truth isolation enforced at ingest time and tool access boundary.
  - No raw host paths leak into trajectories or model requests.
