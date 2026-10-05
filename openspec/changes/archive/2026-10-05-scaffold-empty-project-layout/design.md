## Context

See [proposal.md](proposal.md) for motivation. The current repository has `blueprint/`, `docs/`, and `openspec/`, but no `packages/`, `infra/`, or `sdks/` project tree. The accepted ADR-008 and `blueprint/architecture/module-layout.md` name a TypeScript/Bun package layout; some older OpenSpec text still describes Python. This change is intentionally limited to names on disk, so it does not depend on provider or baseline readiness decisions.

## Goals / Non-Goals

**Goals:**

- Make the approved top-level package names discoverable and durable in Git.
- Keep each new directory free of implementation and product behavior.

**Non-Goals:**

- Choose internal `src/` layouts, package import boundaries, build scripts, or runtime entrypoints.
- Implement the Judge MVP, Audit mode, data collection, scoring, or any research/security control.
- Reconcile all older OpenSpec architecture prose in this change.

## Decisions

1. **Use exactly the ten core package names from the current blueprint**, under `packages/`, plus `infra/` and `sdks/`. This follows ADR-008's accepted layout. An alternative is to scaffold the older Python capability tree; that would contradict the newer accepted ADR and create directories the current blueprint does not name.
2. **Track empty directories with zero-byte `.gitkeep` markers.** Git cannot version directories alone. The alternative is to create manifests or README files in each package, but those would imply decisions or content beyond this request. The marker carries no executable or configuration semantics.
3. **Do not create nested module folders yet.** The package map establishes the only physical boundary needed now. Internal ownership remains as documented in the blueprint and will be enforced when code is added. Existing trust boundaries remain obligations, not properties established by these folders: agent-visible `CandidateFinding` and `SourceSnapshot` data must remain separated from scorer-only `GroundTruthLabel` data in future implementation.

## Risks / Trade-offs

- [Empty folders may be mistaken for completed packages] → Use only `.gitkeep`; completion evidence for the MVP remains separate.
- [Older OpenSpec Python wording may confuse later implementers] → Treat ADR-008 and the current blueprint as the source for this directory-only change; reconcile stale specs before implementing behavior that depends on them.
- [No runtime controls exist yet] → Do not claim ground-truth isolation, reproducibility, or valid experiment results from this scaffold.

## Migration Plan

Create the directories and markers in one change, then inspect the tracked path list. Rollback is deletion of only these new marker files and their now-empty directories. Existing documentation and data are untouched.
