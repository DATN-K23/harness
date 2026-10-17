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
The blueprint SHALL define versioned `read_file`, `list_dir`, `glob`, and text-search inputs, outputs, limits, deterministic ordering, truncation markers, and model-actionable errors. It MUST exclude generic shell and network tools. Tool definitions, schemas, and execution handlers MUST be organized within `packages/core/src/tool/` with a centralized `ToolRegistry` managing parameter validation and error normalization.

#### Scenario: Tool catalog is validated
- **GIVEN** the tool contract and description catalog
- **WHEN** a reviewer checks each exposed operation
- **THEN** every operation is read-only, rooted, bounded, versioned, and independently dispatchable through the registry

#### Scenario: Tools and registry reside in dedicated tool module
- **GIVEN** the implementation of source tools in `packages/core/src/tool/`
- **WHEN** tool registration and parameter schemas are loaded
- **THEN** tool handlers (`read_file`, `grep`, `glob`, `list_dir`) are modularly isolated and dispatchable through `ToolRegistry` without coupling to test fixtures
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
