# Safe Source Tool Contracts

Normative: yes  
Version: `tool-contracts-v2`  
Owner: TV3; collaborator: TV4  
Requirements: TOOL-01–TOOL-04

## Registry envelope

Every tool definition has `name`, `contract_version`, `description_version`, JSON input schema, JSON output schema, capability class, limits, and dispatcher identifier. The registry is immutable for one run and its definition contents/digests are snapshotted.

Every result uses:

| Field | Meaning |
|---|---|
| `ok` | Boolean success; denied and operational failures are false. |
| `tool` / `version` | Contract identity. |
| `data` | Tool-specific bounded data on success. |
| `error` | Normalized code, safe message, context, and suggested next action. |
| `truncated` | Whether sanitized output was shortened. |
| `omitted_count` | Exact count when known, otherwise null. |
| `transformation_ids` | Redaction/truncation rule versions. |
| `sanitized_pre_truncation_digest` | Digest after prohibited-data redaction and before size truncation. |

## Common path rules

All paths are relative POSIX strings evaluated only against the run's pre-resolved managed `source_snapshot_id`. Absolute paths, empty paths where a file is required, NUL, `.`/`..` segments, encoded traversal, non-normalized separators, symlink escapes, and paths outside the authorized root fail before content read. Models never submit snapshot/workspace IDs or host roots; the dispatcher injects the already-authorized snapshot scope.

## Tool catalog

### `read_file` v1

Input: `path`, optional one-based `start_line`, optional `end_line`, `max_bytes`, `max_lines`.  
Output: normalized relative path, requested/resolved line range, numbered text lines, bytes returned, total lines when safely known, truncation/omission metadata, source content digest.

Rules: text allowlist only; reject directory/binary/oversized single-line hazards according to workspace policy; `start_line <= end_line`; hard limits cannot be raised by model input.

### `list_dir` v1

Input: optional relative directory (empty means source root), `max_entries`.  
Output: lexically ordered entries with normalized relative path and `file|directory`; no host metadata, symlink target, inode, owner, or adjacent directory.

### `glob` v1

Input: safe relative glob pattern and `max_matches`.  
Output: normalized lexically ordered authorized file paths and explicit truncation count. Patterns are matched only within an already enumerated authorized tree; absolute patterns and parent traversal are invalid.

### `search_text` v1

Input: literal UTF-8 query, optional safe glob filter, `max_matches`, per-line byte limit. Regex is excluded from v1 to avoid engine/complexity ambiguity.  
Output: path, one-based line number, bounded line excerpt, match offsets relative to sanitized excerpt, deterministic path/line/offset order.

## Error catalog

| Code | Safe message content | Suggested action |
|---|---|---|
| `invalid_arguments` | Field paths and constraints only | Correct parameters. |
| `path_denied` | Normalized submitted relative input and policy rule ID | Choose a path under listed source tree. |
| `not_found` | Safe relative path | List parent or search. |
| `not_a_file` / `not_a_directory` | Safe relative path | Use correct tool. |
| `unsupported_content` | Relative path and allowed class | Select text source. |
| `result_limit` | Limit and returned count | Narrow query/range. |
| `io_failure` | Stable category without host details | Retry another authorized read or report. |

## Excluded capabilities

There is no write, delete, rename, execute, shell, process, package-manager, network, VCS, environment-variable, arbitrary URL, raw file descriptor, unrestricted regex, hosted provider tool, plugin/skill discovery, dynamic tool installation, source registration or arbitrary workspace-selection tool in Judge MVP. The registry is an immutable allowlist assembled at composition; unknown names cannot resolve through a fallback. Execution/PoC belongs to a future isolated `VerificationRunner`, never to this registry.
