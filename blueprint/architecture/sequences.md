# System Sequences & Lifecycle

Normative: yes  
Version: `sequences-v4`  

## Submission to terminal retrieval (Judge Mode)

```mermaid
sequenceDiagram
  actor U as Operator / Auditor
  participant API as API Server (@harness/server)
  participant APP as Core Engine (@harness/core)
  participant DB as Database (PostgreSQL / @harness/schema)
  participant Q as JobQueue
  participant W as Worker
  U->>API: POST canonical request + Idempotency-Key
  API->>APP: validate and create
  APP->>DB: resolve snapshot/config and atomic accepted record
  APP->>Q: enqueue run_id
  APP->>DB: CAS accepted -> queued
  API-->>U: 202 run_id + status URL
  Q->>W: deliver run_id
  W->>DB: claim and CAS queued -> running
  W->>DB: append events and atomic terminal result
  U->>API: GET run and events(cursor)
  API-->>U: state, safe events, terminal result when completed
```

Invariant: configuration is persisted before enqueue; queue payload contains only stable identifiers; a client disconnect does not stop work.

## Autonomous Audit Mode flow

```mermaid
sequenceDiagram
  actor U as Operator / Auditor
  participant UI as Desktop / Web UI (@harness/app)
  participant API as API Server (@harness/server)
  participant CORE as Core Engine (@harness/core)
  participant LLM as Model Gateway (@harness/llm)
  participant DB as Database (PostgreSQL / @harness/schema)

  U->>UI: Select smart contract repository
  UI->>API: POST /sources/register (ephemeral path)
  API->>CORE: Create immutable source snapshot
  CORE->>DB: Persist SourceSnapshot (inventory, digests)
  API-->>UI: 201 Created (source_snapshot_id)

  U->>UI: POST /audit/runs (source_snapshot_id, config)
  UI->>API: Submit Audit Run request
  API->>DB: Atomically create run (mode=audit, state=queued)
  API-->>UI: 202 Accepted (run_id)

  Note over CORE,LLM: Autonomous Exploration Loop
  loop Multi-turn reasoning & finding collection
    CORE->>LLM: Prompt with contract context & active checklist
    LLM-->>CORE: Tool request (read_file, list_dir, search)
    CORE->>CORE: Execute bounded read tool on SourceSnapshot
    CORE->>DB: Append trajectory events (step, tool_call, token_usage)
    CORE->>LLM: Send tool result
    LLM-->>CORE: Candidate vulnerability discovered
    CORE->>CORE: Validate finding structure & deduplicate
    CORE->>DB: Persist finding.discovered event
  end

  CORE->>CORE: Compile structured AuditReport
  CORE->>DB: Commit findings, AuditReport & CAS running -> completed
  UI->>API: GET /runs/{run_id}/report
  API-->>UI: Return completed AuditReport & verified findings
```

Invariant: Audit Mode operates purely on immutable snapshots through read-only tools; all intermediate reasoning, tool calls, and discovered findings are durably recorded in PostgreSQL.

## Tauri discovery, protected transport, and host exit

```mermaid
sequenceDiagram
  actor U as Operator / Auditor
  participant UI as React UI (@harness/app)
  participant T as Tauri Host (@harness/desktop)
  participant S as Runtime supervisor
  participant API as Local Daemon (@harness/server)
  participant DB as Database (PostgreSQL)
  U->>UI: open desktop
  UI->>T: runtime discover/start-or-attach
  T->>S: platform-scoped discover/start-or-attach
  S-->>T: protected rendezvous/runtime identity
  UI->>T: allowlisted runtime-info operation
  T->>API: derived endpoint + protected credential
  API-->>T: version/contract/capability/health
  T-->>UI: validated generated response
  Note over UI,T: every window/host may close or crash
  Note over S,DB: no implicit stop/cancel, committed work remains authoritative
  U->>UI: reopen desktop
  UI->>T: rediscover + full handshake + cursor resume
```

Invariant: renderer input cannot choose an arbitrary endpoint, credential, executable, process or URL. The Tauri host is protected transport/OS integration only and never owns Judge/Audit continuation or run state.

