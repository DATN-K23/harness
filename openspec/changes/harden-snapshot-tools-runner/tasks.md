Owners follow `docs/sprints/sprint-03.md`: A = repository/snapshot, B = source tools, C = runner/history, D = gateway/CLI. Every gate is "Sprint 3, before Track D integration" unless stated otherwise.

Testing is light: one focused test per spec scenario. Everything in this change is a safety boundary or a bug fix, so it adds no optional result-affecting behavior and therefore no config flags. The design's "Resolved Questions" table (Q1-Q8) is the reference for each decision.

## 1. Track A: snapshot identity and storage

- [x] 1.1 [Owner: A] Add `resolveSnapshotDir(storageDir, id)` and `InvalidSnapshotIdError` in `packages/core/src/source/`.
  - ID pattern: `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`; the resolved path must be a direct child of the storage root.
  - Use it in `SnapshotManager.ingestRepository`, `loadSnapshotManifest`, `deleteSnapshot` and the `DiskSourceSnapshot` constructor.
  - Evidence: a test for IDs `..`, `a/b` and `` (empty) in which nothing outside a temp storage root is touched and the error has no absolute path.
- [x] 1.2 [Owner: A; Q6] Make ingestion content-addressed and write-once.
  - Compute `treeDigest` in staging, then use `snap_<treeDigest[0..12]>` when no ID is given.
  - If the target exists with the same digest, discard staging and return the existing snapshot. If it exists with a different digest, throw `SnapshotExistsError`. Never `rm` an existing target.
  - Add `cleanupStaging(storageDir)` for `.tmp-*` directories.
  - Evidence: the three spec scenarios (idempotent re-ingest, edited source gets a new ID while the old one still reads the original, explicit-ID conflict), plus an interrupted-staging test.
- [x] 1.3 [Owner: A] Verify integrity in `DiskSourceSnapshot.readLines`: recompute `digestOf(content)`, compare it with the manifest, and on mismatch throw `SnapshotIntegrityError` (relative path only).
  - Evidence: a tamper test where the modified content is not returned; an old random-ID snapshot is still readable.
- [x] 1.4 [Owner: A with C; Q7] Add an optional `findActiveRunsBySnapshot(snapshotId): Promise<string[]>` to `RunStorePort` in `@harness/protocol` (additive).
  - Implement it in `InMemoryRunStore` and in `PostgresRunStore` (`snapshot_id = $1 AND state NOT IN` terminal states; no migration).
  - Export `snapshotInUse(store)` from core.
  - Change `deleteSnapshot(storageDir, id, { isInUse })` so the usage check is required and in-use snapshots are refused with `SnapshotInUseError`.
  - Evidence: an in-use refusal test with `InMemoryRunStore`; the Postgres query is covered by the existing DB test suite, which skips gracefully without PostgreSQL.

## 2. Track A: ingestion policy

- [x] 2.1 [Owner: A; Q1] Make the deny policy depth-independent and case-insensitive (design D4) and add the optional `includeRoots` allow-list.
  - Add `warnings: [{path, reason: "report_like_name"}]` to the manifest for names containing `finding`, `report`, `judg`, `adjudic`, `ground`, `label` or `score`.
  - Evidence: a nested `.git` / `node_modules` / `contracts/.ENV` exclusion test; the `includeRoots` + report-like warning scenario.
- [x] 2.2 [Owner: A; Q4, Q8] Skip symlinks and junctions using `lstat`, without following them.
  - Bounds: configurable per-file 1 MiB (skip, `too_large`), file count 20,000 and total 200 MiB (fail), binary files (NUL byte in the first 8 KB, skip, `binary`).
  - Add optional `skipped: [{path, reason}]` and `warnings` to `SnapshotManifest`, with validation and serialization, so old manifests stay valid.
  - Evidence: a symlink + 2 MiB file test; a test loading an old manifest that has neither field.
- [x] 2.3 [Owner: A; gate: before archive] Survey about 10 contest repositories from the TV5 corpus and record the results here:
  - the count of symlinks and junctions;
  - the largest `.sol` file size;
  - the count of report-like names.

  Decide whether Q4 needs a follow-up change (copy internal link targets) or Q8 needs a different default limit.

