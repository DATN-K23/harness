# Task 5 report — PoC policy and Foundry sandbox

## Outcome: BLOCKED, not complete

No production sanitizer or Docker/Foundry adapter was added, and no Docker command was run. The approved design makes target-verified isolation a prerequisite, not something a sanitizer or unit-test mock can substitute for. Task 1 explicitly leaves the Foundry image as an uninspected candidate and runtime blocked; its Docker evidence is Linux ARM64, not the supported macOS Docker Desktop target. The user instruction also prohibits running hostile PoCs or Docker workloads without explicit authorization.

No policy-only sanitizer was added either. Without a verified parser/toolchain and an explicit supported PoC policy, a source-text blacklist would be incomplete and could falsely suggest accepted input is safe. Task 3 extracts submitter PoC text but does not authorize or validate it for execution. A policy rejection test for obvious syntax would not establish that all unsafe constructs are rejected, while a permissive result could be misused as a green light. The existing `SanitizerPort` result (`ok`) is consumed by the runner as permission to continue toward the sandbox, so adding a partial implementation there would create a consequential false assurance.

## Prerequisites to resume

1. Authorization is separate by action: (a) pulling/inspecting an image without starting a container does not authorize running it; (b) benign disposable-container integration requires explicit authorization; and (c) hostile PoC execution requires its own explicit authorization. No authorization is inferred from approval of the implementation plan.
2. Pull and inspect an immutable Foundry image digest; verify its contents, Foundry/solc versions, entrypoint and non-root identity, then record an approved image decision.
3. Verify on supported macOS Docker Desktop configurations that the daemon enforces network isolation, read-only bind mounts/root, UID/GID behavior, dropped capabilities/no-new-privileges, bounded tmpfs and CPU/RAM/PIDs, timeout/cancellation/kill, output bounds and cleanup. Linux CLI flag availability does not prove these properties.
4. Only then implement the production process adapter and test every Docker invocation argument, mount and environment boundary, plus guarded benign integration cases. Keep `enablePocExecution` disabled in production composition until that review is complete; Task 4 reports that explicitly setting it true currently allows the existing sanitizer/sandbox path.
5. Separately define and test a conservative policy against the approved Solidity/Foundry profile. Treat policy acceptance as eligibility only, never as isolation or proof of exploitability.

## Verification / scope

- Read the Task 5 brief, approved design, Task 1 toolchain decision, and Task 3/4 reports.
- Inspected the current `SanitizerPort`/`SandboxPort`, sandbox constraint defaults, and sanitizer call sites. Existing `validateSandboxConstraints` checks only network mode and positive timeout; it is not a production Docker adapter or a complete isolation policy.
- No tests or typechecks were run because this task made no code changes. No Docker pull/run, Foundry execution, hostile code execution, or external workload was performed.
- Task 5 remains incomplete. This report does not claim runtime PoC support or a verified sanitizer.

## Addendum

- Commit `d9285f7` clarifies the separate authorization required for image inspection, benign disposable-container integration, and hostile PoC execution; implementation-plan approval authorizes none of them.
