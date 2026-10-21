# Task 3 report — bounded ingestion and snapshot mapping

## Outcome

Implemented `SnapshotIngestion` as a narrow, deterministic adapter consuming only `CandidateFinding` and `SourceSnapshotPort`. It recognizes the explicit report labels `Target`, `Root cause`, `Attack scenario`, `Impact`, and `State`, optionally associates one fenced Solidity/Foundry code block as submitted PoC, and maps exact contract/function identifiers to source text read from the requested snapshot. Report input is limited to 64,000 UTF-8 bytes by default; source mapping is limited to 120 lines per source file. Absolute paths are never accepted from reports or opened directly.

The adapter returns `incomplete` with reason `bce_unavailable` after successful target mapping. The mapped source slice is retrieval context only, not BCE. Exact project `solc` selection is unresolved and no compiler/AST analysis is implemented. No callers may infer a blocked path or negative proof from absent edges. Unsupported formats and unmapped targets remain explicit incomplete outcomes. `run-stages.ts` terminates all such outcomes as `UNVERIFIED/UNRESOLVED`.

`IngestionResult` gained additive `incomplete` results with optional claim/PoC/slices, and `narrative_only` gained optional BCE status for compatibility. No compiler, parser, external dependency, Docker, or runtime execution was added. Solidity fixture contains only sanitized source, no labels or scoring data.

## TDD and verification

- Added adapter tests for narrative reports, attached PoC, unsupported and malformed reports, oversized input, target-not-found, denied paths, prohibited metadata keys, and bounded source reads.
- Initial test run before the adapter existed failed because the module could not be resolved (expected missing-feature red).
- Focused tests plus runner/judge/protocol tests: `bun test packages/core/test/ingestion packages/core/test/runner packages/core/test/judge packages/protocol/test` — **605 pass, 0 fail**.
- `bun turbo typecheck` — **6 packages successful**.
- `git diff --check` — passed.
- Docker, Foundry, and Solidity compiler were not run or installed.

## Plan gaps / concerns

- The brief requested valid structured extraction, BCE caller/callee/state/modifier evidence and syntax/AST accuracy. Those cannot honestly be delivered without selecting and verifying the exact compiler toolchain. This report format is intentionally strict and is not a general natural-language extractor; unsupported report forms remain incomplete. `bce_unavailable` is fail-closed and prevents this Task 3 adapter from advancing into static/model adjudication as if source retrieval were BCE.
- Current regex identifier mapping is a bounded retrieval heuristic, not Solidity parsing; same-named declarations or unusual syntax can map ambiguously. This adapter must not be treated as sound analysis. Replace/augment it only after exact offline compiler resolution is approved, and preserve incomplete semantics for errors and missing graph edges.
- Candidate report narrative is untrusted free text. Prohibited metadata key checks reject explicit metadata-shaped occurrences; they are not a natural-language ground-truth detector. API-level schema protections remain required.
- PoC code is merely extracted and associated with the candidate claim here; it is not sanitized/executed by this adapter. Task 2's runtime remains BLOCKED.
- `.opencode_reference` remains absent; no OpenCode modules were reused.

## Commit

Pending.

## Fix round 1 — review findings

- Limited JSON parsing to explicitly fenced `json` blocks and strips all fenced blocks before parsing report prose. Solidity/Foundry PoC contents are separately extracted before claim parsing; braces and metadata-like text inside code no longer reach JSON/prose checks.
- Source matching removes line/block comments and requires the named function to occur within the body of the named contract declaration. This is still a retrieval heuristic, not AST analysis; unsupported/nested syntax remains incomplete by default.
- Added regressions for realistic brace-containing Solidity PoC, code-fence metadata boundary, contract/function names split across contracts, and comment-only declarations. Tests first failed on all four cases, then passed after the adapter changes.
- BCE remains explicitly unavailable/incomplete because the compiler selection is still unpinned. No Docker or compiler was used.
- Verification: `bun test packages/core/test/ingestion packages/core/test/runner packages/core/test/judge packages/protocol/test` — **608 pass, 0 fail**; `bun turbo typecheck` — **6 packages successful**; `git diff --check` — passed.
- Fix commit: `aab7a53` (`fix(core): handle fenced PoC reports safely`).

## Fix round 2 — string-aware comment stripping

- Replaced regex comment removal with a small conservative scanner that preserves single/double-quoted Solidity strings, handles escapes, and strips actual line/block comments. Unterminated quoted strings or block comments cause target mapping to stay incomplete.
- Added regression with a same-line URL string (`https://...`) before the target function. It failed before the fix because the `//` truncated the declaration; it passes afterward.
- Verification: `bun test packages/core/test/ingestion/snapshot-ingestion.test.ts` — **12 pass, 0 fail**; `bun run --cwd packages/core typecheck` — passed; `git diff --check` — passed.
- Task 3 still does **not** satisfy its requested BCE caller/callee/state/modifier evidence: exact `solc` selection remains unresolved, so analysis is explicitly unavailable/incomplete. No compiler or Docker was run; no BCE claim is made.
- Fix commit: `0a93574` (`fix(core): preserve Solidity strings when stripping comments`).
