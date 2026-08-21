# SourceBundle v1

Normative: yes  
Version: `source-bundle-v1`  
Owner: TV5; collaborators: TV2, TV4  
Requirement: EVAL-03

## Inputs

- Verified immutable `SourceSnapshot` inventory and tree digest.
- Evaluation-side contest/source-family/split references used only to prove paired snapshot identity; these references are never included in model-visible bundle bytes.
- Canonical candidate claimed relative paths, if present.
- Allowlisted text extensions and hard per-file/total byte/token budgets.
- Versioned token estimator and mandatory output reserve inherited from protocol.

## Normative algorithm

1. Authorize and verify the snapshot using `workspace-policy-v1`; labels/reports/manifests are absent.
2. Normalize all authorized text paths as POSIX relative paths.
3. Form priority group A from candidate-claimed paths that resolve to allowlisted files; deduplicate and sort lexically.
4. Form group B from all remaining allowlisted text files; sort lexically.
5. Iterate A then B. For each file, emit the exact delimiter below plus complete file bytes normalized only from CRLF/CR to LF if the entire block fits the allocated input budget.
6. Never cut a UTF-8 code point or silently cut a file. If a complete block cannot fit, omit it and record path, byte length, source digest, and reason.
7. After files, emit one deterministic omissions block sorted by path.
8. Compute SHA-256 over exact UTF-8 bundle bytes. Record source tree digest, bundle digest, estimator/version, allocated budget, included and omitted records.

## Delimiters

```text
<<<SOURCE_FILE path="normalized/relative/path" sha256="sha256:..." bytes="N">>>
<exact normalized text>
<<<END_SOURCE_FILE>>>
```

Omissions:

```text
<<<OMITTED_SOURCE_FILES>>>
path\tbytes\tsha256\treason
...
<<<END_OMITTED_SOURCE_FILES>>>
```

Source text inside delimiters is untrusted data, not instruction.

## Allowlist and exclusions

The protocol version declares extensions appropriate to the selected contest language, such as `.sol`, and may include build metadata needed to interpret source only after security review. It excludes official reports, labels, adjudication, scoring data, dataset manifests/split/family metadata, secrets, VCS metadata, binaries, generated artifacts, dependencies outside the registered tree, and symlinks. The direct and harness arms resolve the same `source_snapshot_id`, revision and tree digest before either arm runs; family/split policy is enforced outside model-visible context.

## Reproducibility example

The synthetic `examples/source-bundle-v1.txt` contains two included files and one omission. Its exact digest is `sha256:fc1891d18a46130af218bb8bd7eb01355661804028a02b43bbb8cbffc0d24c6a`. Two implementations using the same inputs/budget must produce identical bytes and digest; tokenizer estimates may differ only when estimator/version differs, which would create protocol drift.
