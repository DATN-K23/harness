# Context and Budget Contract

Normative: yes  
Version: `context-budget-v1`  
Owner: TV2; collaborators: TV1, TV3, TV5  
Requirements: ORCH-03, ORCH-04

## Per-call inputs

- Exact system instructions and digest.
- Canonical `CandidateFinding`; never silently truncated.
- Selected provider/model context limit and evidence source.
- Mandatory maximum output reserve.
- Versioned tool definitions and verdict schema.
- Retained sanitized trajectory/history.
- Sanitized bounded tool results.
- Resolved feature flags and run-level remaining budgets.

## Preflight algorithm

Let:

```text
input_capacity = context_limit_tokens - output_reserve_tokens
mandatory = system + candidate + tool_definitions + response_schema
optional = retained_history + tool_results
```

1. Resolve an immutable context limit from the approved model capability profile. Unknown limit rejects the configuration.
2. Require `output_reserve_tokens > 0` and no greater than the provider/model output limit.
3. Tokenize or estimate each bucket with a recorded estimator/version and conservative uncertainty margin.
4. If `mandatory > input_capacity`, emit `context_budget`; do not truncate mandatory content or call the provider.
5. Build optional history in deterministic event order.
6. Apply only enabled, versioned transformations to tool results in this order: prohibit/secret redaction, untrusted-data delimiters, size/line truncation. Candidate and system instructions are never transformed by this step.
7. Recalculate. If total input still exceeds capacity, emit `context_budget` before provider invocation.
8. Record allocation, input digest, sanitized pre-truncation digests, transformations, estimator, uncertainty, reserve, remaining run budget, and decision.

For secrets/prohibited data, the pre-truncation digest covers the already-redacted representation. Raw sensitive values are neither stored nor hashed into the trajectory.

## Allocation buckets

| Bucket | Priority | Truncation |
|---|---:|---|
| System instructions | 1 | Never |
| Candidate finding | 1 | Never |
| Tool definitions | 1 | Must fit selected registry; reject config rather than silent removal |
| Verdict schema | 1 | Never |
| Recent model/tool history | 2 | No compaction in MVP; oldest-event omission only if explicitly enabled/versioned |
| New tool result | 2 | Deterministic bounded result and optional truncation |
| Output reserve | Absolute | Never consumed by input |

History omission is disabled in the first MVP protocol unless separately specified; a run that cannot fit terminates rather than silently changing semantics.

## Stop conditions

| Condition | Check points | Terminal reason | Result-affecting control |
|---|---|---|---|
| Wall-clock | Before/after provider/tool/backoff | `wall_clock` | Required budget; retry/backoff behavior flagged |
| Cost | Before a call using upper-bound estimate and after usage | `cost_budget` | Required budget |
| Total tokens | Before estimated call and after actual/native usage | `total_tokens` | Required budget |
| Maximum steps | Before starting next model step | `max_steps` | Required budget |
| Context capacity | Every provider call | `context_budget` | Safety/compatibility invariant; transformation behavior flagged |
| No progress | After a completed step | `no_progress` | Optional versioned flag and algorithm |

## Stop precedence

At one safe boundary select: wall-clock → cost → total tokens → max steps → context → no progress. Record all observed conditions and exactly one primary terminal reason. Cancellation, if already committed, remains terminal and is not rewritten as budget exhaustion.

## No-progress v1

The optional detector signs normalized model intent, ordered tool name/arguments digest, and verdict-validation outcome. Repeating the same signature for configured consecutive steps triggers only when `no_progress_detection.enabled` is true. The algorithm version, threshold, signatures, and decision are stored; candidate/source text is not re-stored in the detector event.

## Required telemetry

`context_limit`, limit source/version, estimator/version, uncertainty margin, output reserve, per-bucket counts, pre/post transformation counts, transformation IDs, input digest, remaining token/cost/time/step budgets, stop observations, selected reason, and provider call allowed boolean.
