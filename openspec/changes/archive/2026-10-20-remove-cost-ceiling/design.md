# Design

## Context

See proposal.md for motivation. Cost is currently used both as reported usage and as a run limit. CLI/environment configuration resolves a cost ceiling; core stop checks and context preflight enforce it when pricing is known; events distinguish priced enforcement from unpriced runs. The change must separate and preserve cost reporting while removing all control-flow dependence on cost ceilings.

## Goals / Non-Goals

**Goals:**
- Remove the cost ceiling end-to-end from public run configuration, runner contracts, stop decisions, and run-start metadata.
- Preserve actual/estimated cost usage and explicit unknown pricing for research and reporting.
- Preserve all non-cost run limits and existing price configuration used to calculate reported cost.

**Non-Goals:**
- Adding another spend-control mechanism or rejecting unpriced models.
- Removing provider price metadata or cost-per-run reporting.
- Changing token, step, tool-call, timeout, persistence, or retry policies.

## Decisions

- Remove the setting rather than retaining a deprecated no-op. Keeping a no-op flag would suggest protection that no longer exists and would preserve unnecessary configuration surface. CLI callers passing the removed flag should receive the normal unknown-option behavior; environment compatibility should not affect execution.
- Remove cost-ceiling fields and enforcement from core/protocol contracts and run snapshots/events. Retain usage cost fields, pricing status, and pricing-rate configuration because these describe measured usage, not a ceiling.
- Remove unpriced-specific warning/telemetry that only explains disabled ceiling enforcement. Keep ordinary unknown-cost reporting so users and researchers can distinguish unknown from zero cost.
- Update affected specs as modified capabilities (`multi-turn-runner`, `runtime-configuration`) because user-visible run limits and accepted configuration change.

## Risks / Trade-offs

- [Risk] Existing scripts passing `--max-cost-usd` stop working → remove the option explicitly from docs/examples and include a regression asserting it is no longer accepted.
- [Risk] A run can incur more provider cost than expected → document that Harness does not enforce a spend cap; retain token/step/time/tool limits, which are not equivalent to a monetary cap.
- [Risk] Removing shared fields touches broad fixtures and telemetry → search all references and validate protocol, core, CLI, and persistence contracts; preserve schema compatibility for already-persisted historical events if those remain readable.
- [Risk] Historical records contain cost-ceiling telemetry → readers should tolerate legacy fields while new runs omit the setting; do not rewrite existing persisted data.

## Migration Plan

Remove `--max-cost-usd` and `HARNESS_MAX_COST_USD` from the current runtime path and examples. Existing environment files may retain the old variable without affecting runs; remove it from templates/docs. Existing persisted run histories remain unchanged and readable. No database migration or destructive data rewrite is expected; verify this during implementation before changing persistence schemas.

## Open Questions

None.
