# Task 2 implementation report

## Outcome

Added `DeconstructedClaim` to the protocol and extended successful ingestion results with optional claim decomposition and optional PoC. Added an explicit `invalid_report` ingestion outcome. Existing `{ kind: "missing_poc" }` behavior remains unchanged for compatibility.

The Judge stages now allow a successful narrative-only report to proceed to semantic verification, bypassing PoC sanitation and sandbox execution. Its typed claim is included in pinned initial context, while absent PoC is omitted. Existing PoC inputs continue through the same sanitizer and sandbox sequence.

## Tests and verification

- Added a protocol contract test for narrative-only claim ingestion.
- Added a Judge runner test confirming a narrative-only case reaches the model and does not invoke the sanitizer.
- Focused tests: `bun test packages/protocol/test/ports.test.ts packages/protocol/test/events.test.ts packages/core/test/runner/judge-runner.test.ts packages/core/test/judge` — 121 pass, 0 fail.
- Typecheck: `bun turbo typecheck` — all 6 tasks passed.

## Scope / limitations

No event schema changes or OpenCode-derived code were needed. Claim fields are typed but ingestion is responsible for deconstructing/validating them. Embedded PoC exactness remains the ingestion adapter's responsibility; this change forwards `pocCode` unchanged to existing sanitation. Malformed deconstruction is represented by `invalid_report` and ends as a non-semantic worker failure, not a false invalid verdict.

The legacy `missing_poc` path intentionally still yields the old `MISSING_POC` fast verdict; narrative-only reports should use `{ kind: "ok", bceSlices, claim }`.

## Review fixes

- Made successful narrative-only ingestion unambiguous: the protocol now has a `narrative_only` variant requiring a typed claim, optionally carrying the embedded PoC verbatim and BCE slices. Successful `ok` remains the PoC-based path.
- Preserved `missing_poc` as a compatibility fast-reject for old adapters; it cannot be confused with a valid narrative report because valid no-PoC ingestion must use `narrative_only` with a required claim.
- Kept `invalid_report` as an inconclusive worker failure and added runner tests for that outcome, for the legacy `missing_poc` behavior, and for narrative-only semantic verification.
- Focused verification after review fixes: protocol/Judge tests — 123 pass, 0 fail; `bun turbo typecheck` — all 6 tasks passed.
