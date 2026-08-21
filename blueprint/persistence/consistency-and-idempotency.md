# PostgreSQL Consistency, Work Delivery, and Recovery

Normative: yes  
Version: `persistence-consistency-v2`  
Owner: TV6; collaborators: TV1, TV4, TV5  
Requirements: API-02, API-03, DATA-01–DATA-04

## Authority

PostgreSQL is the sole MVP authority for source-snapshot metadata, run/config/lifecycle, work items, outbox records, claims/leases, ordered events, attempts, tool calls, verdict/evidence, experiment cells and scorer-controlled records. Desktop cache, daemon/worker memory, filesystem rendezvous metadata and process exit status are projections/signals only.

SQLite, Redis and an in-memory queue/state store are not fallback authorities. They may not be silently introduced for packaging, polling, caching or scheduling. Object/content storage may hold immutable sanitized/snapshot bytes only when PostgreSQL retains authoritative identity/digest/ownership and the storage contract is explicitly configured.

## Transaction boundaries

1. **Register source:** after canonical import, insert immutable snapshot/inventory/digest metadata; original path is never persisted.
2. **Accept run:** resolve snapshot and profiles; insert candidate, run, immutable config and idempotency binding atomically.
3. **Publish work:** insert `work_item` and `outbox_record` in the same PostgreSQL transaction as `accepted -> queued`. An outbox publisher may repeat delivery; the database record is authority.
4. **Claim:** worker atomically acquires an eligible work item with claim token/version, owner and finite lease; stale owners cannot append or transition.
5. **Append:** allocate monotonic `(run_id, sequence)` and persist event plus associated step/attempt/tool fact atomically under active claim/version.
6. **Terminal:** compare expected run state/version/claim, persist verdict/evidence or failure aggregate, usage/cost, terminal event, final state and completed work outcome atomically.
7. **Score:** scorer identity joins only an immutable terminal prediction with scorer-only label after terminal state, then writes isolated scoring detail and approved evaluation output without modifying run facts.

## Submission idempotency

The protected local API requires an opaque idempotency key and stores its SHA-256 digest. Canonical request digest covers candidate, source snapshot and every configuration/profile/flag/budget reference. Equal key/digest returns the existing resource; equal key/different digest returns `idempotency_conflict`. Concurrent insert is resolved by a unique constraint and reload, never by duplicate enqueue.

Source registration and lifecycle commands use the same key/digest rule. A repeated registration may return the same snapshot only if canonical imported bytes and policy version match; it does not persist or compare raw host path.

## Work item, outbox, claim, and lease

`work_item` is a durable finite state record (`pending|claimed|completed|failed|cancelled`) with monotonic version. `outbox_record` represents delivery intent and publisher progress, not the run state. Queue messages contain only stable work/run IDs and delivery IDs.

A claim operation checks work state/version, run state/version, cancellation and `lease_expires_at`, then writes a unique claim token and increments claim/work versions. Heartbeat extends lease with compare-and-set. Expiry makes the item eligible for a new claim under versioned recovery policy, but does not prove an external provider attempt failed.

Every append/transition supplies run state/version and active claim token/version. A zero-row update means stale, expired, cancelled or terminal; the caller reloads. Tokens are never trusted from queue delivery alone.

## Ordered events and finite cursors

`(run_id, sequence)` is unique, begins at one and is never reused. The API returns finite bounded pages ordered by sequence. Cursor encodes/signs/binds run ID, last committed sequence, page policy and cursor version; it contains no DB offset, credential or content. Cross-run, malformed, expired-policy or gap-producing cursors fail safely. `next_cursor: null` means no later committed event at query time, not run terminality.

Desktop reconnect reloads runtime identity/compatibility, run state and events after its last committed sequence; it de-duplicates `(run_id, sequence)`. Desktop timestamps/cache never repair event order and never become lifecycle authority.

## Redelivery and ambiguous provider attempts

Duplicate delivery reloads PostgreSQL and cannot duplicate accepted/terminal transitions. A paid provider call cannot be exactly-once across a crash between external completion and local commit. The claim records `attempt_outcome_unknown`; primary one-attempt policy does not silently repeat it. Recovery either proves a committed response, terminates under frozen ambiguity policy, or schedules only under a separately accepted retry experiment identity.

## Cancellation and lifecycle

Cancellation request is idempotently durable. Accepted/queued work can cancel before claim; running work observes it at provider/tool boundaries. A terminal CAS wins permanently. Window close/disconnect never creates a cancel request.

Explicit runtime shutdown/update first records lifecycle operation and policy. `reject_if_active` conflicts when work is active; `quiesce_then_stop` prevents new claims and waits/terminates only under documented safe boundaries. Runtime update does not erase jobs/claims/events and compatibility migration/rollback is explicit.

## Desktop-independent recovery

Daemon, worker, evaluator and scorer restart from PostgreSQL state without a desktop process. They recover outbox publication, eligible leases, next event sequence, remaining budgets and terminal immutability. Renderer cache may be deleted at any time without losing accepted work. Process memory is never the only copy of a state transition, queue intent, provider attempt, tool result, cancellation or score acceptance.

## Reproduction snapshot

Before queueing, immutable configuration or content-addressed references retain canonical candidate/source digests; runtime/build/dependency lock; exact prompts/tool/schema digests; accepted provider/model/capability/cutoff/pricing profile; experiment/manifest/split/source-family; sampling; logical-token estimator/budgets; wall-clock; retry flag/attempt limits; all result-affecting flags and security/transformation versions. Every provider attempt records model/prompt/profile/flags, native/logical token categories, latency, cost and tool-call correlations.

Redaction/classification occurs before relational/blob/event/log/API/export persistence. Raw host paths, credentials, labels and prohibited originals are neither stored nor hashed into run-visible records.

