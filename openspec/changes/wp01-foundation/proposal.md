## Why

WP-01 is the foundation work package that every other package (WP-02 through WP-10) depends on. Without it, no capability module has a home directory, no public interface exists for cross-module communication, no contract pipeline generates typed clients, and Tauri has not been proven buildable on the three target operating systems. The blueprint (`implementation-work-packages.md`) and timeline (`tv1-tv6-timeline.md` C02 row) designate this as the first code-producing gate after the C01 rebaseline.

## What Changes

- Scaffold the `runtime/` Python monolith: `pyproject.toml`, `uv.lock`, `src/harness/` with all seven capability module directories (`run_control`, `model_gateway`, `source_access`, `agent_runtime`, `judge`, `evaluation`, `scoring`), each containing `public/`, `ports/`, and `__init__.py` stubs.
- Scaffold `contracts/`: `registry.yaml`, `openapi/local-runtime.v1.openapi.yaml` copy from blueprint, `schemas/` directory tree per capability with versioned subdirectories.
- Scaffold `apps/desktop/src-tauri/`: minimal Tauri 2 Rust host (`Cargo.toml`, `tauri.conf.json`, `capabilities/main-window.json`, `src/main.rs`, `src/lib.rs`) with no business logic — only enough to prove three-OS compilation.
- Scaffold `apps/desktop/ui/`: React/Vite skeleton (`package.json`, `tsconfig.json`, `vite.config.ts`, `src/app/`) to serve as the Tauri webview content.
- Create `shared_kernel/` with cross-cutting value types, error hierarchy, and ID types used by public interfaces.
- Write public interface stubs (Python abstract classes / protocols) in each module's `public/` directory — these are the "pipe stubs" that WP-02 through WP-07 will implement against.
- Write port abstractions (inbound/outbound) in each module's `ports/` directory.
- Set up architecture boundary tests (`tests/architecture/`) that enforce the import graph from `physical-repository-layout.md`.
- Set up initial PostgreSQL migration infrastructure (`runtime/migrations/`) and an empty first migration proving the pipeline works.
- Create a contract generation pipeline that can produce Pydantic models and TypeScript types from `contracts/schemas/`.
- Create composition-root entrypoint stubs (`daemon`, `worker`, `evaluator`, `scorer`) enforcing the deny matrix.
- Provide tool JSON Schemas, security policy fixtures, and synthetic evaluation fixtures for WP-03–WP-08 interface testing.
- Produce Tauri three-OS build evidence (CI or local build logs for Windows, macOS, Linux).

**Non-goals (deferred to later WPs):**
- No business logic, state machine, agent loop, or provider call (WP-02/03).
- No real database tables beyond migration infrastructure (WP-06).
- No desktop UI beyond the Vite/React skeleton (WP-07).
- No evaluation scheduling or scoring (WP-08/09).

## Capabilities

### New Capabilities
- `foundation-scaffold`: The modular-monolith directory scaffold, shared kernel, public interface stubs, port abstractions, composition roots, contract generation pipeline, architecture boundary enforcement, migration infrastructure, and Tauri three-OS build evidence. This is the structural foundation that every other capability depends on.

### Modified Capabilities

_(No existing spec-level behavior changes. This package creates structure and interfaces only; it does not alter any requirement currently captured in existing specs.)_

## Impact

- **Repository layout**: Creates `runtime/`, `contracts/`, `apps/desktop/`, `config/`, `packaging/` directory trees for the first time. All paths follow `physical-repository-layout.md`.
- **Dependencies**: Introduces `pyproject.toml` (Python/uv), `Cargo.toml` (Rust/Tauri 2), `package.json` (React/Vite/pnpm) as project dependency roots.
- **CI/build**: Requires Rust, Node.js, Python, and uv toolchains. Tauri three-OS spike requires access to Windows, macOS, and Linux build environments.
- **Existing files**: No existing blueprint, docs, or openspec files are modified. This is purely additive.
- **Team**: All six tracks (TV1–TV6) contribute concurrently per the C02 timeline row; TV1 owns the overall package.
