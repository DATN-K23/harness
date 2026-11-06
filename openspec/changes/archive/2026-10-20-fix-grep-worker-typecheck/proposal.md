# Proposal

## Why

`bun turbo typecheck` currently fails because the grep handler uses `Worker.once`, which is absent from the Bun Worker type declarations, and its exit-code callback parameter is implicitly `any`. This blocks a clean workspace typecheck while the source-search tool is part of the core source-access boundary.

## What Changes

- Correct the grep worker lifecycle handling so it typechecks against the supported Bun runtime and preserves timeout, error, and cleanup behavior.
- Compare the implementation with available `.opencode_reference` worker patterns where applicable, reusing only relevant, compatible ideas and retaining Harness-specific security limits.
- Add or adjust focused tests for grep success, worker failure/exit, timeout, and cleanup as supported by the existing implementation.
- Verify `bun turbo typecheck` passes across all workspace packages.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is an implementation/tooling correction; it does not intentionally change user-visible grep behavior or source-access requirements.

## Impact

- `packages/core/src/tool/handlers/grep.ts`
- Focused grep handler tests under `packages/core/test/tool/handlers/`
- Workspace typecheck across `@harness/core`, `@harness/cli`, and `@harness/schema`
- `.opencode_reference` is an investigation input only; its inspected worker examples use browser-style `Worker` events in other contexts, and no directly equivalent Node `worker_threads` grep handler was found. No new runtime dependency or upstream code adoption is assumed.
