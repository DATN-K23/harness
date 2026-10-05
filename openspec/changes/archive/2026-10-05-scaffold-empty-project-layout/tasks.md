## 1. Empty repository layout

- [x] 1.1 [Owner: TV6; gate: before first application implementation] Create `packages/{protocol,schema,core,llm,server,cli,client,ui,app,desktop}`, `infra`, and `sdks`, each with only a zero-byte `.gitkeep`. Evidence: a sorted file listing contains exactly these 12 new marker paths and no source or config files.

## 2. Scope verification

- [x] 2.1 [Owner: TV1 with TV6; gate: layout review] Compare the new directory names against ADR-008 and `blueprint/architecture/module-layout.md`, and inspect the Git diff to verify no implementation, dependency, API, dataset, or research-control files were added. Evidence: reproducible path listing and clean scoped diff review.
- [x] 2.2 [Owner: TV6; gate: project Definition of Done review] Confirm another team member can check out and list the tracked directories; record that evidence and update `docs/timeline.csv` status only if the relevant cycle explicitly tracks this scaffold, without claiming the Judge MVP is complete. Evidence: checkout/listing command and the reviewed timeline entry or a recorded finding that no entry applies.

### Verification evidence

- `find packages infra sdks -type f -printf '%p %s bytes\n' | sort` listed exactly 12 zero-byte `.gitkeep` files; a path-set assertion found no additional files in these directories.
- A temporary Git index containing `HEAD` plus these 12 markers produced tree `616b47e83e503e9953c4ac2abca91e617c254a0c`. `git archive <tree> packages infra sdks | tar -tf - | sort` listed all 12 marker files and their containing directories, demonstrating the layout will survive a checkout once committed. The working index and HEAD were not changed.
- Reviewed `docs/timeline.csv`: C01 tracks architecture agreement, C02 tracks the application/server skeleton, and neither explicitly tracks this directory-only scaffold. No timeline status was changed; this evidence does not imply either cycle or the Judge MVP is complete.
