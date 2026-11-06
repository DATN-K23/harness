# Design

## Context

The current grep handler imports `Worker` from `node:worker_threads`, listens with `.once("message" | "error" | "exit")`, then terminates the worker in `finally`. Those event methods are not present on the Bun Worker type used by the workspace, and the exit callback parameter is inferred as `any`. The worker provides a hard time boundary around model-supplied regular expressions, so replacing it with an in-process scan is not an acceptable type-only workaround.

The `.opencode_reference` checkout contains worker examples for browser-style workers and other worker-like APIs, but no directly equivalent Node `worker_threads` grep handler was found. Treat those as conceptual references only; use the runtime's actual supported event surface for this adapter.

## Goals / Non-Goals

**Goals:**

- Keep grep isolated in a worker with a hard timeout and prompt abort handling.
- Ensure worker message, error, exit, and termination paths settle once and release timers/listeners.
- Make TypeScript/Bun infer or explicitly declare all callback types and pass workspace typecheck.
- Preserve current path authorization, scan bounds, deterministic matching, result shape, and non-throwing timeout result.

**Non-Goals:**

- Rework grep matching semantics or its configured/default limits.
- Port upstream OpenCode implementation code or add a dependency.
- Change the protocol or source tool API.

## Decisions

1. **Use a Worker event API supported by the installed Bun type/runtime.** Inspect the exact Worker declarations and runtime behavior before implementation; prefer the smallest event-listener change that retains message/error/exit coverage. Do not silence the mismatch with `any`, broad casts, or ambient declaration patches.
   - **Alternative:** replace the worker with synchronous scanning. Rejected because pathological regular expressions could block the caller and defeat the search timeout.
   - **Alternative:** add a custom Worker wrapper/type shim. Rejected unless the runtime declaration demonstrably omits an actually supported API and the narrow correction is separately justified.

2. **Keep settlement and cleanup explicit.** A single settled guard should prevent duplicate completion when message, error, abort, timeout, and exit race. Timeout remains a model-actionable grep error; abort preserves the caller's abort reason. The `finally` path clears timeout, removes abort listeners, and terminates the worker.
   - **Alternative:** rely on worker exit alone for cleanup/settlement. Rejected because exit may race with message delivery or occur after timeout/abort.

3. **Use reference examples only for compatible lifecycle ideas.** The inspected `.opencode_reference` Worker examples are browser-style and are not a direct replacement for `node:worker_threads`; do not copy them mechanically. Harness path/security/scan behavior remains authoritative.

## Risks / Trade-offs

- [Risk] Bun and Node worker event APIs differ → inspect runtime types and add focused tests under the repository's Bun version before selecting the handler API.
- [Risk] racing terminal events could double-settle or leak a worker → test message, worker error/non-zero exit, timeout, and abort, and ensure cleanup runs for all outcomes.
- [Risk] worker startup may emit exit without a message → treat unexpected exit as an error without changing the timeout contract.

## Migration Plan

No data migration or public API migration is expected. Update the handler and its focused tests, then run focused core tests and `bun turbo typecheck`. Roll back by reverting only the handler/test change if the supported event API cannot preserve the existing timeout and abort guarantees.

## Open Questions

- None that block planning; the implementation task must confirm the precise Bun Worker event typings available in this checkout.
