# Desktop Terminal and Non-Terminal State Presentation

Normative: yes  
Version: `desktop-terminal-v3`  
Owner: TV6; collaborators: TV1, TV4  
Requirements: API-03, API-10, VER-03, UI-03–UI-06

## Run-state matrix

| Run state | Verdict panel | Message/action |
|---|---|---|
| `accepted` | hidden | configuration committed; refresh/cancel |
| `queued` | hidden | waiting for worker; refresh/cancel |
| `running` | hidden | committed trace partial; refresh/request cancel |
| `completed` | visible | schema/evidence-valid unverified Judge result |
| `failed` | hidden | normalized terminal reason; inspect committed trace |
| `cancelled` | hidden | cancellation observed at safe boundary |
| `budget_exhausted` | hidden | selected limit and observed evidence |

## Completed

```text
Judge verdict: INVALID · severity NONE · confidence 0.71
⚠ UNVERIFIED — no executable PoC was run
Rationale: …
Evidence 1: contracts/AccessManager.sol · lines 18–27 · sha256:…
Total: 2,560 tokens · 10.0 s · USD 0.02
```

`completed` means verdict schema and evidence validation passed; it never implies verified/PoC-passed.

## Other terminal states

- `failed`: safe normalized reason, last committed step, usage/cost; no partial verdict.
- `cancelled`: request/terminal timestamps, observed safe boundary and preserved trace.
- `budget_exhausted`: primary reason (`wall_clock|cost_budget|total_tokens|max_steps|context_budget|no_progress`), limits/usage and last allowed action; no verdict.

## Connection states are not run states

`runtime_unavailable`, `unauthorized_local` (including unavailable protected credential backend), `incompatible_version`, update-preparation and `reconnecting` never overwrite a run state. The view preserves the last committed projection and resumes after compatible reconnection. Window/Tauri-host closure is neither cancellation nor failure; update conflict/quiesce is an explicit lifecycle state, not a run terminal reason.