## Provider and tool iteration

```mermaid
sequenceDiagram
  participant O as Orchestrator (@harness/core)
  participant C as ContextPlanner
  participant P as ModelGateway (@harness/llm)
  participant T as ToolRegistry
  participant W as WorkspacePolicy
  participant E as EventSink (@harness/schema)
  loop until valid verdict, report or stop
    O->>C: preflight exact planned messages + output reserve
    C-->>O: model input or context_budget
    O->>E: context.allocated/transformed
    O->>P: normalized request + accepted profile digest
    P->>P: pre-network gate, official async adapter, one non-streaming attempt
    P-->>O: normalized response/tool intent/usage/error
    O->>E: provider attempt + exact sanitized response
    alt tool request
      O->>T: bounded tool call
      T->>W: authorize canonical relative path
      W-->>T: allowed or safe denial
      T-->>O: bounded transformed result/error
      O->>E: tool/security/transformation events
    else proposed verdict or finding
      O->>O: schema and evidence validation
    end
  end
```

Invariant: explicit history is reconstructed only from committed events. The adapter does not own conversation state, execute tools or accept a verdict; provider and tool errors are data in the trajectory and only the application transition authority commits terminal state.

## Tool failure and recovery

1. Persist `tool.requested` with bounded sanitized arguments.
2. Authorize before I/O; on operational failure, create normalized tool error.
3. Persist `tool.failed`; return a model-actionable bounded error inside untrusted-data delimiters.
4. Re-run context preflight before the next provider attempt.
5. Continue only if budgets and no-progress rules permit. A tool failure alone does not crash the worker.

## Structured repair and completion

1. A proposed verdict or finding is validated independently of the provider.
2. Schema or evidence failure emits validation failed event with safe validation paths.
3. When repair is enabled and attempts remain, the failure is added to the next preflighted context.
4. A valid verdict/finding and evidence are committed atomically with aggregates and `run.completed`.
5. Exhausted repair produces `failed/schema_repair_exhausted`; no partial verdict or unvalidated finding is terminal.

## Cancellation and budget exhaustion

```mermaid
sequenceDiagram
  actor U as Operator / Auditor
  participant API as API Server (@harness/server)
  participant APP as Core Engine (@harness/core)
  participant W as Worker
  participant DB as Database (PostgreSQL)
  U->>API: POST cancel
  API->>APP: idempotent cancel request
  APP->>DB: record request
  API-->>U: current state + requested outcome
  W->>DB: observe at next safe boundary
  alt still running and CAS wins
    W->>DB: terminal cancelled + preserved aggregates/events
  else already terminal
    W->>DB: no state change
  end
```

Budget checks occur before and after each provider/tool boundary. A selected limit blocks any next action and commits `budget_exhausted` with observed-limit telemetry.

## Provider failure paths

| Path | Required sequence |
|---|---|
| Incomplete/unapproved profile | Reject before SDK client construction, credential access or network → commit safe configuration failure. |
| Transient under primary profile | Append the sole attempt/error → no SDK/project retry → commit the mapped terminal failure. |
| Permanent | Append attempt/error → no transient retry → commit `failed/provider_permanent`. |
| Configured retry profile | When explicit retry profile is enabled, append every attempt/backoff and enforce strict budget ceilings. |
| Late result after cancellation | Sanitize and account where possible → never append model-visible continuation or rewrite terminal state. |

## Tool denial

Authorization rejects before content read, returns a safe tool error, and writes a separate `security.blocked` event with rule ID and normalized relative input. The event never stores the resolved prohibited path or content.

## Queue redelivery and worker interruption

```mermaid
sequenceDiagram
  participant Q as JobQueue
  participant W1 as Worker A
  participant W2 as Worker B
  participant DB as Database (PostgreSQL)
  Q->>W1: deliver run_id
  W1->>DB: claim token/version and append sequence N
  W1--xDB: interrupted
  Q->>W2: redeliver run_id
  W2->>DB: acquire new claim or observe active lease policy
  W2->>DB: reload next sequence and run state
  W2->>DB: append N+1, duplicates rejected
  W2->>DB: terminal CAS
```

