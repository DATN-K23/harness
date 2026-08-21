# Extension Roadmap

Explanatory: yes  
Version: `extension-roadmap-v3`  
Owner: TV1; collaborators: TV2–TV6

This file identifies stable seams only. It does not add implementation behavior to the Judge MVP.

| Future capability | Existing seam to preserve | Separate change must define | Explicitly absent here |
|---|---|---|---|
| Additional real providers / RQ3 | `ModelProvider`, conformance matrix, native metadata fields | Provider-specific mappings, cutoff/pricing evidence, paid matrix | Additional adapters and results |
| Static analyzer and general-agent baselines / RQ2 | Experiment arm and scorer contracts | Input/output normalization and fairness rules per baseline | Tools, integrations, comparative claims |
| PoC verification / `VerificationRunner` | Terminal verdict/evidence and immutable snapshot public references | New capability plus `entrypoints/verifier`; sandbox image/command allowlist, no/limited network, resource limits, artifact custody, PASS/FAIL/unverified contract and isolation evidence | Any Judge tool/permission, verifier process, test generation or execution |
| Audit mode | Run mode discriminator, source snapshot, orchestration port | Repository-wide planning, finding generation, deduplication, audit metrics | Audit loop or screens |
| Session notes | Context allocation and per-run event extension | Note lifecycle, token policy, ablation flag | Note tool or storage |
| Long-term memory | Memory port placeholder only | Provenance, contest/split reset policy, contamination controls | Cross-run data |
| Compaction | Context transformation envelope | Summarizer contract, fidelity tests, flag and telemetry | Summarization behavior |
| Advanced tools/skills | Versioned immutable tool registry and description digest | Tool-specific security/limits, discovery policy and ablation identity | Plugin discovery/install, call graph, analyzers, skill content |
| Offline replay/demo | Content-addressed events and desktop trace event mapping | Replay bundle, integrity, disconnected startup | Replay runtime or bundled run data |
| Production authentication/multi-tenancy | Protected loopback/OS-IPC local API boundary | Identity, authorization, tenant isolation, audit logs, public threat model | LAN/public exposure claim |
| Alternative desktop native host | Stable generated-client operations, daemon API and renderer/native boundary | Superseding ADR with threat, lifecycle, credential, packaging, signing, update and migration evidence | Electron/Python-hosted fallback or dual-shell implementation |

Each future change must preserve ground-truth isolation, whole-contest plus source-family splits, exact sanitized trajectories, and pre-existing ablation contracts. An extension that affects results requires its flag/telemetry/snapshot/tests in the same change.
