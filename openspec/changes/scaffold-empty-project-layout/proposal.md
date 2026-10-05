## Why

The repository contains the approved Harness blueprint but does not yet have the project directories named in its package map. Creating a versioned empty layout gives the team stable places for later work without claiming that the Judge MVP or any research control has been implemented. This is preparation for RQ1's eventual direct-model versus Harness comparison, not an experimental result.

## What Changes

- Add the empty top-level `packages/`, `infra/`, and `sdks/` directories.
- Under `packages/`, add only the ten directory names in `blueprint/architecture/module-layout.md`: `protocol`, `schema`, `core`, `llm`, `server`, `cli`, `client`, `ui`, `app`, and `desktop`.
- Use inert `.gitkeep` files only where Git needs a tracked marker for an otherwise empty directory.
- Do not add manifests, configuration, source code, tests, database migrations, generated contracts, runtime processes, provider integration, evaluation data, or application behavior.

## Capabilities

### New Capabilities

None. This change adds repository structure only, so `.openspec.yaml` declares `skip_specs: true`.

### Modified Capabilities

None. Existing OpenSpec requirements remain unchanged.

## Impact

- Repository paths only: `packages/`, `infra/`, and `sdks/`.
- No API, data model, dependency, security boundary, or experiment behavior changes.
- Ground-truth isolation, contest-level splits, trace persistence, ablation, verification, and the offline demo remain full-project obligations for later changes; this scaffold provides no evidence that they work.
- ADR-008 and the current module layout supply the names. Older OpenSpec/config text that still mentions Python is documentation drift and does not expand this change into implementation or a spec rewrite.
