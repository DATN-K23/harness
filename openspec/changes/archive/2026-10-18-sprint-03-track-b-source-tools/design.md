# Design: Sprint 3 Track B - Source Reading Tools

## Context
See `proposal.md` for motivation. Currently, `packages/core/src/tool/registry.ts` and its handlers (`read-file.ts`, `grep.ts`, `glob.ts`, `list-dir.ts`) operate on an in-memory `Record<string, string>` map. In Sprint 3, Track A implemented `DiskSourceSnapshot` backing `SourceSnapshotPort` with an immutable on-disk manifest and directory structure. Track B must bridge tool execution to this snapshot port while enforcing truncation, isolation, and error boundaries.

## Goals / Non-Goals

**Goals:**
- Provide a dual-mode or snapshot-first `ToolRegistryOptions` that accepts a `snapshot: SourceSnapshotPort` (with snapshotId) or falls back to in-memory fixtures.
- Adapt OpenCode's schema validation, parameter checking, and actionable error messages for `read_file`, `list_dir`, `glob`, and `grep`.
- Implement explicit bounds:
  - Max lines / max bytes per `read_file` request (e.g. 2000 lines or 100KB).
  - Max matches for `grep` (e.g. 100 matches) with `[Output truncated. Showing first X matches...]`.
  - Max directory/glob items (e.g. 500 paths).
  - Timeout handling via `signal: AbortSignal`.
- Enforce strict ground-truth isolation (`deniedPrefixes` checking before any I/O).
- Ensure `ToolRegistry.execute()` never throws unhandled errors, resolving to `{ isError: true, content: ... }`.

**Non-Goals:**
- Write tools (`write_file`, `edit_file`, `patch`): strictly forbidden by research controls in Judge mode.
- Direct host filesystem execution, shell commands (`bash`), or network access.
- Complex semantic context compaction (reserved for Context Engine in future milestones).

## Decisions

### 1. Snapshot Adapter Interface in Tool Context
- **Decision**: Update tool handler context interfaces (e.g. `ReadFileContext`, `GrepContext`) to accept either a `SourceSnapshotPort` + `snapshotId` or an in-memory file map / provider.
- **Rationale**: Keeps existing unit tests passing without spinning up disk structures, while allowing full production runs to read directly from `DiskSourceSnapshot`.
- **Alternative considered**: Forcing all tests to create temporary disk snapshots. Rejected because it slows down unit test execution and adds unnecessary filesystem overhead.

### 2. Adaptation from OpenCode Handlers
- **Decision**: Reuse OpenCode's regex parsing, line slicing, glob matching algorithms, and model-actionable error texts, but wrap file access with `checkSnapshotPath` and snapshot port reads.
- **Rationale**: OpenCode's error messages are refined to help LLMs self-correct invalid line ranges or broken regexes. Reusing them saves engineering time and avoids edge-case regressions.
- **Alternative considered**: Writing regex/glob handlers from scratch. Rejected as redundant reinvention of proven logic.

### 3. Truncation and Sanitization Strategy
- **Decision**: Perform line-based and match-based truncation with explicit markers before returning content. Scrub secrets using `redactSecrets`.
- **Rationale**: Prevents accidental token context overflow and maintains Ground-Truth / credential isolation.

## Risks / Trade-offs

- **[Grep performance on large disk snapshots]** → Disk-backed snapshots parse manifest or read files sequentially. Mitigation: Limit glob/grep to text files indexed in `SnapshotManifest`, and enforce search match limit (max 100 matches).
- **[Path normalization variations on Windows vs Unix]** → Traversal checks could behave differently. Mitigation: `checkSnapshotPath` canonicalizes separators using POSIX standards.
