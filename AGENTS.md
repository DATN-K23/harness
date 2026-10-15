# Repository Guidelines

## Project Overview

Harness is a provider-neutral, modular monorepo designed for smart-contract security auditing research. The primary scientific goal is to measure the performance delta ($Y - X$) between a raw direct-model baseline ($X$) and the harness-assisted agent loop ($Y$) across precision, recall, cost per run, and reproducibility/observed variability.

### Non-Negotiable Research Controls
- **Ground-Truth Isolation**: The agent loop, context engine, tools, and provider requests MUST NEVER access `GroundTruthLabel` data, adjudication reports, or scoring metadata. Enforced programmatically at port boundaries.
- **Source Snapshot Immutability**: Code inspection occurs strictly through read-only `SourceSnapshotPort` interfaces. Path traversal (`..`), absolute host paths, and denied prefixes are rejected without touching the host filesystem.
- **Config-Driven Experimentation**: Any optional behavior affecting output must be controlled via an explicit configuration flag, recorded in telemetry and immutable run snapshots.

---

## Architecture & Data Flow

The codebase implements a **Hexagonal Architecture (Ports and Adapters)**:

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
                 /              |               \
                v               v                v
      +------------------+  +---------+   +------------------+
      | PostgresRunStore |  | Gateway |   | Tool Registry /  |
      | (@harness/schema)|  | (@harness/  | Snapshot Mocks   |
      | [CAS + Events]   |  |   llm)      +------------------+
      +------------------+  +---------+
```

### Key Modules
1. **`@harness/protocol`**: Pure domain contracts, interfaces (ports), Zod validation schemas, and canonical event definitions. Zero third-party runtime dependencies (no database drivers, no provider SDKs).
2. **`@harness/core`**: Execution engines, runners (`SingleTurnRunner`, `JudgeRunner`), retry policies, cancellation boundary checks, deterministic tool dispatchers, and test doubles.
3. **`@harness/schema`**: Persistence adapter for PostgreSQL using Drizzle ORM and `postgres.js`, implementing `RunStorePort` with compare-and-set (CAS) concurrency and monotonic sequence generation.
4. **`@harness/llm`**: Model provider adapter implementing `ModelGatewayPort` via OpenAI SDK, pricing registries, token cost calculators, and normalized error mapping.
5. **`@harness/cli`**: CLI entry point supporting single-turn execution (`run`) and historical trajectory inspection (`view`).
6. **`@harness/server`**: Server component entry point.

### Data Flow & Execution Stages
1. **Input Validation**: `validateSingleTurnInput` checks prompt limits and bounds.
2. **Run Initialization**: Asynchronous run registration (`seedRun`) creates a record in `queued` state.
3. **Claim Lease**: Worker claims run via `claim()` with lease expiration (`claimExpiresAt`) and increments `claimVersion`.
4. **Event Trajectory**: All transitions and actions append sequential, immutable `TrajectoryEvent` items (`run.queued`, `run.started`, `provider.attempted`, etc.) with monotonic sequences ($1, 2, \dots, N$) and SHA-256 payload digests.
5. **Model Dispatch**: `ModelGatewayPort.executeAttempt()` runs with strictly governed timeouts (`AbortSignal.timeout`) and zero internal SDK retries (`maxRetries: 0`).
6. **Terminal Outcome Persistence**: State transitions to `completed` or `failed` via CAS update (`expectedStateVersion`), simultaneously recording token usage, USD cost, latency, and sanitized outputs.

---

## Key Directories

```
.
├── packages/
│   ├── protocol/          # Core ports, Zod schemas, domain models, event definitions
│   │   └── src/           # ports.ts, events.ts, model-gateway.ts, stop-conditions.ts
│   ├── core/              # Runners, orchestrators, tools, and testing fakes
│   │   ├── src/runner/    # SingleTurnRunner, JudgeRunner, run-queries, retry-policy
│   │   ├── src/testing/   # In-memory test doubles (InMemoryRunStore, ScriptedModelGateway)
│   │   └── src/demo/      # Offline demo scenarios and 100-run stress harness
│   ├── schema/            # Database schema, migrations, and PostgreSQL adapter
│   │   ├── src/db/        # Drizzle schema (runs, events, model_attempts), client, migrations
│   │   └── src/store/     # PostgresRunStore, secret redaction
│   ├── llm/               # Provider SDK adapters and token cost computation
│   │   ├── src/gateway/   # RealModelGateway (OpenAI API integration)
│   │   ├── src/pricing/   # Token cost computation and model pricing registries
│   │   └── src/errors/    # Provider error normalization and category mapping
│   ├── cli/               # CLI commands and runtime configuration
│   │   └── src/commands/  # run.ts, view.ts, config.ts, index.ts
│   └── server/            # Local runtime server package
├── docs/                  # Architecture specs, research guidelines, sprint tracking
└── openspec/              # OpenSpec spec-driven change tracking and delta specifications
```

---

## Development Commands

All development tasks MUST be run through **Bun** and **Turborepo**.

### Building & Typechecking
```bash
# Typecheck all packages across the monorepo (via Turborepo)
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