Provider calls cannot be guaranteed exactly once across process failure. The reproduction record distinguishes attempts with unknown outcome, and idempotency prevents the system from pretending otherwise.

## Run Lifecycle & State Machine

- **Normative**: yes  
- **Version**: `run-lifecycle-v3`  
- **Requirements**: API-03, ORCH-01, ORCH-03

```mermaid
stateDiagram-v2
  [*] --> accepted: atomic create + snapshot
  accepted --> queued: durable enqueue recorded
  accepted --> failed: enqueue/preflight failure
  accepted --> cancelled: cancellation before enqueue
  queued --> running: worker claim CAS
  queued --> cancelled: cancellation before claim
  queued --> failed: unrecoverable queue/preflight failure
  running --> completed: valid verdict/report atomic commit
  running --> failed: permanent/unrecoverable failure
  running --> cancelled: cooperative cancellation at safe boundary
  running --> budget_exhausted: one stop reason wins
  completed --> [*]
  failed --> [*]
  cancelled --> [*]
  budget_exhausted --> [*]
```

## Transition table

| From | To | Authority | Preconditions | Atomic persistence | Duplicate/stale outcome |
|---|---|---|---|---|---|
| none | accepted | Run application | Valid canonical request, source/config resolvable, idempotency available | Run + immutable config + idempotency record | Same key/digest returns original; different digest conflicts |
| accepted | queued | Run application | Durable job reference created | State version CAS + `run.queued` | Existing queued state returned |
| accepted | failed | Run application | Snapshot/enqueue cannot complete safely | Failure event + terminal aggregate | Terminal state unchanged |
| accepted | cancelled | Run application | Cancel requested before durable enqueue | Cancel event + terminal aggregate | Terminal state unchanged |
| queued | running | Worker adapter | Claim token valid; cancellation not committed | Claim + state version CAS + start event | Stale claim rejected |
| queued | cancelled | Run application/worker | Cancel requested before successful start CAS | Cancel request/outcome + terminal aggregate | Claim loses CAS |
| queued | failed | Worker/application | Job is unrecoverable before model call | Failure event + terminal aggregate | Terminal state unchanged |
| running | completed | Run application via worker | Verdict/report schema and evidence valid; cancel absent; budgets available | Verdict/findings/usage + completion event + terminal state in one transaction | Stale worker rejected |
| running | failed | Run application via worker | Permanent error or retries/repair exhausted | Failure reason/usage + terminal event/state | Stale worker rejected |
| running | cancelled | Run application via worker | Cancellation observed at model/tool boundary | Cancel outcome/usage + terminal event/state | Terminal state unchanged |
| running | budget_exhausted | Run application via worker | Stop condition selected | Budget evidence + terminal event/state | Terminal state unchanged |

All other transitions are invalid. Terminal states are immutable.

Before `accepted -> queued` for a real-provider run, the application resolves and validates accepted provider profile versions and digests. Before each model attempt, `model_gateway` repeats the pre-network gate before SDK client construction or credential access. A missing/unapproved/drifted profile is a configuration failure, not a provider attempt. Deterministic profiles bypass real credential/network approval while remaining schema/contract checked.

## Budget exhaustion

When checks observe multiple exhausted limits at one safe boundary, choose by fixed precedence: `wall_clock`, `cost_budget`, `total_tokens`, `max_steps`, `context_budget`, `no_progress`. Record all observed exhausted limits in telemetry but exactly one `terminal_reason`.

No provider or tool action starts after a terminal transition or after the chosen limit is known. In-flight provider calls may not be physically cancelled; their late result is recorded only as a safe orphan-attempt observation and cannot mutate the terminal run.

The default profile permits one model attempt and configures SDK retries to zero. A transient error therefore maps to a terminal failure after the single recorded attempt, preventing silent provider retries from consuming unaccounted budget. Explicit retry-enabled runs require separate profile configuration with bounded retry budgets.

## Version and CAS

Each mutable run row has a monotonically increasing `state_version`. A transition supplies expected state and version. A zero-row update means the caller is stale and must reload; it never retries a terminal write blindly.
