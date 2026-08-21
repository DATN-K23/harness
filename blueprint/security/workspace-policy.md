# Source Snapshot and Workspace Policy

Normative: yes  
Version: `workspace-policy-v2`  
Owner: TV4; collaborator: TV3  
Requirements: TOOL-01–TOOL-04, VER-02

## Registration and snapshot import

Only the protected local source-registration operation accepts the native picker's raw host path. `source_access`, not the picker/UI, canonicalizes and authorizes it, imports a bounded allowlisted inventory into managed immutable content-addressed storage, computes revision/tree/inventory digests and returns `source_snapshot_id`. The raw path/handle is discarded after success or failure and never enters a durable record or ordinary log.

The imported inventory excludes official findings, invalid/valid labels, adjudication, reports, scoring files, dataset manifests/split metadata, credentials, VCS metadata, dependencies/build output, special files and symlinks. A selected parent does not authorize adjacent directories.

## Per-run workspace assembly

1. Resolve only the opaque snapshot ID under control-plane authorization.
2. Verify stored revision, canonical inventory and tree digest before any provider action.
3. Materialize exactly canonical candidate input and managed snapshot bytes under read-only `source/`.
4. Fail `snapshot_integrity` on any missing/additional/changed/non-allowlisted/symlinked entry.
5. Do not mount the original host repository, parent contest or dataset directory.
6. Compose only the four bounded source tools; process, network, write and plugin capabilities are absent.
7. Destroy the ephemeral workspace after terminal/recovery policy permits; retain content-addressed snapshot identity and approved safe references only.

## Relative path authorization

For every tool request before I/O:

1. require bounded UTF-8 and reject NUL/control characters;
2. reject POSIX absolute, drive/UNC, URI, backslash and non-canonical separators;
3. apply no URL/double decoding and reject encoded traversal-like segments defensively;
4. reject empty internal, `.`, `..` and prohibited alias segments;
5. join only against the already-resolved ephemeral `source/` root;
6. walk without following symlinks and recheck the final handle is contained;
7. require membership/type/digest in the immutable registered inventory;
8. read the checked handle under hard byte/line/result limits.

A denial happens before content read and yields a bounded model-actionable error plus safe `security.blocked` event. It never includes a raw host path, resolved outside target or prohibited original.

## Tool/resource policy

- Allow only bounded `read_file`, `list_dir`, `glob`, literal `search_text`.
- Structurally omit write/delete/rename, shell/process, packages/VCS, environment reads, raw descriptors, network/URL, hosted tools, plugin/skill discovery, dynamic registry changes, unrestricted regex and arbitrary workspace selection.
- Control-plane limits cannot be raised by model input.
- Listing/search order is deterministic; binary/special/unsupported content is rejected, not heuristically decoded.

## Evidence resolution

Evidence uses the same authorization algorithm and verifies one-based inclusive line order/range plus digest of the observed source span. Missing, outside, stale, symlinked, prohibited or mismatched evidence prevents verdict completion.

## Untrusted content and transformations

Candidate/source/tool content is untrusted data. Authorization/classification precede secret/prohibited redaction, delimiting, deterministic truncation, digesting and provider/persistence. Prompt instructions reduce semantic authority but are not the security boundary.

## Failure and teardown

Registration failure creates no snapshot/run and discloses only a safe category. Workspace identity failure before execution is `failed/workspace_preflight`. Teardown failure is an infrastructure/security event but cannot mutate terminal result or reveal the original path.

