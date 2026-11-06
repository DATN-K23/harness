# Repository Guidelines

## Project Overview

Harness is a provider-neutral, local-first AI Agent research platform for smart-contract security auditing. The primary scientific objective is to measure the empirical performance delta ($Y - X$) between a raw direct-model baseline ($X$) and the harness-assisted agent loop ($Y$) across four evaluation pillars: precision, recall, cost per run, and reproducibility/observed variability (RQ1). Later milestones evaluate comparisons with static analyzers and general-purpose agents (RQ2) across at least three commercial LLM providers (RQ3).

### Non-Negotiable Research Controls
- **Ground-Truth Isolation (Rule R2)**: The agent loop, context engine, tools, provider requests, and logs MUST NEVER receive or access `GroundTruthLabel` data, adjudication reports, or scoring metadata. Enforced programmatically at port boundaries (`TrajectoryEventSchema` super-refinement rejects ground-truth and credential keys at any depth).
- **Source Snapshot Immutability**: Code analysis operates strictly on immutable snapshots (`SourceSnapshotPort`). Absolute host paths, directory traversal (`..`), and symlink escapes are rejected before I/O.
- **Contest-Level Splits (Rule R3)**: Evaluation datasets are partitioned strictly by whole contest, never by individual findings, avoiding data contamination across train, validation, and test sets.
- **Config-Driven Experimentation (Rule R1)**: Every optional behavior affecting output MUST be controlled via an explicit configuration flag, recorded in telemetry and immutable run snapshots.

---

## Architecture & Data Flow

Harness implements a **Hexagonal Architecture (Ports and Adapters)**, maintaining strict separation between pure contracts, core orchestration, and external infrastructure.

```
                      +-------------------+
                      |   @harness/cli    |  (Composition Root: run, view)
                      +---------+---------+
                                |
             +------------------+------------------+
             |                                     |
             v                                     v
   +-------------------+                 +-------------------+
   | SingleTurnRunner  |                 |    JudgeRunner    |
   | (Direct Baseline) |                 | (5-Stage Pipeline)|
   +---------+---------+                 +---------+---------+
             |                                     |
             +------------------+------------------+
                                |
                   Core Ports (@harness/protocol)
                 /        |           \           \
                v         v            v           v
    +--------------+ +---------+ +----------+ +-----------+
    | PostgresStore| | Gateway | | Source / | | Context / |
    |  (@harness/  | |(@harness| | Tool     | | Compactor |
    |    schema)   | |  /llm)  | | Registry | |  Engine   |
    +--------------+ +---------+ +----------+ +-----------+
```

### Key Packages
- **`@harness/protocol`**: Pure domain contracts, TypeScript interfaces (ports), Zod envelope schemas, and event definitions. Zero third-party runtime dependencies (no Node built-ins, no database drivers, no SDKs).
- **`@harness/core`**: Domain execution engine containing runners, stage control, retry policies, and canonical capability modules:
  - `runner/`: `SingleTurnRunner` (baseline direct execution) and `JudgeRunner` (multi-stage adjudication orchestrator).
  - `judge/`: `adjudication-step.ts` (two-tier oracle adjudication) and `verdict-synthesizer.ts` (normative JSON verdict validation).
  - `tool/`: Modular tool definitions, parameter JSON schemas, bounded execution handlers (`read_file`, `grep`, `glob`, `list_dir`), and `ToolRegistry`.
  - `source/`: `SourceSnapshot` interface, path authorization algorithms (`checkSnapshotPath`), and `InMemorySnapshot`.
  - `context/`: `ContextEngine` contracts, token estimation (`estimateTokens`), and observation compaction (`ThresholdContextEngine`).
  - `sandbox/`: Isolation contracts for containerized PoC exploit verification (`forge test` in Docker `--network none`) and `ScriptedSandbox`.
  - `audit/`: Autonomous exploration domain models (`AuditReport`, `AuditFinding`) and `AuditRunner` stub.
  - `eval/`: Research evaluation metrics (`calculateMetrics`, `calculateDelta`, RQ1 gate evaluation) and `ContestCorpusManifest` validation.
  - `util/`: Deterministic sorting (`canonicalJson`), SHA-256 hashing (`digestOf`), and sortable time-ordered identifier generator (`createIdGenerator`).
  - `prompts/`: Versioned prompt templates (`judge-system.v1.txt`, `max-steps.v1.txt`) and digest verification.
  - `demo/`: 4-scenario offline demo runner and 100-run reliability stress test harness.
  - `testing/`: In-memory test doubles and parametric contract suites (`runStoreContractTests`).
