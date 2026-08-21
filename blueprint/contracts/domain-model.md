# Domain Model and Canonical Serialization

Normative: yes  
Version: `domain-model-v1`  
Owner: TV1; collaborators: TV5, TV6  
Requirements: ORCH-01–ORCH-04, VER-01–VER-03, DATA-01–DATA-04

## Aggregate boundaries

| Aggregate/value | Identity | Required semantics | Boundary |
|---|---|---|---|
| `CandidateFinding` | `candidate_finding_id` + `content_digest` | Title, description, optional claimed paths/lines, normalized source platform reference | Agent-visible, untrusted; never contains official label |
| `SourceSnapshot` | `source_snapshot_id` | Safe source identity, immutable revision, canonical inventory/tree digest, managed content reference | Imported by `source_access`; original host path is discarded and never supplied by run/model |
| `JudgeRun` | `run_id` | Mode, lifecycle state/version, candidate/snapshot refs, timestamps, terminal reason | Aggregate root; transition authority is `RunApplication` |
| `RunConfiguration` | one-to-one `run_id` | Exact resolved flags, budgets, prompts, tools, schemas, provider/model, pricing, manifest/split, runtime/build refs | Immutable after accepted state |
| `TrajectoryEvent` | `event_id`; order `(run_id, sequence)` | Versioned type, exact sanitized model-visible content or safe metadata | Append-only; no cross-run reads |
| `Verdict` | one-to-one completed run | Validity/severity/confidence/rationale/unverified status | Exists only after schema and evidence validation |
| `Evidence` | verdict-local ID | Authorized relative path, one-based inclusive lines, content digest | Resolved against the run's snapshot |
| `Experiment` | `experiment_id` | Frozen protocol/manifest/scorer/pricing versions and digests | Evaluation control plane |
| `ExperimentCell` | `experiment_cell_id` | Case, arm, repeat, run reference, terminal accounting, score reference | Label joins only after terminal run |
| `GroundTruthLabel` | scorer-only `case_id` | Official validity/severity/adjudication source | Never part of run aggregate or trajectory |

## Commands

| Command | Input | Success | Failure categories |
|---|---|---|---|
| `CreateJudgeRun` | canonical finding, snapshot ID, config, idempotency key | Accepted run + immutable snapshot | invalid input, source/config unresolved, key conflict, persistence/enqueue failure |
| `ClaimJudgeRun` | run ID, worker/claim identity, expected version | Running run and claim token | terminal, cancelled, stale, unavailable |
| `AdvanceJudgeRun` | run ID, claim, next action/events | Appended events and updated aggregates | stale claim, terminal, budget/cancel stop |
| `CompleteJudgeRun` | valid verdict/evidence, usage/cost, expected version | Atomic completed aggregate | schema/evidence invalid, stale, cancelled, budget exhausted |
| `FailJudgeRun` | normalized reason, aggregates, expected version | Atomic failed aggregate | stale or already terminal |
| `CancelJudgeRun` | run ID, requester, expected/current state | Request recorded or terminal cancelled | unknown run; existing terminal returned unchanged |
| `ScoreExperimentCell` | terminal run ID, scorer credential | Separate score record | non-terminal, missing label, protocol mismatch |

## Canonical states and outcomes

States and reasons are defined in `vocabulary.md` and `architecture/judge-lifecycle.md`. A terminal record has exactly one state and one primary reason where applicable. `completed` requires a valid verdict; other terminal states must not expose a final verdict.

## Context allocation

`ContextAllocation` records model context limit, source/version of that limit, output reserve, input capacity, token-estimator version, token counts per bucket, transformation IDs, remaining tokens, and preflight outcome. It is an event payload, not mutable global configuration.

## Provider attempt

`ProviderAttempt` binds attempt index to provider/model identity, native request ID, endpoint/region when exposed, request digest, capability profile, sampling values, timing, native and normalized usage, pricing version, cost, response/error classification, and retry decision. Credential fields are structurally forbidden.

## Tool call

`ToolCall` binds a model-requested tool name/version and bounded sanitized arguments to authorization result, duration, exact model-visible result/error, safe pre-truncation digest, transformation IDs, and token estimate. A blocked call has a separate `security.blocked` event.

## Verdict semantics

The machine schema is `judge-verdict.schema.json`. Cross-field semantics are:

| Validity | Allowed severity | Evidence | Verification |
|---|---|---|---|
| `valid` | `low`, `medium`, `high`, `critical` | At least one resolvable item | `unverified` |
| `invalid` | `none` | At least one resolvable item explaining rejection | `unverified` |

Confidence is an analysis signal in `[0,1]`, not a calibrated probability claim.

## Evidence

Each item uses a normalized authorized path, one-based inclusive `start_line`/`end_line`, and SHA-256 of the exact source bytes spanned under the immutable snapshot. Resolution rejects missing files, outside-root paths, symlink escapes, reversed/out-of-range spans, digest mismatch, and prohibited material.

## Canonical serialization

### JSON values

Content-addressed JSON uses RFC 8785 JSON Canonicalization Scheme principles: UTF-8, lexically ordered object keys, no insignificant whitespace, deterministic number serialization, and array order preserved. Domain money is serialized as a decimal string plus currency, avoiding binary floating-point ambiguity.

Textual user fields normalize CRLF/CR to LF and Unicode to NFC before canonical JSON serialization. Exact model-visible content is preserved after deterministic redaction and does not undergo later normalization.

### Source tree

Source files retain exact bytes. Paths are normalized UTF-8 POSIX relative paths; directories and files are sorted by path bytes; symlinks and non-allowlisted file types are rejected. For each file:

```text
entry = path_utf8 || NUL || decimal_byte_length || NUL || sha256(file_bytes)
source_tree_digest = sha256(entry_1 || LF || ... || entry_n)
```

### Digests

- Format: `sha256:<64 lowercase hex>`.
- Candidate digest: canonical `CandidateFinding` JSON.
- Configuration digest: fully resolved immutable `RunConfiguration` JSON.
- Prompt/tool/schema digest: exact UTF-8 content bytes.
- Experiment identity: canonical JSON of protocol digest, manifest digest, `case_id`, arm, and repeat index.
- For sensitive tool results, redaction occurs first. The stored pre-truncation digest covers sanitized content, never the raw secret/prohibited value.

## Boundary examples

| Input | Outcome |
|---|---|
| Same object with reordered JSON keys | Same canonical digest. |
| Same user text with CRLF versus LF | Same candidate digest after declared normalization. |
| Source file differing by one byte | Different tree and evidence digest. |
| Same case/arm but different repeat | Different `experiment_cell_id`. |
| Same idempotency key, different canonical request digest | Conflict; never reuse run. |
| Changed global flag after acceptance | Original run configuration and digest remain unchanged. |