# Run tests for an individual package
bun run --cwd packages/core test
bun run --cwd packages/cli test
bun run --cwd packages/llm test
bun run --cwd packages/schema test

# Run a specific test file
bun test packages/core/test/runner/single-turn-runner.test.ts
bun test packages/cli/test/cli-e2e-persistence.test.ts
```

> **Important**: Running `bun test` from the root directory is intentionally blocked by `bunfig.toml` (`root = "./do-not-run-tests-from-root"`). Always use `bun turbo test` or run `bun test` inside package directories (`--cwd packages/<name>`).

### Running Applications & Demos
```bash
# Execute prompt via CLI (real model gateway + PostgreSQL store)
bun run cli:run -- --prompt "Explain smart contract reentrancy"

# Execute prompt using in-memory mocks (offline testing mode)
bun run cli:run -- --prompt "Explain reentrancy" --mock

# Inspect past run record and chronological trajectory events by Run ID
bun run cli:view -- --id <runId>
bun run cli:view -- --id <runId> --mock

# Apply database migrations
bun run db:migrate

# Run offline Judge demo scenarios (outputs 7-pillar trajectory bundle)
bun run demo

# Run stress harness (100 runs under fault injection)
bun run --cwd packages/core stress
```

---

## Code Conventions & Common Patterns

### 1. Formatting & Code Style
- **Indentation**: 2 spaces, no tabs.
- **Semicolons**: Omitted (`"semi": false` in root `package.json` Prettier config).
- **Line Length**: 120 characters print width.
- **Imports**: Group standard Node modules (`node:path`, `node:util`), third-party packages, and internal workspace packages (`@harness/*`). Always use ESM imports with TypeScript.

### 2. Naming Conventions
- **Files & Directories**: Kebab-case (e.g., `single-turn-runner.ts`, `postgres-run-store.ts`, `real-model-gateway.test.ts`).
- **Interfaces & Types**: PascalCase (e.g., `RunStorePort`, `ModelAttemptRequest`, `TrajectoryEvent`).
- **Enums & Constants**: PascalCase for types; SCREAMING_SNAKE_CASE or camelCase for dictionaries (e.g., `TerminalReasons`, `MODEL_PRICING_TABLE`, `DefaultModelTimeoutMs`).
- **Functions & Methods**: camelCase with verb prefixes (e.g., `executeAttempt`, `loadRun`, `validateSingleTurnInput`, `redactSecrets`).

### 3. Dependency Injection Pattern
Components avoid direct static instantiation of side-effecting services. Use dependency injection through typed `deps` options objects:
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
- Always use `async`/`await`. Avoid raw callback chains.
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
- `bunfig.toml`: Bun configuration enforcing test execution isolation.
- `.env.example`: Template configuration for database connections and model providers.
- `openspec/config.yaml`: Global OpenSpec specification rules and research constraints.

### Core Contracts (`packages/protocol/src/`)
- `ports.ts`: Core interfaces (`RunStorePort`, `SourceSnapshotPort`, `ToolRegistryPort`).
- `events.ts`: Event types, Zod envelope schemas, and event sequence rules.
- `model-gateway.ts`: LLM abstraction contract (`ModelGatewayPort`, `ModelAttemptRequest`, `ModelAttemptResponse`).
- `stop-conditions.ts`: Budget limits, timeout rules, and terminal reason mappings.

### Domain Implementation (`packages/core/src/`)
- `runner/single-turn-runner.ts`: Orchestrator for direct-model baseline runs.
- `runner/judge-runner.ts`: Full agent loop orchestrator for smart-contract vulnerability judging.
- `runner/run-queries.ts`: Query functions (`getRun`, `getRunHistory`) for persistent stores.
- `testing/`: Canonical in-memory test doubles (`InMemoryRunStore`, `ScriptedModelGateway`).
- `testing/run-store-contract.ts`: Parametric conformance test suite for any `RunStorePort`.

### Adapters & CLI
- `packages/schema/src/store/postgres-run-store.ts`: PostgreSQL persistence implementation with CAS.
- `packages/schema/src/db/schema.ts`: Drizzle ORM table definitions (`runs`, `events`, `model_attempts`).
- `packages/llm/src/gateway/real-model-gateway.ts`: Real model gateway utilizing OpenAI SDK.
- `packages/cli/src/index.ts`: Composition root for CLI command dispatch and lifecycle teardown.
- `packages/cli/src/config.ts`: Zod validation schema for environment variables.

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
1. `bun turbo typecheck` passes with 0 errors across all packages.
2. `bun turbo test` passes with 0 failures across all test files.
3. No secrets or credentials are hardcoded or leaked into event payloads.
4. OpenCode attribution headers are included on any adapted logic.
