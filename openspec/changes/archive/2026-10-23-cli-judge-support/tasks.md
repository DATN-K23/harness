# Tasks: CLI Judge Support

## 1. CLI Argument Parsing and Option Extensions

- [x] 1.1 Add `--finding` option to `parseCliArgs` and update `HelpMessage` in `packages/cli/src/index.ts`
- [x] 1.2 Validate that `--finding` requires `--snapshot` and that the file exists and is readable

## 2. Judge CLI Run Command Execution

- [x] 2.1 Wire `--finding` in `executeRunCommand` / `runCli` to dispatch `JudgeRunner` with appropriate doubles (`--mock`) or real persistence
- [x] 2.2 Format CLI terminal output upon Judge run completion to display `Judge Verdict`, `validity`, and citations

## 3. Judge Verdict Formatting in `cli:view`

- [x] 3.1 Update `packages/cli/src/commands/view.ts` to detect `findingId` or `verdict` in `run.completed`
- [x] 3.2 Render formatted `Judge Verdict & Cites Evidence` block in human-readable and `--json` view modes

## 4. Test Verification

- [x] 4.1 Add unit and integration tests in `packages/cli/test` covering `run --finding` (including error conditions) and `view --id` for Judge runs
- [x] 4.2 Verify monorepo builds and tests pass cleanly via `bun turbo typecheck` and `bun turbo test`
