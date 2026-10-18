## ADDED Requirements

### Requirement: Snapshot identity validation and storage containment
Every snapshot operation (ingest, load, read, list, delete) SHALL accept only a snapshot ID matching `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`, and SHALL verify that the resolved snapshot directory is a direct child of the resolved storage root before performing any filesystem call. An invalid ID SHALL fail with a typed error whose message contains no host path.

#### Scenario: Traversal snapshot ID is rejected before I/O
- **GIVEN** a storage directory and the snapshot ID `..`
- **WHEN** ingestion, loading or deletion is requested with that ID
- **THEN** the operation fails with an invalid-snapshot-ID error, no file or directory outside the storage root is read, written or removed, and the error text contains no absolute path

### Requirement: Content-addressed write-once snapshots with read-time integrity
When no snapshot ID is supplied, ingestion SHALL derive it from the content as `snap_` followed by the first 12 hexadecimal characters of the tree digest. Ingestion SHALL never remove or overwrite an existing snapshot:

- When the target ID exists with the same tree digest, ingestion SHALL return the existing snapshot unchanged.
- When the target ID exists with a different tree digest, ingestion SHALL fail.

Every read from a disk-backed snapshot SHALL recompute the file digest and compare it with the manifest entry. A mismatch SHALL fail the read with an integrity error that names only the relative path.

#### Scenario: Re-ingesting identical content is idempotent
- **GIVEN** a repository ingested once without an explicit ID, producing snapshot `S1`
- **WHEN** the unchanged repository is ingested again without an explicit ID
- **THEN** ingestion returns `S1`, and its files and manifest are unchanged

#### Scenario: Changed content gets a new snapshot
- **GIVEN** a registered snapshot `S1` produced from a repository
- **WHEN** a file in the repository is edited and the repository is ingested again without an explicit ID
- **THEN** a different snapshot ID is produced, and `S1` still returns its original content

#### Scenario: Explicit ID with different content is refused
- **GIVEN** a registered snapshot with explicit ID `fixture-1`
- **WHEN** a repository with different content is ingested with the explicit ID `fixture-1`
- **THEN** ingestion fails, and `fixture-1`'s files and manifest are unchanged

#### Scenario: Tampered snapshot content is detected
- **GIVEN** a registered snapshot whose stored file was modified after ingestion
- **WHEN** that file is read through the snapshot port
- **THEN** the read fails with an integrity error, and the modified content is not returned

### Requirement: Reference-aware snapshot cleanup
Deleting a snapshot SHALL require a usage check and SHALL refuse when the snapshot is referenced by a non-terminal run. The usage check SHALL be answerable from the run store through an optional `findActiveRunsBySnapshot` query, implemented by the in-memory and PostgreSQL stores. Leftover staging directories from interrupted ingestions SHALL be removable without touching completed snapshots.

#### Scenario: Snapshot in use is not deleted
- **GIVEN** a snapshot referenced by a run in state `running`
- **WHEN** deletion is requested
- **THEN** deletion is refused and the snapshot remains readable

#### Scenario: Interrupted ingestion leaves no visible snapshot
- **GIVEN** an ingestion interrupted after writing its staging directory
- **WHEN** staging cleanup runs
- **THEN** the staging directory is removed, completed snapshots are untouched, and the interrupted ID resolves as not found

### Requirement: Depth-independent bounded ingestion policy
Ingestion SHALL apply the following rules, and SHALL record every skipped path and its reason in the manifest.

- **Denied paths:** at any directory depth and case-insensitively, it SHALL deny the directories `.git`, `node_modules`, `.github`, `adjudication`, `ground-truth`, `groundtruth`, `scoring` and the files `.env*`, `*.pem`, `*.key`, `id_rsa*`.
- **Include roots:** it SHALL support an optional include-roots allow-list.
- **Links:** it SHALL skip symbolic links and junctions without following them.
- **Size and content:** it SHALL skip binary files and files over the configurable per-file size limit, and SHALL fail when the file-count or total-byte limit is exceeded.
- **Report-like names:** it SHALL record a `report_like_name` warning in the manifest for any ingested file whose name contains, case-insensitively, `finding`, `report`, `judg`, `adjudic`, `ground`, `label` or `score`.

#### Scenario: Report-like file outside include roots is excluded, inside is flagged
- **GIVEN** a repository with `src/Vault.sol`, `audit/findings-report.md` and `src/docs/report.md`
- **WHEN** it is ingested with include roots `["src"]`
- **THEN** `audit/findings-report.md` is not in the snapshot, `src/docs/report.md` is ingested, and the manifest carries a `report_like_name` warning for it

#### Scenario: Nested denied directories are excluded
- **GIVEN** a repository containing `lib/forge-std/.git/config`, `lib/dep/node_modules/x/index.js` and `contracts/.ENV`
- **WHEN** it is ingested
- **THEN** none of those files is in the snapshot manifest or storage, and the manifest lists the denied directory (`lib/forge-std/.git`, `lib/dep/node_modules`) or denied file (`contracts/.ENV`) as skipped with reason `denied`, without enumerating the contents of denied directories

#### Scenario: Symlink and oversized files are skipped
- **GIVEN** a repository containing a symlink to a file inside the repository and a 2 MiB source file
- **WHEN** it is ingested with default limits
- **THEN** neither file is copied, and the manifest lists them as skipped with reasons `symlink` and `too_large`

### Requirement: Registry-enforced deny policy and path-free tool errors
The tool registry SHALL always enforce the default deny policy in addition to any configured denied prefixes. No tool result SHALL contain an absolute host path, including results produced from snapshot errors or unexpected exceptions; unexpected exceptions SHALL map to a fixed generic error message.

#### Scenario: Denied file in a fixture map is not readable
- **GIVEN** a registry created over a files map containing `test/ground-truth/label.json` with no configured denied prefixes
- **WHEN** `read_file` requests that path
- **THEN** the result is an access-denied error and the file content is not returned

#### Scenario: Missing snapshot error is path-free
- **GIVEN** a registry bound to a snapshot ID that does not exist in storage
- **WHEN** `read_file` is executed
- **THEN** the result is an error that names the snapshot ID only and contains no absolute host path

### Requirement: Always-marked read truncation and time-bounded search
Source tools SHALL mark every truncation and SHALL bound search time, as follows.

`read_file`:

- SHALL set `isTruncated` and append the truncation marker whenever its line or byte bound removes content, whether the bound is configured or default.
- SHALL report the line range actually returned.

`grep`:

- SHALL evaluate the model-supplied pattern under a hard time limit, a scanned-byte limit and a per-line length limit.
- On timeout it SHALL return a model-actionable error result; on any other bound it SHALL mark truncation.

`glob` and `grep` SHALL use their own result limits. The registry SHALL expose its effective tool limits so that a run can record them.

#### Scenario: Default line bound is marked
- **GIVEN** a 3,000-line file and no configured line limit
- **WHEN** `read_file` reads it
- **THEN** 2,000 lines are returned, `isTruncated` is true, the marker is present, and `lineRange` is `[1, 2000]`

#### Scenario: Search exceeding the time limit is stopped
- **GIVEN** a registry whose grep time limit is shorter than the time the scan needs
- **WHEN** `grep` runs a model-supplied pattern
- **THEN** the worker is terminated, the call returns promptly with an error result telling the model to use a more specific pattern, and the process is never blocked by the pattern

