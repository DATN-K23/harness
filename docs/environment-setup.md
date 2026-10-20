# Environment Setup and CLI Quickstart

This guide covers the full Harness CLI flow:

1. configure the environment;
2. prepare local PostgreSQL;
3. register a repository as an immutable snapshot;
4. run a model with source tools against it;
5. inspect the run again from a new process.

---

## 1. Prerequisites

- **Bun**: v1.3.14+ (`curl -fsSL https://bun.sh/install | bash`)
- **Docker**: For running a local PostgreSQL container (or a native PostgreSQL 16+ installation)

---

## 2. Environment Configuration

Copy the template configuration file:

```bash
cp .env.example .env
```

The CLI finds the nearest `.env` by walking up from the working directory, so the root `.env` is used even when a script runs inside `packages/cli`. Variables already set in the shell take precedence over the file.

| Variable | Description | Default / Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://harness:harness@127.0.0.1:5432/harness` |
| `PROVIDER_NAME` | Provider family | `openai` for any OpenAI-compatible endpoint (also `anthropic`, `google`, `openrouter`) |
| `MODEL_NAME` | Model identifier | `gpt-4o-mini` |
| `MODEL_API_KEY` | Provider (or local router) API key | `sk-...` |
| `MODEL_BASE_URL` | Optional OpenAI-compatible endpoint | `http://127.0.0.1:20128/v1` |
| `MODEL_TIMEOUT_MS` | Per-attempt timeout in ms | `30000` (min: 1000, max: 300000) |
| `MODEL_MAX_OUTPUT_TOKENS` | Output-token limit sent on every attempt | `4096` (min: 1, max: 32768) |
| `MODEL_OUTPUT_TOKENS_FIELD` | Request field carrying that limit | `max_tokens` (default) or `max_completion_tokens` |
| `MODEL_INPUT_COST_PER_MTOK` / `MODEL_OUTPUT_COST_PER_MTOK` | Explicit USD price per million tokens; set both or neither | unset |
| `HARNESS_SNAPSHOT_DIR` | Snapshot storage directory | `<repo>/data/snapshots` |
| `HARNESS_MAX_STEPS`, `HARNESS_MAX_TOOL_CALLS`, `HARNESS_MAX_TOTAL_TOKENS` | Default limits for snapshot runs | runner defaults |

Every multi-turn run records its effective output field, prices and non-cost execution limits in its `run.started` event.
Harness does not enforce a monetary spend cap; configure provider-side limits if you need a hard spending limit.

**Cost rule:** when a model is neither in the pricing registry nor priced by the two `*_COST_PER_MTOK` variables:
- its cost is **unknown**;
- the CLI prints `unknown`, never `$0`;
- the database stores `NULL`;
- the run continues subject to its token, step, tool-call and wall-clock limits; Harness does not enforce a monetary spend cap.

> **Security Note**: Never commit `.env` containing real API keys or passwords. Harness automatically masks credentials in logs, CLI output, and trajectory events.

---

## 3. Local PostgreSQL Setup

### Option A: Using Docker (Recommended)

Start a local PostgreSQL container bound to the loopback interface only:

```bash
docker run --name harness-postgres \
  -e POSTGRES_USER=harness \
  -e POSTGRES_PASSWORD=harness \
  -e POSTGRES_DB=harness \
  -p 127.0.0.1:5432:5432 \
  -d postgres:16-alpine
```

To stop and start the container later:

```bash
docker stop harness-postgres
docker start harness-postgres
```

### Option B: Local PostgreSQL Service

Ensure a database named `harness` exists and is accessible via the URL specified in your `.env`.

---

## 4. Database Migrations

Once PostgreSQL is running, apply the migrations:

```bash
bun run --cwd packages/schema db:migrate
```

---

## 5. CLI Usage

The workspace root provides scripts for every command: `cli:repo`, `cli:snapshot`, `cli:run` and `cli:view`.

> **Windows note:** when Bun is installed under a path containing spaces, a nested `bun run` script can split quoted arguments, so a multi-word `--prompt` fails with `'C:\Users\...' is not recognized`. Call the CLI entry point directly instead:
>
> ```bash
> bun run --cwd packages/cli src/index.ts run --snapshot <id> --prompt "Find the reentrancy bug"
> ```

### 5.1 Register a repository (`cli:repo`)

```bash
bun run cli:repo -- add ../my-contracts --include-root src --include-root test
```

