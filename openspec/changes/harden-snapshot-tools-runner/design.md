## Context

See [proposal.md](proposal.md). The defects come from a 2026-10-18 review of commits `9a86050` (Track A), `42f981a` (Track B) and `2bf74df` (Track C) on branch `agent-loop-core`. The review was done by Codex (`gpt-6-luna`, effort `xhigh`) plus manual reproduction. Reproduced by running code:

- `snapshotId ".."` resolves outside storage;
- nested `lib/forge-std/.git/config` and `lib/dep/node_modules/...` are ingested;
- `read_file` on a 3,000-line file returns 2,000 lines with no marker;
- a missing snapshot makes `read_file` return `Snapshot not found ... (checked "C:\Users\...")` to the model;
- `grep` with `^(a+)+$` on a 32-character line takes about 0.8 s and doubles per character.

The other findings were confirmed by reading the code. The existing main specs (`secure-source-tools`, `multi-turn-runner`) already require most of the correct behavior, so most of this change is conformance work. New requirements are added only where the specs were silent: snapshot ID rules, write-once storage, in-use cleanup, ingestion bounds, a grep time bound, runner/registry binding, and never-reject.

Constraints:

- Bun/TypeScript.
- `@harness/protocol` stays browser-safe. The only protocol changes are additive and optional: `toolLimits` in the run config snapshot (D7) and `findActiveRunsBySnapshot` on `RunStorePort` (D3).
- No new database migration.
- Light testing: one focused test per scenario, per the user's earlier instruction.

## Goals / Non-Goals

**Goals:**

- Close every finding marked Critical or Important in the review, with one test per scenario.
- Keep existing snapshots readable and existing tests green, except tests that pinned the buggy behavior.

**Non-Goals:**

- Track D work (gateway tool-calling mapping, CLI registration/run/view commands).
- Snapshot metadata in PostgreSQL.
- Context compaction.
- Breaking protocol changes: only the two optional additions listed in Constraints.

## Decisions

### D1. Snapshot ID and storage containment (Track A)

