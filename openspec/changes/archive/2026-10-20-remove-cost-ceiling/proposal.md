# Proposal

## Why

Harness currently exposes a per-run maximum-cost setting, but that ceiling cannot reliably protect users when a provider/model has no known price. The user wants this feature removed rather than adding special behavior for unpriced models; actual cost reporting, when available, remains useful for the research objective of measuring cost per run.

## What Changes

- Remove the per-run cost ceiling from runner limits, CLI flags, environment configuration, defaults, and stop-condition enforcement.
- Remove cost-ceiling-specific warnings and telemetry, including the `costBudgetEnforced` distinction; do not replace them with special unpriced-model handling.
- Preserve provider-reported or price-estimated cost accounting and its existing unknown/unpriced representation for run results and research reporting.
- Keep token, step, tool-call, and wall-clock limits unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multi-turn-runner`: Remove cost ceilings as an accepted/enforced execution limit while retaining other run limits and cost accounting.
- `runtime-configuration`: Stop accepting/configuring a run cost ceiling and stop recording it as an effective run limit.

## Impact

- Affected areas include CLI argument parsing and environment configuration, run-limit/context protocol contracts, runner stop and preflight logic, run-start events/config snapshots, views/documentation, and associated tests/fixtures.
- Removing `--max-cost-usd` and `HARNESS_MAX_COST_USD` is a CLI/config compatibility change; callers using either must remove it. No replacement spend cap is proposed.
- Cost data remains recorded where supplied or calculable; this change removes only the ceiling and unpriced-specific ceiling behavior.
