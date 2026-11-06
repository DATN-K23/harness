# secure-source-tools Specification

## Purpose

Defines the source-workspace and tool-security blueprint that prevents Judge agents from reaching ground truth, host resources, networks, or unbounded content.

## Requirements

### Requirement: Immutable source-only workspace blueprint
The blueprint MUST define opaque `SourceSnapshot` registration, contest identity, immutable revision and tree digest, preflight verification, ephemeral read-only mounting, and exclusion of labels, reports, manifests, scoring metadata, secrets, and raw host paths from model-visible content and run evidence. A desktop repository picker MAY provide an operator-selected host path only as short-lived control-plane input to the local runtime; `source_access` MUST canonicalize, authorize, snapshot and digest it before any run can reference the source. Later run requests, provider traffic, trajectories, ordinary logs and desktop traces MUST use only the opaque snapshot identity and approved source-relative evidence.

#### Scenario: Workspace contents are reviewed
- **GIVEN** a candidate finding, registered snapshot, and adjacent ground-truth fixtures
- **WHEN** the planned workspace assembly is traced
- **THEN** only canonical candidate data and the authorized `source/` tree can reach the agent boundary

#### Scenario: Desktop registers a repository path
- **GIVEN** the native shell returns a selected host directory to the local-runtime registration operation
- **WHEN** the runtime validates and registers the source
- **THEN** the shell grants no model/tool authority, the runtime rejects unsafe or mutable registration states, and successful run-facing records retain an opaque snapshot ID, immutable revision and digest without the raw host path

### Requirement: Purpose-built bounded tool contracts
The blueprint SHALL define versioned `read_file`, `list_dir`, `glob`, and text-search inputs, outputs, limits, deterministic ordering, truncation markers, and model-actionable errors. It MUST exclude generic shell and network tools. Tool definitions, schemas, and execution handlers MUST be organized within `packages/core/src/tool/` with a centralized `ToolRegistry` managing parameter validation and error normalization. The execution handlers SHALL be backed by `SourceSnapshotPort` to operate on immutable disk-backed snapshots. Output size, line counts, and execution timeout MUST be strictly bounded, appending explicit truncation markers when limits are exceeded, and failures MUST return structured non-throwing error results.

#### Scenario: Tool catalog is validated
- **GIVEN** the tool contract and description catalog
- **WHEN** a reviewer checks each exposed operation
- **THEN** every operation is read-only, rooted, bounded, versioned, and independently dispatchable through the registry

#### Scenario: Tools and registry reside in dedicated tool module
- **GIVEN** the implementation of source tools in `packages/core/src/tool/`
- **WHEN** tool registration and parameter schemas are loaded
- **THEN** tool handlers (`read_file`, `grep`, `glob`, `list_dir`) are modularly isolated and dispatchable through `ToolRegistry` without coupling to test fixtures

#### Scenario: Tool execution on disk-backed source snapshot
- **GIVEN** a registered snapshot with ID `snap-123` on disk
- **WHEN** `read_file`, `list_dir`, `glob`, or `grep` is executed via `ToolRegistry.execute()`
- **THEN** content and file listings are resolved via `SourceSnapshotPort` without direct unauthorized host filesystem access

#### Scenario: Bounded tool output and truncation marker
- **GIVEN** a search or read operation that yields more results than configured limits (e.g. max matches or max bytes)
- **WHEN** the tool execution completes
- **THEN** the output is deterministically truncated and an explicit truncation marker `[Output truncated. ...]` is appended to the result content

#### Scenario: Model-actionable non-throwing error reporting
- **GIVEN** an invalid regex pattern, non-existent path, or access violation
- **WHEN** a tool call is executed
- **THEN** `execute()` resolves to a `ToolExecutionResult` with `isError: true` containing a descriptive, model-actionable error message instead of rejecting the Promise

### Requirement: Canonical path authorization and ground-truth denial
The blueprint MUST define rejection before I/O for absolute paths, traversal encodings, symlink escapes, unauthorized aliases, and any path resolving outside the authorized source root; it MUST require a separate safe security event.

#### Scenario: Escape attempt is modeled
- **GIVEN** absolute, traversal, symlink, and adjudication-alias attack cases
- **WHEN** each case is evaluated against the authorization algorithm
- **THEN** the blueprint identifies the exact denial stage, safe agent error, security event, and prohibited data that must never be read or persisted

### Requirement: Redaction and untrusted-data handling
The blueprint SHALL define deterministic secret/prohibited-data redaction, explicit untrusted-data delimiters for candidate and source/tool content, transformation versioning, pre-persistence enforcement, and an adversarial acceptance catalog for prompt injection and secret fixtures.

#### Scenario: Sensitive tool result is modeled
- **GIVEN** a bounded tool result containing a configured secret pattern and untrusted instructions
- **WHEN** it crosses toward persistence or provider context
- **THEN** the blueprint requires deterministic redaction and data delimiters and forbids storage of the prohibited original value

### Requirement: Structural denial of excluded capabilities
Excluded Judge capabilities MUST be absent from the advertised registry and unavailable at the execution boundary, not merely hidden by UI, prompt instruction, runtime approval, or a default permission rule. This structural denial applies to write, delete, rename, execute, shell, process, package-manager, network, VCS, environment-variable, arbitrary-URL, raw-descriptor, provider-hosted and unrestricted extension tools.

#### Scenario: Permission approval cannot widen Judge authority
- **GIVEN** a configuration, model request, plugin, provider response, or operator action attempting to approve an excluded capability
- **WHEN** effective Judge tools and dispatch routes are materialized
- **THEN** no executable registration exists, the request is safely rejected and recorded, and approval cannot make the capability available without a separate versioned security and ablation change

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

### Requirement: Hard-deny for report and discussion artifacts
Ingestion and the tool registry SHALL deny the following, at any depth and case-insensitively:

- every file under a directory named `audits`, `discord-export`, `.claude` or `.cursor`;
- every file with extension `.md`, `.txt`, `.html`, `.htm`, `.pdf` or `.json` whose name contains `findings`, `_v12`, `post-mortem`, `postmortem`, `4naly3er`, `audit-report` or `audit report`.

Source-code files SHALL NOT be denied by these name rules.

#### Scenario: Bot and AI-audit reports never enter the snapshot
- **GIVEN** a repository containing `4naly3er-report.md`, `2025-11-megapot_V12.md`, `code_423n4_x_findings.md`, `POST-MORTEM.md`, `discord-export/chat.txt`, `.claude/commands/audit-solidity.md` and `audits/Report.pdf`
- **WHEN** it is ingested
- **THEN** none of those files is in the snapshot, and each is listed as skipped with reason `denied`

#### Scenario: Code with a report-like name is kept
- **GIVEN** a repository containing `test/unit/on-report/onReport.t.sol`
- **WHEN** it is ingested
- **THEN** the file is in the snapshot

### Requirement: Ingestion policy version in the manifest
Every manifest written by ingestion SHALL record the ingestion policy version (`ingest-policy-v2` for this change). The version SHALL be excluded from the tree digest. Manifests without the field SHALL remain valid.

#### Scenario: Policy version is recorded without changing the digest
- **GIVEN** a repository ingested once
- **WHEN** its manifest is read
- **THEN** it records `ingestionPolicyVersion: "ingest-policy-v2"`, and its tree digest equals the digest computed over the file paths and file digests alone