- The command ingests the repository into a content-addressed, write-once snapshot under `HARNESS_SNAPSHOT_DIR`.
- It prints the snapshot ID, the file count, and the skipped paths by reason (`denied`, `symlink`, `too_large`, `binary`).
- Denied files such as `.env*`, keys, `.git`, `node_modules` and report artifacts are never copied.
- The source repository is never modified. A storage directory inside the source tree is refused.
- No database or model key is needed for this command.

### 5.2 List snapshots (`cli:snapshot`)

```bash
bun run cli:snapshot -- list
```

The listing shows each snapshot's ID, file count, tree digest, ingestion policy version and creation time.

### 5.3 Run a prompt (`cli:run`)

Single-turn direct-model run (the RQ1 baseline arm, no tools):

```bash
bun run cli:run -- --prompt "Explain smart contract reentrancy vulnerabilities and prevention"
```

Multi-turn run against a snapshot, where the model can call `read_file`, `grep`, `glob` and `list_dir`:

```bash
bun run cli:run -- --snapshot snap_a17543c5d14e --prompt "Report any reentrancy bug with file:line evidence" \
  --max-steps 6 --max-tool-calls 6 --max-output-tokens 1024 --max-total-tokens 50000 --timeout 120000
```

- **Precedence:** a flag overrides the matching `HARNESS_*` or `MODEL_*` variable, which overrides the runner default.
- **Unknown snapshot:** the CLI exits with code 1 before any model call.
- **Output:** run ID, state, terminal reason, steps, tool calls, tokens, cost (or `unknown`), observed limits, `outputTruncated` when the final answer was cut, and the model output.

### 5.4 Inspect a run (`cli:view`)

```bash
bun run cli:view -- --id <runId>
bun run cli:view -- --id <runId> --json
```

For a multi-turn run, the view shows:
- the snapshot ID, prompt digest, effective limits, tool limits and observed limits;
- for each model step: its model, finish reason, tokens, cost (or `unknown`) and latency;
- for each tool call: its arguments, status, duration, truncation flag and a result preview.

The view reads only from the store, so it works from a new process after a restart.

### 5.5 Offline mode (`--mock`)

```bash
bun run cli:run -- --snapshot <id> --prompt "Find" --mock
```

`--mock` uses an in-memory store and a scripted provider. For a snapshot run, the provider reads the first snapshot file once and then answers.

Without `--mock`, missing provider or database settings stop the command with exit code 1 and name the missing variables. There is never a silent fallback to a mock.

### 5.6 Help

```bash
bun run cli:run -- --help
```

---

## 6. Using a local 9router with a Codex account

[9router](https://github.com/decolua/9router) exposes an OpenAI-compatible endpoint on the local machine. It can route to a ChatGPT/Codex subscription through OAuth.

1. **Install and run it on loopback only**, with an API key required and auto-update off:

   ```bash
   npm install -g 9router@0.5.104
   REQUIRE_API_KEY=true 9router -H 127.0.0.1 -p 20128 --no-browser --skip-update
   ```

2. **In the dashboard** (`http://127.0.0.1:20128/dashboard`):
   - change the default password;
   - connect **only** the Codex provider;
   - create an API key.

   For valid measurements, use no combos, fallback or tool-result compression: a silent model switch or rewritten tool output invalidates a run.

3. **Configure `.env`:**

   ```
   PROVIDER_NAME=openai
   MODEL_BASE_URL=http://127.0.0.1:20128/v1
   MODEL_API_KEY=<9router key>
   MODEL_NAME=cx/gpt-6-luna
   ```

   `cx/gpt-5.5` is rejected for ChatGPT accounts.

**Caveats observed on 2026-10-18 and 2026-10-19:**

- **The output-token limit is ignored.** Both `max_tokens` and `max_completion_tokens` are ignored by this provider. The only output cap is the runner's post-response token budget (`--max-total-tokens`).
- **Hidden instructions are added when the request has no system message.** In that case about 2,490 prompt tokens are injected upstream. Harness snapshot runs send their own system prompt, and their prompt token counts showed no such overhead, but the provider's exact model-visible input is not guaranteed to equal the persisted trajectory.
- **Cost is unknown.** `cx/...` models are absent from the registry, so cost is `unknown` unless explicit `*_COST_PER_MTOK` prices are set.
- **Quota can run out mid-run.** The subscription quota resets on 5-hour and weekly windows, and exhaustion surfaces as `rate_limit` errors.
