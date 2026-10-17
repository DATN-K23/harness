# Tasks

## 1. Contracts & Path Authorization (Reusing OpenCode)

- [x] 1.1 Verify and expand `packages/core/src/source/source-snapshot.ts` path normalization and exclusion predicates (filtering secrets, ground truth, and VCS dirs). Verify with `bun test packages/core/test/source/`
- [x] 1.2 Define `SnapshotManifest` and `SnapshotMetadata` schemas and serialization utilities in `@harness/core`. Verify schema parsing with unit tests.

## 2. Ingestion & Persistence

- [x] 2.1 Implement `SnapshotManager.ingestRepository({ sourceDir, snapshotRoot, snapshotId? })` to copy allowed files into `.harness/snapshots/<snapshotId>`, compute digests with `digestOf`, and write `manifest.json`. Verify ingestion creates an atomic, read-only directory and excludes `.git` / `.env` fixtures.
- [x] 2.2 Handle incomplete, corrupted, or missing snapshots with robust error states (`not_found`, `corrupted_snapshot`). Verify with negative test cases.

## 3. Persistent SourceSnapshotPort Implementation

- [x] 3.1 Implement `DiskSourceSnapshot` implementing `SourceSnapshotPort` (`readLines`, `listFiles`) backed by disk and the manifest. Verify conformance against `SourceSnapshotPort` interface.
- [x] 3.2 Add test suite asserting immutability: modifying the host repo after ingestion does not alter `readLines` or `listFiles` output of `DiskSourceSnapshot`. Verify with `bun test packages/core/test/source/disk-source-snapshot.test.ts`.

## 4. Integration Verification

- [x] 4.1 Export `DiskSourceSnapshot` and `SnapshotManager` through `@harness/core` source entrypoint. Verify full package typecheck via `bun turbo typecheck`.
- [x] 4.2 Run end-to-end repository snapshotting test across clean process boundaries. Verify with `bun test`.