- **`@harness/schema`**: Persistence adapter for PostgreSQL via Drizzle ORM and `postgres.js`. Implements `RunStorePort` with optimistic locking (CAS), lease expiration, versioned transitions, and recursive secret sanitization across 3 tables: `runs`, `events`, `model_attempts`.
- **`@harness/llm`**: Model provider adapter implementing `ModelGatewayPort` via OpenAI SDK. Enforces zero internal retries (`maxRetries: 0`), AbortSignal timeouts, model pricing registries, and normalized error mapping. Supports custom proxy routers (e.g. 9router / OpenRouter) via `MODEL_BASE_URL`.
- **`@harness/cli`**: Headless CLI composition root providing commands for executing runs (`run`) and inspecting historical trajectories (`view`), wiring real PostgreSQL/OpenAI adapters or falling back to `--mock`. Features automatic upward `.env` resolution.
- **`@harness/server`**: Local runtime server package exporting `SERVER_VERSION = 1` for downstream client/desktop integration.

### Execution & Data Flow
1. **Pre-flight Validation**: Input bounds (prompt length, tokens, timeouts) are verified before initiating any model calls.
2. **Registration & Lease Claim**: Run is initialized in `queued` state via `seedRun`, then claimed by a worker with lease expiration (`claimExpiresAt`) and version increment.
3. **Append-Only Trajectory**: Every action appends an immutable `TrajectoryEvent` (`run.queued`, `run.started`, `provider.attempted`, etc.) with strictly monotonic sequence numbers ($1, 2, \dots, N$) and SHA-256 payload digests.
4. **Provider Invocation**: `ModelGatewayPort.executeAttempt` executes a single attempt with AbortSignal timeout; internal SDK retries are disabled.
5. **Compare-And-Set (CAS) Transitions**: State transitions require matching `expectedState` and `expectedStateVersion`, advancing to `running` then terminal `completed` or `failed`.
6. **Outcome Persistence**: Terminal transitions simultaneously persist model response text, error details, token usage, USD cost, and latency into the `runs` table, while individual provider calls are recorded in `model_attempts`.

---

## Key Directories

```
.
├── packages/
│   ├── protocol/src/      # Core interfaces (ports.ts, events.ts, model-gateway.ts, stop-conditions.ts)
│   ├── core/src/
│   │   ├── runner/        # SingleTurnRunner, JudgeRunner, retry-policy, cancellation
│   │   ├── judge/         # Adjudication tier selection, verdict synthesis, bounded repair
│   │   ├── tool/          # ToolRegistry, dispatcher, handlers (read-file, grep, glob, list-dir)
│   │   ├── source/        # SourceSnapshot contracts, path validation, in-memory snapshot
│   │   ├── context/       # ContextEngine, token estimation, observation compaction
│   │   ├── sandbox/       # Containerized sandbox interfaces, ScriptedSandbox
│   │   ├── audit/         # Audit mode exploration contracts, AuditReport definitions
│   │   ├── eval/          # Evaluation metrics (precision, recall, F1, delta), corpus loader
│   │   ├── util/          # Cryptographic hashing (digestOf), sortable ID generator
│   │   ├── prompts/       # Versioned system prompts and digest verification
│   │   ├── demo/          # Offline demo runner and 100-run stress harness
│   │   └── testing/       # Shared test doubles (InMemoryRunStore, ScriptedModelGateway)
│   ├── schema/src/
│   │   ├── db/            # Drizzle schema (runs, events, model_attempts), client, migrate
│   │   └── store/         # PostgresRunStore (CAS, lease, sequence), secret redaction
│   ├── llm/src/
│   │   ├── gateway/       # RealModelGateway (OpenAI API integration, custom base URL)
│   │   ├── pricing/       # Model token pricing table and cost calculator
│   │   └── errors/        # Provider error classification and secret scrubbing
│   ├── cli/src/           # CLI entry point, argument parsing, config validation, run/view commands
│   └── server/src/        # Server baseline and version exports
├── docs/                  # Architecture specs, research guidelines, sprint tracking, timeline.csv
├── blueprint/             # Long-term architecture specifications, vocabulary, ADRs
└── openspec/              # Spec-Driven Development (SDD) changes and capability specifications
```

---

## Development Commands

All tasks MUST be run using **Bun** and **Turborepo**.

### Building & Typechecking
```bash
# Typecheck all packages across the monorepo
bun turbo typecheck

# Typecheck a specific package
bun run --cwd packages/core typecheck
bun run --cwd packages/protocol typecheck
bun run --cwd packages/schema typecheck
bun run --cwd packages/cli typecheck
bun run --cwd packages/llm typecheck
```

### Testing
```bash
# Run all unit and integration tests across the monorepo
bun turbo test

# Run tests for a specific package
bun run --cwd packages/core test
bun run --cwd packages/cli test
bun run --cwd packages/llm test
bun run --cwd packages/schema test

# Run a specific test file
bun test packages/core/test/runner/single-turn-runner.test.ts
bun test packages/core/test/eval/metrics.test.ts
bun test packages/cli/test/cli-e2e-persistence.test.ts
```

