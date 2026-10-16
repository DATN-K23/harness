# Harness Blueprint

Status: `Architecture documentation; runtime implementation pending`
Version: `blueprint-v6`
OpenSpec change: `align-packages-with-opencode`

## System Overview

**Harness** is a local-first AI Agent system designed to wrap Large Language Models (LLMs) and provide them with tools, context management, and multi-turn reasoning capabilities. The desktop application, runtime and database run locally; configured external model providers receive sanitized model requests.

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

Use the authoritative [module layout](architecture/module-layout.md) for all ten
package responsibilities, source provenance, import/generation rules, CLI composition
and scorer isolation. Shared schema is data; protocol is the application API; core
capabilities own persistence; llm owns the model boundary. This map adapts the pinned
OpenCode source without changing the React/Tauri/PostgreSQL choices.

## How to read

1. [Vocabulary](vocabulary.md) defines domain and architecture terms.
2. [Module layout](architecture/module-layout.md) defines current package ownership, import rules and OpenCode reuse gates.
3. [System overview](architecture/system-overview.md) defines processes, trust boundaries and persistence contracts.
4. [Sequences](architecture/sequences.md) define runtime flows and lifecycle transitions.

This directory retains six Markdown files. Documentation acceptance is not proof of
an implemented Judge, successful source port or completed evaluation. OpenSpec delta
synchronization/archive is a separate workflow step.