## 3. Track B: tool boundary

- [x] 3.1 [Owner: B] Make `ToolRegistry` always merge the default deny policy (prefixes and filename rules) with any configured prefixes.
  - Expose a read-only `snapshotId` and `limits()`: read lines and bytes; grep timeout, scan bytes, line length and matches; glob matches; list entries.
  - Evidence: a files-map test with `test/ground-truth/label.json` where `read_file` is denied; a `limits()` test.
- [x] 3.2 [Owner: B with A] Remove host paths from every model-visible error.
  - The registry catch-all returns `Tool execution failed (internal error). Retry or use a different path.`
  - Snapshot errors (`InvalidSnapshotIdError`, `SnapshotIntegrityError`, not-found manifest) map to fixed messages naming only the snapshot ID or the relative path.
  - `DiskSourceSnapshot` error texts drop the manifest path.
  - Evidence: a missing-snapshot test asserting no `:\` or leading-`/` absolute path in the content.
- [x] 3.3 [Owner: B] Fix truncation in `read_file`: set `isTruncated` and append the marker whenever the line or byte bound cuts content (default or configured), and set `lineRange` to the lines actually returned.
  - Separate the `glob` and `grep` limits in the registry.
  - In the runner, detect truncation from `isTruncated` only.
  - Evidence: a 3,000-line default test (`lineRange [1,2000]`, marker present); a byte-cut test.
- [x] 3.4 [Owner: B] Move the `grep` scan into a `node:worker_threads` worker.
  - Bounds: hard timeout (provisional default 2,000 ms, configurable), 50 MiB scan cap, 500 characters per matched line.
  - On timeout, terminate the worker and return the model-actionable error; mark the other bounds as truncation.
  - Evidence: a `^(a+)+$` test on a 40-`a` line that returns within timeout + 1 s with the timeout error; the existing grep tests still pass.
- [x] 3.5 [Owner: B with Research; Q3; gate: before archive] Measure `grep` on the 3 Sprint-3 Solidity repositories with the patterns `function\s+\w+`, `transfer\(` and `onlyOwner`.
  - Set the default timeout to max(1,000 ms, 10 × p95) and the scan cap from the largest repository.
  - Record the measurement table here and update the defaults.

## 4. Track C: runner

- [x] 4.1 [Owner: C with B; Q5] Add `packages/core/src/util/sanitize.ts` with two functions (design D8):

  | Function | Tier | Applies to |
  |---|---|---|
  | `sanitizeSystemText` | Full: paths, credentials, ground-truth markers; URLs kept | Prompt, string values of tool arguments (before `tool.requested` is appended in the dispatcher and before history items), tool error messages, initial source information |
  | `sanitizeSourceContent` | Credentials only | Successful snapshot-content tool results |

  Replace the local regexes in `request-assembly.ts`.
  - Evidence: unit tests for `D:\repo\Vault.sol`, `\\host\share\x`, `/home/u/x`, an `sk-` key and a `GroundTruthLabel:` line, plus a GitHub permalink that survives; the spec scenarios "Snapshot content keeps its path-like comments", "Credential in snapshot content is redacted" and "Windows path in tool arguments never persists".
- [x] 4.2 [Owner: C with B] Bind the runner to its snapshot and check identity on resume.
  - Fail early with `invalid_input` when `registry.snapshotId` differs from `input.snapshotId`.
  - On resume, compare the stored run's `snapshotId` and `prompt` with the input and fail with `invalid_input` on mismatch; stop swallowing `seedRun` errors silently.
  - Enforce `maxPromptLength` (default 100,000) before snapshot access.
  - Evidence: the two binding scenarios plus an oversized-prompt test, with gateway call count 0 in each.
- [x] 4.3 [Owner: C; Q2] Enforce budgets after each response and before each attempt.
  - Re-evaluate stop conditions after usage is added, before approval and dispatch.
  - Before each provider attempt, stop with `total_tokens` when the remaining token budget is smaller than `maxOutputTokens`.
  - A final text answer still completes, with exhausted limits recorded in terminal telemetry.
  - On resume, restore `startedAtMs` from `run.started.occurredAt` and `completedToolCalls` from hydrated `tool_result` items.
  - Evidence: the cost-ceiling-crossed, output-reserve and resumed tool-call-cap scenarios.
- [x] 4.4 [Owner: C with A; Q8, Q3] Report unreadable files and tool limits.
  - The initial source information lists up to 20 `too_large` and `binary` skipped files plus a count, as present but unreadable, and never lists `denied` or `symlink` paths.
  - Add an optional `toolLimits` object to `RunConfigSnapshotSchema` (protocol, additive). The runner records `registry.limits()` there in `run.started`.
  - Evidence: the two spec scenarios; a protocol test that an old `run.started` payload without `toolLimits` still parses.
- [x] 4.5 [Owner: C] Make persistence crash-consistent.
  - Inside `onResult`, persist `context.item_added` (request, then result) before `tool.completed`/`tool.failed`, with the result item ID.
  - Write `recordModelAttempt` before `provider.attempted`.
  - A non-`hydrated` hydration result ends the run with `failed/persistence_failure` and no model call.
  - Key `run-queries` reconstruction by `${stepIndex}:${callId}`.
  - Evidence: a crash-after-result resume test; a corrupt-history test; a reused-call-ID summary test.
- [x] 4.6 [Owner: C with D] Map provider error categories to terminal reasons:

  | Category | Terminal reason |
  |---|---|
  | `rate_limit`, `transport` | `provider_transient_primary` |
  | `authentication`, `invalid_request` | `provider_permanent` |

  Also wrap `MultiTurnRunner.execute` so it never rejects; an unexpected error attempts `failed/persistence_failure`.
  - Evidence: a rate-limit classification test; a store-whose-`claim`-throws test that resolves.

## 5. Cross-cutting and verification

- [x] 5.1 [Owner: D] Fix the `@harness/cli` typecheck by narrowing `process` to a local type with an optional `loadEnvFile` in `packages/cli/src/config.ts`.
  - Evidence: `bun turbo typecheck` 6/6 successful.
- [x] 5.2 [Owner: C with A and B] Add `packages/core/test/runner/disk-chain-e2e.test.ts`, which runs in-process with no network or database:
  1. Ingest a temp repository and build a `DiskSourceSnapshot` and a bound `ToolRegistry`.
  2. Run `MultiTurnRunner` with a scripted gateway that calls `read_file`, then answers, against `InMemoryRunStore`.
  3. Assert the ordered history, the bound snapshot, that source content reaches the model unchanged, and that no absolute host path appears in any event or request.
  - Evidence: the test passes.
- [x] 5.3 [Owner: C; gate: before archive] Run `bun turbo typecheck`, `bun turbo test`, `bun run demo` and `bun run --cwd packages/core stress`, and record the outputs here.
  - Re-run the review's reproduction probes: nested `.git`, `..` ID, `read_file` default truncation, host-path error, `grep` ReDoS. Record that each now behaves as specified.
- [ ] 5.4 [Owner: A, B, C; gate: before archive] Update the Track B checkboxes in `docs/sprints/sprint-03.md` to reflect reality, and note this change under the Track A/B/C sections. Record the outcomes of tasks 2.3 and 3.5, and get TV5/Research confirmation for Q1, Q2 and Q6.

### Verification evidence (5.3, branch `agent-loop-core`, Bun 1.3.14, 2026-10-18)

- `bun run typecheck`: 6 of 6 packages successful (the `@harness/cli` `loadEnvFile` error is fixed).
- `bun run test` (turbo): protocol 135, core 753, schema 5 (+1 skipped, no PostgreSQL), llm 13, cli 29 (+1 skipped). 0 failures.
- `bun run demo`: confirmed-exploit completed (3 steps, 2460 tokens). missing-poc, cheating-poc and failing-poc completed at 0 tokens.
- `bun run --cwd packages/core stress`: 100/100 crash-free, 0 invariant violations (seed 20261011).
- Review reproduction probes re-run:

  | Probe | Before | Now |
  |---|---|---|
  | Nested `.git` / `node_modules` | Ingested | Recorded once as skipped `denied`, contents not copied |
  | Snapshot ID `..`, `a/b`, `` | Path escaped storage | `InvalidSnapshotIdError` before any fs call; storage parent intact |
  | `read_file` on 3,000 lines | No marker | `isTruncated` true, marker present, `lineRange` `[1,2000]` |
  | Missing snapshot error | Host path in message | `Snapshot "missing" not found.` |
  | `grep` with a 1 ms limit | — | Worker terminated, timeout error after 24 ms |
  | `grep ^(a+)+$` with default limit | — | Returns in about 0.8 s (JavaScriptCore stops the backtracking itself) |
  | Identical re-ingest | — | Returns the same content-addressed ID |

- Still open: 2.3 and 3.5 need the TV5 corpus and the Sprint-3 Solidity repositories, which are not present locally; 5.4 needs TV5/Research confirmation of Q1, Q2 and Q6.

### Survey evidence (2.3) and grep measurement (3.5), 2026-10-18

Data: `D:\DATN\harness-verification-data` @ `154a79e`. The data repository holds 3 contests, not the 10 the task assumed. Each contest's `src/` was ingested with the real `SnapshotManager` at default limits.

| Contest | Source files / MiB | Snapshot files / MiB | Symlinks | Largest `.sol` | `.sol` > 1 MiB | Skipped | Report-like names in `src/` |
|---|---|---|---|---|---|---|---|
| 2025-11-megapot | 182 / 3.97 | 162 / 2.50 | 0 | `lib/forge-std/src/safeconsole.sol` 412 KiB | 0 | 2 denied, 15 binary | `4naly3er-report.md`, `2025-11-megapot_V12.md` (bot report, not flagged), `discord-export/` (1.1 MiB, ingested), `documentation/auditor-intro.md`, Zellic audit PDF (binary) |
| 2026-03-chainlink | 148 / 1.25 | 146 / 0.68 | 0 | `test/poc/C4PoC.t.sol` 38.6 KiB | 0 | 1 denied, 1 binary | `4naly3er-report.md`; `on-report/` test code (false-positive name) |
| 2026-03-intuition | 199 / 3.34 | 196 / 2.26 | 0 | `src/protocol/MultiVault.sol` 75.3 KiB | 0 | 1 denied, 2 binary | `4naly3er-report.md`, two V12 `*findings*.md`, `POST-MORTEM.md` (not flagged), `audits/` PDFs, `.claude/commands/audit-*.md` |

Decisions:

- **Q4 (symlinks):** 0 symlinks in all 3 repositories, so skipping them costs nothing. No follow-up needed.
- **Q8 (file size):** largest `.sol` is 412 KiB, so the 1 MiB limit stays.
- **Q1 (report-like files):** see the design's task 5.4 research. A scorer-side check found that 1 of 15 valid finding titles appears verbatim in a default whole-`src/` snapshot: intuition M-01, through a V12 findings file. With `includeRoots` set to code directories, 0 of 15 titles leak.

grep measurement (3.5), 20 runs per pattern, patterns `function\s+\w+`, `transfer\(`, `onlyOwner`:

| Contest | Regex match only, p95 / max (ms) | Whole `grep` call, p95 / max (ms) | Read all files (ms) | Scanned MiB |
|---|---|---|---|---|
| megapot | 4.5 / 7.2 | 614 / 768 | 650 | 2.50 |
| chainlink | 2.7 / 3.5 | 372 / 1175 | 93 | 0.67 |
| intuition | 7.8 / 8.1 | 305 / 370 | 108 | 2.26 |

Results:

- The default timeout is now `max(1000, 10 × 7.8) = 1000 ms` (`DEFAULT_GREP_TIMEOUT_MS`). The timeout covers the worker phase: spawn (about 20 ms), data transfer and matching.
- The scan cap stays at 50 MiB, which is 20× the largest snapshot.
- A whole `grep` call is dominated by reading and digest-verifying every file on each call (up to about 650 ms). Caching verified file contents per snapshot is a possible later optimisation, not a correctness issue.
- Core tests still pass: 753 pass.
