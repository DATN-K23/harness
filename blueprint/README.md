# Harness Blueprint

Status: `Validated blueprint`
Version: `blueprint-v5`
OpenSpec change: `update-module-layout`

## System Overview

**Harness** is a local-first AI Agent system designed to wrap Large Language Models (LLMs) and provide them with tools, context management, and multi-turn reasoning capabilities. It runs entirely on the developer's machine as a downloadable desktop application backed by a local runtime and database.

Harness is specifically designed for **Smart Contract Auditing**, allowing the AI to autonomously analyze source code and discover or verify vulnerabilities with greater precision than traditional chat interfaces.

Harness operates in two primary modes:
- **Audit Mode**: The agent acts as an autonomous auditor, actively scanning a given smart contract repository to discover new vulnerabilities (findings) similar to a human auditor in Code4rena or Sherlock contests.
- **Judge Mode**: The agent acts as a judge/verifier, taking an existing list of findings or a single candidate finding, filtering out duplicates, and verifying their validity by deeply analyzing the codebase.

> Blueprint only — no implementation evidence. This document defines future architecture, contracts, security, and delivery acceptance. It contains no application/test/migration/infrastructure source.

## What is decided

- TypeScript/Bun monorepo with 10 core packages, managed via Turborepo.
- Local runtime with server, core engine, and evaluation tooling; database is authoritative.
- Downloadable desktop application as a thin client consumer.
- Model gateway abstracting AI provider interactions (OpenAI, Anthropic, etc.).
- Matched Audit and Judge workflows leveraging structured JSON output and strict context isolation.

## Non-negotiable invariants

1. The agent runtime operates purely on source code and provided rulesets, with isolated context to ensure reproducible and unbiased analysis.
2. The native picker path is ephemeral registration-only input. Runtime imports a managed immutable snapshot.
3. The runtime structurally has no shell mutation, process spawning, or network access beyond the configured model provider.
4. Every optional behavior has a stable flag, telemetry, and immutable snapshot value.
5. Every run records model/profile and prompt versions/digests, resolved flags, token usage, separated latency, cost, and ordered tool calls.
6. The agent's knowledge and capabilities are defined strictly by its toolset and provided prompts, ensuring predictable and deterministic behavior where possible.
7. Database state survives desktop/server restarts.
8. Judge verdicts remain `unverified`; future PoC execution belongs to a separate `VerificationRunner` change/process.

## Package map

```text
harness/
├── bunfig.toml                # Bun workspace configuration
├── package.json               # Root workspace manifest and dependency catalog
├── turbo.json                 # Turborepo pipeline configuration
├── tsconfig.json              # Shared TypeScript configuration
├── infra/                     # Infrastructure-as-code
├── sdks/                      # External SDKs (e.g., IDE extensions)
├── blueprint/                 # This directory — architecture documentation
└── packages/
    ├── protocol/              # Shared types, effects, and API contracts
    ├── schema/                # Data models and database schemas (Drizzle ORM)
    ├── core/                  # Core engine: Agent loop, tool dispatch, execution logic
    ├── llm/                   # Model gateway and provider adapters
    ├── server/                # Local daemon / API server
    ├── cli/                   # Command-line interface
    ├── client/                # HTTP/RPC client SDK
    ├── ui/                    # Shared UI components
    ├── app/                   # Web application interface
    └── desktop/               # Desktop application wrapper (Electron)
```

## How to read

1. Read `vocabulary.md` to understand the domain terms.
2. Read `decisions/architecture-decisions.md` for historical ADR context.
3. Use `architecture/system-overview.md` and `architecture/module-layout.md` for structure and boundaries.
4. Use `architecture/sequences.md` to understand runtime behavior and end-to-end flows.