> **Root Test Guard**: Running `bun test` from the root directory is intentionally blocked by `bunfig.toml` (`root = "./do-not-run-tests-from-root"`). Always use `bun turbo test` or pass `--cwd packages/<name>`.

### Running Applications & Demos
```bash
# Execute prompt via CLI (real model gateway + PostgreSQL store)
bun run cli:run -- --prompt "Explain smart contract reentrancy vulnerabilities"

# Execute prompt using in-memory mock doubles (offline testing mode)
bun run cli:run -- --prompt "Explain reentrancy" --mock

# Inspect past run record and chronological trajectory events by Run ID
bun run cli:view -- --id <runId>
bun run cli:view -- --id <runId> --mock

# Apply database migrations
bun run db:migrate

# Run offline Judge demo scenarios (outputs 7-pillar trajectory bundle)
bun run demo

# Run 100-run reliability stress harness
bun run --cwd packages/core stress
```

---

## Code Conventions & Common Patterns

### 1. Formatting & Code Style
- **Indentation**: 2 spaces, no tabs.
- **Semicolons**: Omitted (`"semi": false` in root `package.json`).
- **Line Length**: 120 characters print width.
- **Imports**: Group standard Node modules (`node:*`), third-party packages, and internal workspace packages (`@harness/*`). Always use ESM imports with TypeScript.

### 2. Naming Conventions
- **Files & Directories**: Kebab-case (e.g., `single-turn-runner.ts`, `postgres-run-store.ts`, `real-model-gateway.test.ts`).
- **Interfaces & Types**: PascalCase (e.g., `RunStorePort`, `ModelAttemptRequest`, `TrajectoryEvent`).
- **Enums & Constants**: PascalCase for types; SCREAMING_SNAKE_CASE or camelCase for dictionaries (e.g., `TerminalReasons`, `MODEL_PRICING_TABLE`, `DefaultModelTimeoutMs`).
- **Functions & Methods**: camelCase with verb prefixes (e.g., `executeAttempt`, `loadRun`, `validateSingleTurnInput`, `redactSecrets`).

### 3. Dependency Injection Pattern
Avoid direct static instantiation of side-effecting services. Use dependency injection through typed `deps` options objects:
```typescript
export interface SingleTurnRunnerDeps {
  store: RunStorePort
  gateway: ModelGatewayPort
  clock?: ClockPort
  secrets?: string[]
}

export class SingleTurnRunner {
  constructor(private readonly deps: SingleTurnRunnerDeps) {}
}
```

### 4. Asynchronous Patterns & Concurrency
- Always use `async`/`await`. Avoid unhandled promises and callback chains.
- Concurrency mutations MUST use Compare-And-Set (CAS): check `expectedStateVersion` before updating, incrementing `stateVersion + 1`.
- When dealing with optional store hooks (`seedRun`), always wrap in `await Promise.resolve(...)` to safely support both synchronous test doubles and asynchronous database stores:
  ```typescript
  if ("seedRun" in this.deps.store && typeof this.deps.store.seedRun === "function") {
    await Promise.resolve(this.deps.store.seedRun(runId, "queued", input.prompt))
  }
  ```

### 5. Error Handling & Provider Normalization
- **Gateway Invariant**: `ModelGatewayPort.executeAttempt` **MUST NEVER throw**. Network failures, rate limits, and 4xx/5xx responses are caught, normalized into typed `ModelAttemptError` objects, and returned with `finishReason: "error"`.
- **Error Categories**:
  - `authentication`: Invalid keys (HTTP 401, 403) — permanent, non-retryable.
  - `rate_limit`: Quota exceeded (HTTP 429) — transient, retryable with exponential backoff.
  - `invalid_request`: Context window overflow, malformed prompt (HTTP 400) — permanent.
  - `transport`: Network disconnects, DNS failure, 5xx server errors, timeout — transient.
- **Fail-Fast Configuration**: CLI commands must fail fast with `ConfigValidationError` and exit code 1 when required environment variables are missing, instead of silently falling back to mock runners.

### 6. Secret Redaction & Sanitization
All logs, database records, and trajectory events must sanitize API keys, bearer tokens, private keys, and connection credentials:
```typescript
import { redactSecrets } from "./redaction"

const sanitized = redactSecrets(rawText, [apiKey])
```
Known patterns (`sk-...`, PEM private key blocks, `postgresql://user:pass@host/db`) are automatically masked with `<redacted>` or `[REDACTED]`.

