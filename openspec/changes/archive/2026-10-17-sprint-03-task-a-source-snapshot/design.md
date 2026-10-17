# Design

## Context

See `proposal.md - Why` and Sprint 3 specifications.
Currently, the codebase uses `InMemorySnapshot` in tests and mock runs. In Sprint 3, the runtime must ingest real Solidity repositories from disk and allow bounded tools (`read_file`, `list_dir`, `grep`, `glob`) to query them using an opaque `snapshotId`.

Existing components to reuse from OpenCode & `@harness/core`:
- `packages/core/src/source/source-snapshot.ts`: `checkSnapshotPath`, `splitLines`, `comparePaths`, `globToRegExp`.
- `packages/protocol/src/ports.ts`: `SourceSnapshotPort`, `SnapshotReadResult`.
- `packages/core/src/util/digest.ts`: `digestOf` for deterministic SHA-256 calculation.
- `packages/core/src/util/id.ts`: `createIdGenerator` for opaque ID generation (`snap_...`).

## Goals / Non-Goals

**Goals:**
- Provide a `SnapshotManager` / `DiskSourceSnapshot` implementation in `@harness/core` that:
  - Ingests a local repository directory into a managed snapshot folder (e.g. `.harness/snapshots/<snapshotId>/`).
  - Immutably copies allowed files, filtering out secrets, ground-truth fixtures, and VCS directories.
  - Generates a `manifest.json` containing the tree digest and individual file hashes.
  - Implements `SourceSnapshotPort` (`readLines`, `listFiles`).
  - Persists across process restarts.
- Strict path authorization before any file system access.
- Support safe cleanup and status verification (detect corrupted or incomplete snapshots).

**Non-Goals:**
- Git clone or remote network fetching (out of scope for Sprint 3; repo path is local).
- Writable snapshots or live workspace synchronization (snapshots are strictly read-only).
- Modifying `CandidateFinding` or runner adjudication workflows (handled in Judge/Audit later stages).

## Decisions

### 1. Storage Location: Managed Directory vs Database vs In-Memory
- **Decision**: Store snapshotted files under a managed filesystem directory `.harness/snapshots/<snapshotId>/` with a root `manifest.json`.
- **Rationale**: Smart-contract repositories can contain many files and multi-megabyte dependencies. Keeping actual files on disk makes `readLines` fast and streamable, while `manifest.json` holds file inventory, line counts, and SHA-256 digests.
- **Alternatives considered**:
  - *Storing entire files in PostgreSQL*: High DB bloat, unnecessary for local-first execution.
  - *In-memory only*: Does not survive restarts, failing Sprint 3 requirement.
  - *Symlinking to host repository*: Violates immutability (modifying the original host repo would alter the snapshot).

### 2. Reuse of OpenCode Path Validation & Normalization
- **Decision**: Rely strictly on `checkSnapshotPath(path, deniedPrefixes)` from `packages/core/src/source/source-snapshot.ts` before performing `fs` calls.
- **Rationale**: Reuses tested path traversal checks from upstream OpenCode (`..`, absolute paths, slash normalization) ensuring zero escapes.

### 3. Ingestion Filtering (Ground Truth and Secret Isolation)
- **Decision**: Hardcode default exclusion rules during ingestion:
  - Denied directories: `.git`, `node_modules`, `.env*`, `test/ground-truth`, `adjudication`.
  - Secret extensions / names: `*.key`, `*.pem`, `id_rsa`, `.env`.
- **Rationale**: Guarantees Rule R2 (Ground-Truth Isolation) programmatically before any agent or tool can ever access the files.

### 4. Manifest Structure & Integrity Verification
- **Decision**: Store `manifest.json` with schema:
  ```json
  {
    "snapshotId": "snap_01J...",
    "createdAt": "2026-10-17T00:00:00.000Z",
    "treeDigest": "sha256:...",
    "files": {
      "contracts/Token.sol": {
        "digest": "sha256:...",
        "lineCount": 120,
        "byteSize": 3450
      }
    }
  }
  ```
- **Rationale**: Allows atomic completion check (write to temp dir, write manifest, rename dir) to avoid half-baked snapshots. Provides instant line count for `out_of_range` checks in `readLines`.

## Risks / Trade-offs

- **[Risk] Large repositories filling disk space** → **Mitigation**: Add a maximum file size check (e.g. max 5MB per file, max 100MB per snapshot) and provide a `cleanupSnapshot(snapshotId)` utility.
- **[Risk] Host filesystem changes during copy** → **Mitigation**: Copy files into a staging directory `.harness/snapshots/.tmp-<id>/`, calculate all digests, and atomically rename to `.harness/snapshots/<id>/`.
- **[Risk] Symlink escapes in host directory** → **Mitigation**: Resolve real paths during copy; if a symlink resolves outside the source root, skip or abort ingestion.

## Migration Plan

- `InMemorySnapshot` remains available for unit tests.
- Real runners and CLI commands can switch between `DiskSourceSnapshot` and `InMemorySnapshot` seamlessly via `SourceSnapshotPort`.
