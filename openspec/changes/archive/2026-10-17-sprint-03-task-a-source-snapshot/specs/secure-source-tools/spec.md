# Spec Delta

## ADDED Requirements

### Requirement: Disk-backed snapshot ingestion and persistence
The system MUST provide an ingestion mechanism to import a local repository directory into a managed immutable snapshot on disk. The ingestion process SHALL filter out disallowed paths (including `.git`, secret patterns, ground-truth labels, and scoring fixtures), copy the allowed files into a managed storage directory identified by an opaque snapshot ID, and generate a manifest with individual file digests and an aggregate tree digest.

#### Scenario: Successful repository ingestion into managed snapshot
- **GIVEN** a valid local repository directory containing source files and ignored directories (`.git`, `.env`)
- **WHEN** the repository is registered as a snapshot
- **THEN** a managed directory is created containing only allowed files, an opaque snapshot ID is assigned, all file digests and a tree digest are computed, and ignored/secret files are excluded

#### Scenario: Ingestion rejects path traversal or invalid host directory
- **GIVEN** a host directory path that does not exist or contains invalid path structures
- **WHEN** snapshot registration is initiated
- **THEN** the registration fails with a clear error without creating an incomplete snapshot or exposing host path details in model-visible errors

### Requirement: Persistent SourceSnapshotPort operations
The `SourceSnapshotPort` implementation for disk-backed snapshots MUST support `readLines` and `listFiles` using the opaque snapshot ID and relative paths, surviving application restarts. All operations SHALL enforce path authorization before performing disk I/O, rejecting directory traversal (`..`), absolute paths, and symlink escapes.

#### Scenario: Read lines from a persisted snapshot
- **GIVEN** an existing registered snapshot ID and a valid relative file path
- **WHEN** `readLines` is requested for a specific line range
- **THEN** the system returns `kind: "ok"` with the exact lines from the snapshot file, maintaining CRLF/LF normalization

#### Scenario: Read non-existent or out-of-range lines
- **GIVEN** a registered snapshot ID
- **WHEN** `readLines` is requested for a missing path or line range exceeding total line count
- **THEN** the system returns `kind: "not_found"` or `kind: "out_of_range"` with line count without crashing or exposing host paths

#### Scenario: Modifying original repository does not affect registered snapshot
- **GIVEN** a repository has been registered and snapshotted with snapshot ID `S1`
- **WHEN** files in the source repository on the host are modified, added, or deleted
- **THEN** subsequent calls to `readLines` and `listFiles` on `S1` return the exact original contents and file listing matching the initial tree digest