Snapshot IDs must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`. One helper, `resolveSnapshotDir(storageDir, id)`, validates the ID, resolves the path, and asserts the result is a direct child of the resolved storage root. `SnapshotManager` (ingest, load, delete) and `DiskSourceSnapshot` call it before any filesystem operation.

Invalid IDs raise `InvalidSnapshotIdError`. Its message contains the ID but no host path.

*Alternative:* sanitize the ID instead of rejecting it. Rejected, because silent rewriting hides caller bugs.

### D2. Content-addressed, write-once storage and read-time integrity (Track A)

**Resolved question 6.** The default snapshot ID is derived from the content: `snap_<first 12 hex characters of treeDigest>`. Ingestion computes the tree digest in staging first, then:

- **Target absent:** rename staging into place.
- **Target present with the same `treeDigest`:** discard staging and return the existing snapshot (idempotent re-ingest).
- **Target present with a different `treeDigest`:** fail with `SnapshotExistsError`. This can only happen with an explicit ID or a prefix collision.

Callers may still pass an explicit ID; the same rules apply. Ingestion never removes an existing target. Re-ingesting unchanged source therefore yields the same ID, which keeps experiments reproducible (TV5), while changed source always yields a new ID.

`DiskSourceSnapshot.readLines` recomputes the file digest the same way ingestion computes it (`digestOf` of the UTF-8 content) and compares it with the manifest. On mismatch it throws `SnapshotIntegrityError` with the relative path only. The digest scheme is unchanged, so old snapshots, including those with random IDs, stay readable. The digest is computed per read; the cost is acceptable because D4 bounds file size.

*Alternative:* random IDs with strict write-once. Rejected, because re-ingesting the same repository would create a new snapshot every time and break run-to-run reproducibility.

### D3. Reference-aware cleanup (Track A with C)

**Resolved question 7.** `RunStorePort` gains an optional query `findActiveRunsBySnapshot(snapshotId): Promise<string[]>`, which returns IDs of runs not in a terminal state. This is an additive port change; no event schema changes.

- `InMemoryRunStore` and `PostgresRunStore` implement it. Postgres queries `runs WHERE snapshot_id = $1 AND state NOT IN (terminal states)`; the column exists since migration 0001, so no new migration is needed.
- Core exports `snapshotInUse(store)`, which returns the `isInUse` callback.
- `deleteSnapshot(storageDir, id, { isInUse })` requires the callback and refuses with `SnapshotInUseError` when it returns true. Track D's CLI passes `snapshotInUse(store)`.
- Snapshot metadata stays in the manifest; there is no PostgreSQL snapshot table in this change.

`cleanupStaging(storageDir)` removes leftover `.tmp-*` directories from interrupted ingestions.

*Alternative:* reference counting stored in the manifest. Rejected, because the run store is already the authority.

### D4. Ingestion policy (Track A)

The deny policy is evaluated case-insensitively on every path segment, not only at the root:

- **Directory names:** `.git`, `node_modules`, `.github`, `adjudication`, `ground-truth`, `groundtruth`, `scoring`.
- **File names:** `.env*`, `*.pem`, `*.key`, `id_rsa*`.

An optional `includeRoots` allow-list restricts ingestion to the given relative roots.

**Resolved question 1.** Ground truth is kept out primarily by *what* is ingested: TV5 ingests only the contest `source/` directory, or passes `includeRoots`. As a second layer, ingestion still copies a file whose name looks like an adjudication artifact, but records a warning for it in the manifest (`warnings: [{ path, reason: "report_like_name" }]`). The matched name fragments, case-insensitive, are `finding`, `report`, `judg`, `adjudic`, `ground`, `label`, `score`. Warnings are surfaced by the CLI at registration, so the operator sees the risk without legitimate docs being silently dropped.

**Resolved question 4.** Symlinks and junctions are skipped (checked with `lstat`), never followed, and recorded as skipped. This removes the check-then-read race. If a survey of about 10 contest repositories shows they rely on symlinks, a later change can replace internal links with copies of the target content read at check time.

Bounds:

| Bound | Default | When exceeded |
|---|---|---|
| Per-file size | 1 MiB | File skipped |
| File count | 20,000 | Ingestion fails |
| Total bytes | 200 MiB | Ingestion fails |
| Binary file (NUL byte in the first 8 KB) | — | File skipped |

Skipped files are recorded in an optional manifest field `skipped: [{ path, reason }]`. The reasons are `denied`, `symlink`, `too_large` and `binary`. All limits are ingestion options.

**Resolved question 8.** The 1 MiB per-file limit stays the default, but nothing is lost silently:

- the operator can raise the limit at registration;
- the runner's initial source information lists the `too_large` and `binary` files (bounded, at most 20 entries plus a count) as present but not readable. The model then knows the gap exists instead of concluding the code is absent.

Denied and symlink paths are not listed to the model, since their names could themselves be sensitive.

*Alternative:* keep following internal symlinks. Rejected, because the race could not be closed without handle-based reads.

### D5. Tool boundary (Track B)

`ToolRegistry` always merges `DEFAULT_DENIED_PREFIXES` and the filename rules from D4 into whatever prefixes the caller passes. Callers cannot opt out.

The registry exposes a read-only `snapshotId`.

The catch-all no longer forwards `error.message`. It returns `Tool execution failed (internal error). Retry or use a different path.` and logs nothing path-bearing into the result. Snapshot errors (D1-D3) are mapped to fixed, path-free messages.

### D6. read_file (Track B)

Truncation is flagged whenever the line bound or the byte bound cuts content, whether or not the caller configured the limit. The marker is appended and `isTruncated` is set. `lineRange` reports the first and last line actually returned.

### D7. grep (Track B)

The scan runs in a `node:worker_threads` worker with a hard timeout (default 2,000 ms). The worker is terminated on timeout and the tool returns `grep timed out after <n> ms; use a more specific pattern or path.`

Other bounds:

| Bound | Default | When exceeded |
|---|---|---|
| Scanned bytes | 50 MiB | Scan stops, marked truncated |
| Characters per matched line | 500 | Line cut, marked truncated |

`glob` and `grep` limits are passed separately. The same worker code serves the snapshot and in-memory backends.

**Resolved question 3.** Task 3.5 measured `grep` on the three contests in `harness-verification-data` and found regex-matching p95 of at most 7.8 ms. The default timeout is therefore now 1,000 ms, and the scan cap stays at 50 MiB. The original procedure was: Before the change is archived, Track B with Research measures `grep` on the 3 Solidity repositories chosen for Sprint 3. The patterns are `function\s+\w+`, `transfer\(` and `onlyOwner`. The timeout is then set to the larger of 1,000 ms and 10 × the observed p95 scan time, and the measurement table is recorded in task 5.3.

The effective tool limits are exposed by `ToolRegistry.limits()`:

- `read_file`: lines and bytes;
- `grep`: timeout, scan bytes, line length and matches;
- `glob`: matches;
- `list_dir`: entries.

The runner records them in `run.started`, so every run states the bounds it used and they enter the snapshot digest. `RunConfigSnapshotSchema` is a plain `z.object`, which would strip an unknown key, so this needs one additive protocol change: an optional `toolLimits` object in `RunConfigSnapshotSchema`. Old events, which lack it, still parse.

*Alternatives:* a regex-safety heuristic (incomplete), or a third-party RE2 binding (a native dependency and still a gate). Both rejected.

### D8. Two-tier model-visible sanitizer (Track C with B)

**Resolved question 5.** Source content read from the snapshot must reach the model byte-for-byte as stored, apart from credential redaction. Otherwise evidence `file:line` stops matching the snapshot. Our host paths cannot occur inside the snapshot, because the files come from the repository, not from our machine. `packages/core/src/util/sanitize.ts` therefore exports two functions.

**`sanitizeSystemText(text, secrets)`, the full tier.** It removes:

- Windows drive paths (`X:\…`, `X:/…`);
- UNC paths (`\\host\…`);
- POSIX absolute paths, only when preceded by start, whitespace or a quote and not part of `scheme://`, so GitHub permalinks survive;
- credential patterns, by reusing `redactSecrets`;
- `GroundTruthLabel…`, `adjudication_report…` and `scoring…` lines.

It applies to text that the harness or the model produces rather than the snapshot:

- the prompt;
- every string value inside tool-call arguments, before the dispatcher appends `tool.requested` and before history items are built;
- tool error results, which are generated messages;
- the initial source information.

**`sanitizeSourceContent(text, secrets)`, the credential tier.** It applies only `redactSecrets`: explicit secrets, `sk-…` style keys, PEM blocks and connection-string credentials. It applies to successful tool results whose content comes from the snapshot (`read_file`, `grep` match lines, `glob` and `list_dir` paths).

`request-assembly.ts` uses the full tier instead of its local regexes. The protocol exemption for `tool.requested.arguments` stays, because it is a key-name scan; the values are now sanitized in core before the append.

*Alternative:* one tier for everything (the earlier draft). Rejected, because a comment such as `// see /docs/spec.md` would be altered and the model would cite text that is not in the snapshot.

### D9. Runner binding, budgets and persistence order (Track C)

**Binding.** `execute` fails early with `invalid_input` when `registry.snapshotId` is defined and differs from `input.snapshotId`. On resume it loads the run record and fails with `invalid_input` if the stored `snapshotId` or `prompt` differs from the input. A swallowed `seedRun` error is no longer silent: it triggers this check.

**Budgets.**

- Limits are evaluated at the top of each step and again after each model response, before approval and dispatch. Usage is already added at that point.
- **Resolved question 2.** Before every provider attempt the runner checks that the remaining token budget is at least `maxOutputTokens` (when set). If the remaining token budget is smaller, the run stops with `total_tokens` instead of making a call that is certain to overrun. With that guard, a final text answer can overrun a budget only by the prompt-token estimate error. Such an answer still completes the run (`completed`, output kept). The multi-turn runner emits no `run.completed` event (that payload carries a Judge verdict), so the exhausted limits are returned as `observedLimits` in the run result and remain derivable from the persisted `provider.attempted` usage plus the limits in `run.started`, which TV5 can use to filter these runs when computing cost.
- On resume, the run start time comes from the `run.started` event's `occurredAt`, and `completedToolCalls` from the hydrated `tool_result` items.
- `maxPromptLength` (default 100,000 characters) is checked before snapshot access.

**Persistence order inside `onResult`.**

1. `context.item_added` for the request.
2. `context.item_added` for the result.
3. `tool.completed` or `tool.failed`, carrying the result item ID.

A crash before step 3 leaves a recoverable result, not an interrupted one.

The attempt row (`recordModelAttempt`, idempotent) is written before `provider.attempted`.

**Hydration.** A hydration result other than `hydrated` fails closed with `persistence_failure` and makes no model call.

**Error classification.**

| Provider error category | Terminal reason |
|---|---|
| `authentication`, `invalid_request` | `provider_permanent` |
| `rate_limit`, `transport` | `provider_transient_primary` (retry stays disabled) |

**Never reject.** The whole body of `execute` is wrapped. An unexpected error tries a `failed`/`persistence_failure` transition and always returns a result.

**Run queries.** Reconstruction keys calls by `${stepIndex}:${callId}`. Result-truncation detection uses `result.isTruncated` only.

### D10. Cross-cutting

`packages/cli/src/config.ts` narrows `process` to a local type with an optional `loadEnvFile` instead of relying on an absent Bun type.

A new test `packages/core/test/runner/disk-chain-e2e.test.ts` runs the full chain in-process, with no network or database:

1. ingest a temporary repository;
2. build a `DiskSourceSnapshot` and a `ToolRegistry` bound to it;
3. run `MultiTurnRunner` with a scripted gateway that calls `read_file` and then answers, against `InMemoryRunStore`;
4. assert ordered history, the bound snapshot, and no host path anywhere in events or requests.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Skipping symlinks may drop legitimate files from some repositories | Recorded in `skipped`; teams can vendor real files |
| Per-read digest verification costs CPU | File size bounded to 1 MiB by default |
| Worker start-up adds latency to every `grep` | A few tens of ms, acceptable against provider latency; one worker per call keeps the timeout reliable |
| POSIX-path redaction can over-redact prose such as `and/or` | Requires a leading `/` after start/whitespace/quote; tests cover URLs and common prose |
| Write-once breaks callers that re-ingest under a fixed ID | Generated IDs are the default; tests updated |
| Light testing leaves edge cases uncovered | One test per scenario; the e2e chain test catches integration breaks |

## Migration Plan

- No database or protocol migration.
- Existing snapshot directories keep working: digest scheme unchanged, `skipped` optional.
- Callers of `deleteSnapshot` must pass `isInUse`.
- Callers that relied on re-ingesting a fixed ID must pick a new ID.
- Rollback is reverting the change commits.

## Resolved Questions

| # | Question | Resolution | Where | Owner to confirm |
|---|---|---|---|---|
| 1 | Block report-like file names? | No silent blocking; ingest `source/` or `includeRoots`; warn on report-like names in the manifest and CLI | D4 | TV5, Track A |
| 2 | Final answer over budget: `completed` or `budget_exhausted`? | `completed` plus telemetry; a pre-call check that the remaining token budget covers `maxOutputTokens` keeps overruns small | D9 | Track C, TV5 |
| 3 | grep timeout and scan cap | 1,000 ms (= max(1000, 10 × measured p95 7.8 ms)) and 50 MiB; limits recorded per run | D7, task 3.5 | Done |
| 4 | Follow internal symlinks? | Skip all and record; survey found 0 symlinks in 3 contests | D4, task 2.3 | Done |
| 5 | Sanitize source content? | Two tiers: full for system/model text, credentials-only for snapshot content | D8 | Track C, B |
| 6 | Random or content IDs? | Content-addressed default ID; idempotent for identical content; conflict error otherwise | D2 | Track A, TV5 |
| 7 | Who answers "is it in use"? | Optional `RunStorePort.findActiveRunsBySnapshot` plus `snapshotInUse(store)`; CLI passes it | D3 | Track A, C, D |
| 8 | Files over 1 MiB | Keep the default (largest `.sol` observed: 412 KiB); configurable; listed to the model as present-but-unreadable | D4, task 2.3 | Done |

## Task 5.4 research: proposals for Q1, Q2 and Q6

Evidence comes from `D:\DATN\harness-verification-data` at commit `154a79e`, which holds 3 contests. The survey and the scorer-side leak check are described in the 2.3 / 3.5 evidence in tasks.md. The proposals below need TV5/Research confirmation before they become requirements; their implementation is listed as a separate follow-up change at the end of this section.

### Q1. Report-like files and ground truth inside the ingested source

**Finding.** A contest's `src/` is not pure source code.

| Contamination source | Contests | How the current policy treats it |
|---|---|---|
| Bot static-analysis reports (`4naly3er-report.md`) | 3/3 | Warning only |
| AI-audit bot reports (V12): `2025-11-megapot_V12.md` and two intuition `*findings*.md` files | 2/3 | Warning on the intuition files; the megapot file is not even flagged |
| Previous audit reports (PDF) | 2/3 | Skipped as binary, by luck |
| Discord export: 1.1 MiB of HTML/TXT warden discussion | 1/3 | Ingested |
| `POST-MORTEM.md` | 1/3 | Ingested, not flagged |
| Sponsor AI prompts in `.claude/commands/audit-*.md` (prompt-injection surface) | 1/3 | Ingested |

A scorer-side check compared finding titles against snapshot content; the titles stay on the scorer side.

- **Default whole-`src/` snapshot:** **1 of 15 valid finding titles appears verbatim.** It is intuition M-01, inside a V12 findings file.
- **`includeRoots` limited to code directories:** **0 of 15** leak.

A manifest warning is therefore not enough: this is exactly the ground-truth leakage risk the project lists first.

**Proposal.** All four layers sit outside the agent's control.

1. **Code-only ingestion profile per contest.** TV5's corpus manifest declares `includeRoots` for every contest. The default profile is `contracts`, `src`, `lib`, `test`, `tests` and `script`, plus build config (`foundry.toml`, `remappings.txt`). Evaluation runs refuse a snapshot ingested without a profile.
2. **Wider hard-deny defaults**, applied to non-code files only (`.md`, `.txt`, `.html`, `.pdf`, `.json`), so code such as Chainlink's `on-report/onReport.t.sol` is not hit.
   - Directories: `audits`, `discord-export`, `.claude`, `.cursor`.
   - File names containing `findings`, `_v12`, `post-mortem`/`postmortem`, `4naly3er`, or `audit-report`/`audit report`.
   - Report-like warnings stay for whatever remains.
3. **Scorer-side contamination preflight (TV5).** Before an evaluation batch, normalise every valid and invalid finding title of the contest and fail the batch if any title occurs in the snapshot. This turns the leak check above into a gate. It runs on the scorer side, which is allowed to see ground truth.
4. **Known issues as an explicit input (Research decision).** Under Code4rena rules, issues already in the bot reports are out of scope, so a Judge could legitimately use them.
   - Default: exclude them from the snapshot.
   - If Research wants a "known-issues-aware" arm, supply a curated known-issues list as a separate input with its own config flag (rule R1), never through the snapshot.

**Owners:** TV5 and Track A for items 1-3; Research for item 4.

### Q2. A final answer that crosses a budget: `completed` or `budget_exhausted`

**Finding.** The pre-call guard stops when the remaining token budget is below `maxOutputTokens`, but it does not estimate the final call's *prompt* tokens. A final answer can therefore overrun the token budget by up to one full prompt. The cost ceiling has no equivalent guard.

Prior art supports `completed`: OpenCode's step limit forces a final text answer and treats it as completion.

**Proposal.**

- **Keep `completed`** with the output and `observedLimits`. A budget is a safety stop, not part of the task's success criteria, and discarding a paid answer distorts RQ1 precision and recall.
- **Tighten the guards** so overruns stay small and comparable across arms. Before each provider attempt, require:
  - `remainingTokens ≥ estimatedPromptTokens + maxOutputTokens`, using TV2's `o200k_base` estimate once available and chars/4 until then;
  - `remainingCost ≥ estimatedCost(prompt, maxOutputTokens)`, using the pricing table in `@harness/llm`.
- **TV5 reporting rule:**
  - report actual spend, including any overrun;
  - report the number of runs with a non-empty `observedLimits`;
  - add a sensitivity table that excludes those runs;
  - apply the same budgets and guards to the direct (single-turn) baseline, so RQ1 compares like with like.

**Owners:** Track C for the guards; TV5 for the reporting rule.

### Q6. Content-addressed snapshot IDs and reproducibility

**Finding.**

- Re-ingesting identical content returned the same ID (verification probe).
- The three contests produced three distinct IDs.
- Ingestion took 0.45–1.1 s per contest.
- With a 48-bit ID prefix, the chance of an accidental collision among 10,000 snapshots is about 2 × 10⁻⁷. A collision is never silent; it fails with `SnapshotExistsError`.

**Risks.**

1. The ID describes the content, not its provenance.
2. Changing the deny rules changes the file set and therefore the ID. This is good for reproducibility but must be recorded.
3. Identical content in two contests shares one snapshot. This is harmless deduplication, because runs reference `snapshotId` and experiments reference contests.

**Proposal.**

- Adopt content IDs.
- TV5's frozen corpus manifest maps each contest to: the data-repository commit (`154a79e`), the contest directory, the `includeRoots` profile, the ingestion policy version, `snapshotId` and `treeDigest`.
- Add an `ingestionPolicyVersion` field to the snapshot manifest. It is recorded but kept out of the digest, so it serves as an audit trail without making identical file sets differ.
- A reproducibility check re-ingests every contest from the pinned data commit and asserts the IDs are unchanged.

**Owners:** TV5 and Track A.

### Proposed follow-up change (after confirmation)

A separate change, for example `contamination-guard-and-budget-estimates`, would implement:

- the code-only profile requirement and the wider hard-deny list (Q1 items 1-2);
- the scorer-side contamination preflight (Q1 item 3);
- prompt- and cost-aware pre-call guards (Q2);
- `ingestionPolicyVersion` in the manifest (Q6).

## Open Questions

Q1, Q2 and Q6 have the proposals above and wait for TV5/Research confirmation (task 5.4). Q1 item 4, whether a Judge arm may see known issues, is a research-design decision.
