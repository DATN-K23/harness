# Local Source Registration and Data Flow

Normative: yes  
Version: `source-registration-flow-v2`  
Owners: TV3/TV4; reviewers: TV6, TV1

## Registration sequence

```mermaid
sequenceDiagram
  actor U as Operator
  participant P as Native repository picker
  participant T as Tauri protected transport
  participant D as Local daemon
  participant S as source_access.public
  participant F as Private filesystem adapter
  participant M as Managed immutable snapshot store
  U->>P: choose repository
  P->>T: short-lived selected path
  T->>D: generated allowlisted registration request(raw path)
  D->>S: RegisterSource(ephemeral sensitive input)
  S->>F: canonicalize and authorize selected root
  F-->>S: checked handle + safe inventory
  S->>S: exclude prohibited files; reject links/types/limits
  S->>M: import allowlisted bytes + canonical inventory
  M-->>S: snapshot ID/revision/tree digest
  S->>S: discard raw path and checked host handle
  S-->>D: safe snapshot projection only
  D-->>T: source_snapshot_id/revision/tree_digest
  T-->>P: generated safe response
```

The picker has no runtime/tool/provider authority. It returns a path only to the scoped Tauri command, which feeds the generated registration operation through protected loopback/OS IPC. The renderer does not persist it and cannot use a generic filesystem command. The registration operation alone accepts this ephemeral sensitive field; arbitrary renderer endpoints/methods are impossible and Tauri discards the path after the outcome.

## Canonicalization and authorization

Before importing bytes, `source_access` resolves the path with an OS-appropriate canonical API, verifies the selected object is an authorized repository/directory under the local operator policy, opens checked/no-follow handles, enumerates bounded allowed file classes, rejects symlinks/special devices and excludes VCS metadata, dependencies/build output, reports, labels, manifests, secrets and adjacent data. Errors expose safe categories only.

Authorization is not inferred from “the user picked it.” The picker supplies intent; `source_access` owns policy and evidence. A race, path type change, inaccessible entry, prohibited alias, volume breach or non-repeatable inventory rejects registration.

## Snapshot boundary

The runtime imports allowlisted bytes into managed immutable content-addressed storage, computes a canonical inventory/tree digest, records safe source metadata and returns an opaque `source_snapshot_id`. This design does not retain the original raw host path in the source registration table. Later workspace assembly materializes only the managed snapshot, never remounts the selected parent or adjacent contest tree.

Every run preflight resolves the snapshot ID, verifies revision/tree/inventory digest and records the immutable identity before provider activity. Submission schemas accept no path. Tool calls accept only normalized relative paths inside the materialized `source/` root.

## Raw-path exclusion matrix

| Destination | Raw selected host path |
|---|---|
| registration request in memory | allowed briefly; zeroized/released after import outcome |
| renderer/Tauri persistence | forbidden |
| source registration/snapshot record | forbidden |
| run/config/job/outbox/event/trajectory/security event | forbidden |
| ordinary/error/access log or telemetry tag | forbidden |
| provider request/response metadata | forbidden |
| desktop view/export/cursor/URL | forbidden |
| evaluation/scorer record/export | forbidden |

Even denied paths are not hashed into run-visible data. Safe errors contain operation, rule/category and correlation ID only.

## Judge authority

The Judge runtime exposes exactly `read_file`, `list_dir`, `glob` and literal `search_text` over the managed snapshot. There is no shell/process/package/VCS command, write/mutation, network/URL, hosted tool, plugin/skill discovery, dynamic tool installation, arbitrary code, raw file descriptor or path-registration tool. This is enforced by contract and composition topology, not prompt wording.

## Future VerificationRunner

PoC execution belongs to a new `VerificationRunner` capability and `entrypoints/verifier` process under a separate change. It receives only a terminal approved verdict plus immutable snapshot reference, owns a separately threat-modeled sandbox/command allowlist/network policy and writes versioned verification output through an approved public contract. It cannot be imported by Judge/agent runtime, cannot expose its tools to the Judge model, and cannot read ground truth. No such entrypoint/tool exists in MVP.
