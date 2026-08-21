# ADR-004: Use OpenCode as pinned architecture evidence, not an implementation base

- Status: `Accepted`
- Version: `adr-004-v1`
- Decision date: 2026-08-14
- Owner: TV1/TV6
- Collaborators: TV2, TV3, TV4, TV5
- Governing requirements: ORCH-05–ORCH-08, PROV-01–PROV-07, TOOL-01–TOOL-05, DATA-05, API-05–API-09
- Reviewed repository: local `/home/zinn/zinn/DATN/opencode` for evidence only
- Reviewed snapshot: `14f0bf64a19493110b51f5fdeb9c1c1bba5dd3f5`
- Snapshot date/subject: `2026-07-31T08:31:55Z`, `chore: generate`
- License observed: MIT, copyright 2025 opencode
- Source-reuse authorization: none
- Affected work packages: WP-01–WP-07

## Decision

Harness independently implements its accepted contracts and architecture. OpenCode is a pinned comparative reference, not a fork, template, dependency, generated-code input or synchronization source. Architectural ideas may be adopted or adapted only through the destination contracts below; source copying is not authorized by this ADR.

## Snapshot integrity and inventory

Read-only checks on 2026-08-14 produced:

- `git rev-parse HEAD` = `14f0bf64a19493110b51f5fdeb9c1c1bba5dd3f5`.
- `git status --short` returned empty, so the inspected worktree matched the pinned commit.
- The snapshot contains 40 `package.json` files and Bun lockfiles including root `bun.lock`; it is a product-scale monorepo rather than a small Judge module.
- The snapshot has no root `.gitmodules` entry in the tree inventory used for this review.
- Harness currently contains no application `package.json`, Python package manifest, dependency lockfile, Git submodule or import/package reference to OpenCode. Blueprint Markdown references are provenance, not runtime dependencies.

## Provenance matrix

| Snapshot-relative evidence | Observed pattern | Disposition | Judge rationale | Destination blueprint artifact | Forbidden carry-over | Future validation |
|---|---|---|---|---|---|---|
| `packages/opencode/src/session/llm.ts`; `session/llm/request.ts`; `session/llm/native-runtime.ts` | Model invocation is an explicit boundary capable of representing one provider turn. | Adopt idea | One invocation/attempt must remain observable for cost, retry and fairness accounting. | `architecture/agent-runtime-boundaries.md`; `contracts/provider-contract.md` | SDK-owned continuation, hidden retry, hosted tools, provider thread authority | Provider conformance case proves one observable attempt and explicit committed history. |
| `packages/opencode/src/session/processor.ts`; `session/prompt.ts` | A higher-level session processor owns continuation around model/tool events. | Adapt | Harness needs the ownership concept but reconstructs from PostgreSQL and fixes Judge-specific stop/verdict rules. | `architecture/agent-runtime-boundaries.md`; `architecture/end-to-end-sequences.md` | Process-local lifecycle authority, broad coding-agent behavior, implicit loops | Restart/redelivery sequences and import-boundary review. |
| `packages/opencode/src/tool/tool.ts`; `tool/registry.ts` | Tools have explicit definitions and registry dispatch. | Adapt | Judge requires an immutable per-run, read-only source registry and exactly one local settlement. | `contracts/tool-contracts.md`; `security/workspace-policy.md` | Dynamic plugin/MCP discovery, approval-widened authority, host paths | Registry inventory and adversarial structural-denial cases. |
| `packages/opencode/src/tool/shell.ts`; `tool/write.ts`; `tool/edit.ts`; `tool/webfetch.ts`; `tool/websearch.ts` | General coding agent exposes mutation, execution and network authority. | Reject | These capabilities can escape source custody and contaminate Judge evidence. | `security/adversarial-acceptance-catalog.md`; `security/threat-model.md` | Shell, write/delete/rename, process, network, arbitrary URL | Effective Judge registry contains no executable route for excluded capabilities. |
| `packages/opencode/src/session/message-v2.ts`; `server/event.ts` | Versioned message/event concepts support inspectable timelines. | Adapt | Harness needs canonical append-only events, but PostgreSQL and finite cursor polling are authoritative. | `contracts/trajectory-events.schema.json`; `persistence/consistency-and-idempotency.md` | V1/V2 compatibility baggage, uncommitted UI events as truth | Event schema/order, cursor and terminal-immutability validation. |
| `packages/opencode/src/storage/storage.ts`; `storage/schema.ts`; `cli/cmd/db.ts` | Local storage/database facilities serve interactive sessions. | Reject as authority | Judge runs and paid-attempt ambiguity must recover across processes from PostgreSQL claims/outbox records. | `persistence/erd.md`; `persistence/consistency-and-idempotency.md` | SQLite/process-local queue/session ownership | Daemon/worker restart and duplicate-delivery acceptance evidence. |
| `packages/opencode/src/provider/provider.ts`; provider transforms | Broad multi-provider normalization exists. | Adapt | Harness keeps a smaller project-owned `model_gateway.public` contract and native-fidelity matrix. | `contracts/provider-contract.md`; `providers/provider-profile.schema.json` | OpenCode package dependency, floating capability emulation, hidden normalization | One real plus two deterministic profiles pass the same contract cases. |
| `package.json`; `bun.lock`; `packages/app/package.json` | Bun/Effect/SolidJS-oriented product monorepo and release surface. | Reject | Team selected Python runtime, React/Vite renderer and capability-first modular monolith. | ADR-001; ADR-005; ADR-006 | Bun workspace, Effect/Solid coupling, product-scale package topology | Manifest/dependency inventory and physical-layout review. |
| `LICENSE` | MIT permits reuse subject to notice conditions. | Record only | License provenance does not itself justify or authorize copying. | This ADR; `delivery/scope-audit.md` | Treating MIT as blanket architectural/source adoption approval | Any later source/package reuse identifies exact material and passes license/security/dependency review. |

## No-copy and no-sync rule

Under this ADR the Harness repository MUST NOT:

- fork OpenCode or add it as a submodule, subtree, workspace or package dependency;
- vendor, generate from, or copy OpenCode source, tests, schemas, prompts or assets;
- refer to the local review path as a build/runtime input;
- track a floating branch, automatically synchronize upstream, or let upstream changes replace an accepted Harness boundary.

Learning a pattern and implementing it independently against Harness-owned requirements is allowed. Any later proposal to reuse source or packages must identify exact files/packages, preserve required notices, assess transitive dependencies and security, and supersede the no-copy decision explicitly.

## Newer-snapshot and supersession rule

A newer OpenCode snapshot creates a new ADR-004 version containing the new immutable commit, provenance delta and destination impact. The current Harness architecture remains authoritative until that review is accepted. Upstream change alone is not evidence to supersede ADR-001, ADR-002, ADR-005 or ADR-006.

## Acceptance evidence

- Snapshot identity and clean status recorded above.
- Package/lock/submodule inventory recorded above.
- Every considered pattern has a destination and forbidden carry-over.
- Harness dependency/import inventory returned no OpenCode reference outside planning/blueprint provenance.
- Result: `PASS — reference-only review; zero source/dependency carry-over observed`.
