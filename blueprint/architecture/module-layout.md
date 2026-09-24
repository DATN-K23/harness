# Module Layout & Boundaries

## System Overview

Harness is a local-first AI Agent framework designed for Smart Contract Security analysis. It wraps Large Language Models (LLMs) with tools, context management, and multi-turn reasoning to discover and verify vulnerabilities in smart contracts across two primary modes:
- **Audit Mode**: Autonomous exploration of a smart contract codebase to discover new vulnerabilities (findings).
- **Judge Mode**: Verifying, deduplicating, and filtering a provided set of candidate findings against the codebase.

This document defines the physical repository layout and module boundaries across the 10 core packages. It is the authoritative guide for where code belongs. When implementing a new feature or fixing a bug, use this document to determine the correct package.

## Physical Repository Layout

The project is a TypeScript/Bun monorepo managed by Turborepo, consisting of 10 core packages:

```text
harness/
├── bunfig.toml                # Bun workspace configuration
├── package.json               # Root workspace manifest and dependency catalog
├── turbo.json                 # Turborepo pipeline configuration (lint, test, build, dev)
├── tsconfig.json              # Shared TypeScript configuration
├── infra/                     # Infrastructure-as-code (e.g. AWS / Cloudflare / Serverless)
├── sdks/                      # External SDKs (e.g., VSCode extension)
└── packages/
    ├── protocol/              # Shared types, effects, and API contracts
    ├── schema/                # Data models and database schemas (Drizzle ORM)
    ├── core/                  # Core engine: Agent loop, tool dispatch, Judge execution
    ├── llm/                   # Model gateway and provider adapters
    ├── server/                # Local daemon / API server exposing the core engine
    ├── cli/                   # Command-line interface for running evaluations
    ├── client/                # HTTP/RPC client SDK for communicating with the server
    ├── ui/                    # Shared UI components
    ├── app/                   # Web application interface
    └── desktop/               # Desktop application wrapper (Tauri 2)
```

## Root Configuration and Directories

- **`turbo.json`**: Defines the task pipeline for the monorepo, ensuring commands like `build`, `typecheck`, and `lint` run in the correct topological order and use caching.
- **`bunfig.toml` & `package.json`**: Manages shared dependencies across all packages to prevent version conflicts (utilizing the `catalog:` feature of Bun workspaces).
- **`infra/`**: Contains Infrastructure-as-Code definitions for cloud deployments, remote evaluation runners, or shared backend services.
- **`sdks/`**: Holds generated or hand-written SDKs for external platforms to interface with Harness (e.g., IDE extensions).

## Package Boundaries and Roles

When implementing a new feature, use this guide to determine where your code belongs:

### 1. `protocol` & `schema` (The Foundation)

- **Role**: Define the shared vocabulary and data model of the system.
  - `schema` owns the data models — database tables (via Drizzle ORM), entity definitions, and migration logic. This includes run records, trajectory events, verdicts, and evidence.
  - `protocol` owns the API contracts, shared types, validation schemas, and effect definitions. These are the types that cross package boundaries.
- **Rules**: Must not depend on any other internal package. Must be importable by both frontend (browser) and backend (Node/Bun) environments.

### 2. `core` & `llm` (The Brain)

- **Role**:
  - `core` is the heart of Harness. It contains the agent runtime loop, Judge execution logic, tool dispatch (bounded read-only source tools), context management, and verdict generation. This is where the core logic lives.
  - `llm` abstracts all interactions with external AI providers (OpenAI, Anthropic, etc.) behind a unified model gateway interface. It handles provider profiles, request sanitization, token accounting, cost tracking, and retry policy.
- **Rules**: `core` can import `protocol`, `schema`, and `llm`. `llm` can import `protocol` and `schema`. Neither may import `server`, `client`, or any frontend package. Provider SDK types must not leak beyond `llm`.

### 3. `server` (The API)

- **Role**: A thin HTTP daemon that exposes `core` functionality via a local API. Handles run submission, status queries, trajectory event streaming, and source registration.
- **Rules**: Consumes `core`, `llm`, `protocol`, and `schema`. Must not contain deep business logic — all orchestration belongs in `core`. The server is a process boundary, not a business boundary.

### 4. `client` (The Bridge)

- **Role**: The universal HTTP/RPC client SDK used by all frontends to communicate with the `server`. Provides typed methods for every server endpoint.
- **Rules**: Consumes `protocol` only. Must be strictly browser-safe and avoid any Node.js/Bun built-ins. This is the only sanctioned way for UI code to interact with the runtime.

### 5. `ui`, `app`, `desktop`, `cli` (The Presentation)

- **Role**:
  - `ui`: Reusable visual components (buttons, modals, data tables, verdict displays).
  - `app`: The main web application — routing, pages, state management, trajectory viewer, run dashboard.
  - `desktop`: Wraps the `app` in a lightweight native desktop shell (Tauri 2 with narrow Rust host). Handles window management, native file dialogs for source registration, and local credential custody.
  - `cli`: Terminal-based interaction for headless runs and CI/CD integration.
- **Rules**: All presentation packages consume `client` (to talk to the API) and `ui` (for visual components). They **must never** directly import `core`, `llm`, or `server`. This enforces a strict client-server boundary, even when running locally.

## Dependency Graph

```text
protocol ← schema
    ↑         ↑
    |         |
   llm ← ── core
    ↑         ↑
    |         |
    └── server ──┘
         ↑
       client
         ↑
    ┌────┼────┐
    ui  app  cli
         ↑
      desktop
```

**Rules:**
- Arrows point from consumer → dependency (i.e., `core` imports `llm`, `protocol`, `schema`)
- `protocol` and `schema` have zero internal dependencies
- No circular dependencies permitted
- Frontend packages never import backend packages

## Architecture Checks

When opening a Pull Request, ensure these invariants hold:

1. **Boundary Enforcement**: Frontend packages (`app`, `desktop`, `ui`, `cli`) MUST NOT import backend packages (`core`, `server`, `llm`).
2. **Data Integrity**: All database access goes through `schema` and is orchestrated by `core`. The UI never speaks directly to the database.
3. **Provider Isolation**: Provider SDK types and credentials never escape the `llm` package boundary.
4. **No Ownership Metadata**: Do not encode team tracks or specific developers into this blueprint. Code ownership is managed via Git and `CODEOWNERS`.
