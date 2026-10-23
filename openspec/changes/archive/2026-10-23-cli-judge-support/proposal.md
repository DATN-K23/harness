# Proposal: CLI Judge Run and Verdict Inspection Support

## Why

Currently, the CLI only supports single-turn baseline runs (`cli:run --prompt`) or generic multi-turn prompt exploration (`cli:run --prompt --snapshot`), and `cli:view` only formats multi-turn summaries without rendering Judge verdicts. Developers and researchers require a direct CLI mechanism to submit and execute a candidate finding against an immutable source snapshot, as well as inspect structured `JudgeVerdict` outcomes (validity, verification status, confidence, reasoning, evidence citations) from historical runs.

## What Changes

- Extend `cli:run` with a `--finding <path>` option (requiring `--snapshot <id>`) to execute or submit candidate findings to the Judge pipeline.
- Support `--mock` for Judge runs using deterministic scripted doubles to allow offline CLI verification.
- Enhance `cli:view` to detect Judge runs (runs with `findingId` or `run.completed` with a verdict) and render structured `Judge Verdict & Cites Evidence` blocks (and JSON equivalents).

## Capabilities

### Modified Capabilities
- `cli-run-entrypoint`: Add `--finding` argument support to `cli:run` and extend `cli:view` to format structured Judge verdicts and cited source evidence spans.

## Impact

- `@harness/cli`: Update `parseCliArgs`, `executeRunCommand`, and `executeViewCommand`.
- Documentation & CLI Help message updated to include `--finding`.
