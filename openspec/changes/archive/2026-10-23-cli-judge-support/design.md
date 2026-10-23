# Design: CLI Judge Execution and Verdict Inspection

## Context

See `proposal.md`. The harness currently has full support for `JudgeRunner` in `@harness/core` and `judge-api` in `@harness/server`, but the CLI in `@harness/cli` does not expose an entry point to run findings directly or render verdict artifacts in `view`.

## Goals / Non-Goals

**Goals:**
- Allow running candidate findings directly from the CLI via `bun run cli:run --finding <file> --snapshot <id> [--mock]`.
- Output clean terminal summaries displaying the structured verdict, confidence, and line citations.
- In `cli:view`, distinguish between standard single/multi-turn prompt runs and Judge runs, rendering normative verdict information.

**Non-Goals:**
- Modifying core `JudgeRunner` behavior or server routes.
- Adding arbitrary finding generation or prompt exploration outside the existing candidate finding schema.

## Decisions

### 1. Integration Mode in `cli:run`
- When `--finding <path>` is provided, the CLI reads the markdown content from the host path, creates a candidate finding structure `{ findingId, reportMarkdown }`, and executes through `JudgeRunner` (in `--mock` mode with in-memory doubles or real gateway/PostgreSQL store).

### 2. View Formatting
- When inspecting a run where `run.findingId` is populated or `events` contain `run.completed` with a `verdict` property, `cli:view` renders:
  - Verdict Header: Validity, Verification Status, Confidence, Reason Code.
  - Summary and Reasoning.
  - Evidence list: Relative file path, startLine - endLine, and content digest.

## Risks / Trade-offs

- **[Risk]** Large finding markdown files or non-existent file paths.
  → **Mitigation:** Preflight file existence check and 100KB size limit matching `JudgeSubmitRequestSchema`.