### 7. Provenance & Attribution Headers
When porting or adapting components from the OpenCode upstream reference repository (`@ 3f393d78bf`), always prepend the attribution header:
```typescript
// Adapted from OpenCode packages/<path> @ 3f393d78bf (MIT License). See NOTICE.
```

---

## Important Files

### Configuration & Tooling
- `package.json`: Root package manifest with catalog definitions and workspace scripts.
- `turbo.json`: Turborepo pipeline configuration for cached `typecheck` and `test` executions.
- `bunfig.toml`: Bun configuration enforcing exact dependencies and test runner root isolation.
- `.env.example`: Template configuration for database connections and model providers.
- `openspec/config.yaml`: Global OpenSpec specification rules and research constraints.

### Core Contracts (`packages/protocol/src/`)
- `ports.ts`: Core interfaces (`RunStorePort`, `SourceSnapshotPort`, `ToolRegistryPort`).
- `events.ts`: Event vocabulary, Zod envelope schemas, and payload validation rules.
- `model-gateway.ts`: LLM abstraction contract (`ModelGatewayPort`, `ModelAttemptRequest`, `ModelAttemptResponse`).
- `stop-conditions.ts`: Budget limits, timeout rules, and terminal reason mappings.

### Domain Implementation (`packages/core/src/`)
- `runner/single-turn-runner.ts`: Orchestrator for direct-model baseline runs.
- `runner/judge-runner.ts`: Full agent loop orchestrator for smart-contract vulnerability judging.
- `runner/run-queries.ts`: Query functions (`getRun`, `getRunHistory`) for persistent stores.
- `tool/registry.ts`: ToolRegistry with schema validation and error result synthesis.
- `source/source-snapshot.ts`: SourceSnapshot path validation and authorization.
- `eval/metrics.ts`: Precision, recall, F1, and delta ($Y - X$) baseline comparison formulas.
- `testing/`: Canonical in-memory test doubles (`InMemoryRunStore`, `ScriptedModelGateway`).
- `testing/run-store-contract.ts`: Parametric conformance test suite for any `RunStorePort`.

### Adapters & CLI
- `packages/schema/src/store/postgres-run-store.ts`: PostgreSQL persistence implementation with CAS and lease locks.
- `packages/schema/src/db/schema.ts`: Drizzle ORM table definitions (`runs`, `events`, `model_attempts`).
- `packages/llm/src/gateway/real-model-gateway.ts`: Real model gateway utilizing OpenAI SDK.
- `packages/cli/src/index.ts`: Composition root for CLI command dispatch and lifecycle teardown.
- `packages/cli/src/config.ts`: Zod validation schema for environment variables with upward `.env` resolution.

---

## Runtime & Tooling Preferences

- **Required Runtime**: **Bun `1.3.14+`** (`bun`). Node.js is not used for running scripts or tests.
- **Package Manager**: **Bun Workspaces** (`bun install`). Do not use `npm`, `yarn`, or `pnpm`.
- **Shared Catalog**: Core dependency versions are pinned in `package.json` under `catalog:` (`@tsconfig/bun`, `@types/bun`, `typescript`, `zod`). Internal dependencies use `workspace:*`.
- **Database**: PostgreSQL 16+ (local service or Docker container).
- **ORM & Migrations**: Drizzle ORM (`drizzle-orm`, `drizzle-kit`).
- **Target System**: Darwin / Linux (POSIX shell).

---

## Testing & QA Expectations

### Test Strategy
1. **Pure Contract Verification (`@harness/protocol`)**: Validates wire contracts, schema bounds, and event serialization in isolation without database or network access.
2. **Deterministic Component Tests (`@harness/core`, `@harness/llm`, `@harness/cli`)**: Uses high-fidelity test doubles (`InMemoryRunStore`, `ScriptedModelGateway`, `FakeClock`) to assert on complex state transitions, retry policies, and error classifications deterministically.
3. **Parametric Store Conformance**: Any store implementation MUST pass `runStoreContractTests(makeHarness)` to prove:
   - Atomic CAS transitions and rejection of stale writes (`claim_lost`, `state_changed`).
   - Strictly monotonic, contiguous sequence numbers ($1, 2, \dots$).
   - Lease expiration and claim takeover rules.
   - Terminal state immutability (transitions on `completed`/`failed` runs are rejected).
4. **Graceful Integration Skips**: Tests requiring live infrastructure (e.g. `checkPostgresReachable`) must skip gracefully via `describe.skip` when services are unavailable, ensuring CI remains green without live dependencies.

### Pre-PR Quality Checklist
Before submitting code, ensure:
1. `bun turbo typecheck` passes with 0 errors across all 6 packages.
2. `bun turbo test` passes with 0 failures across all test files.
3. No secrets or credentials are hardcoded or leaked into event payloads.
4. OpenCode attribution headers are included on any adapted logic.
