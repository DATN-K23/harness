# Proposal

## Why

The current PoC adapter combines source staging, compiler verification, Docker startup and Foundry result interpretation. Each invocation repeats setup. Replace it with an OpenCode-style local driver and application permission checks. The host path should work wherever the Harness runtime and pinned Foundry toolchain work. Measure startup and resource use for RQ1.

## What Changes

- **BREAKING** Remove `SandboxPort`, sandbox execution types, `ScriptedSandbox`, `packages/core/src/sandbox/`, `DockerFoundrySandbox`, the Docker process wrapper, active PoC configuration and related exports. Move callers to verification and local-execution contracts.
- Use OpenCode's permission → process service → local environment structure. Authorize trusted executable, structured arguments, working directory and staged paths before direct spawn. The process service handles timeout, cancellation and bounded output.
- Use one host driver built on portable runtime APIs. Remove the proposed Seatbelt, bubblewrap, seccomp and cgroups requirements, OS-based admission gates and aggregate resource quotas. PoC execution requires no Docker, infrastructure VM or OS sandbox backend.
- Scope native verification to reviewed, digest-pinned trusted fixtures in an explicitly enabled internal composition. Application rules govern what Harness launches. The launched program runs with the host account's access and cannot safely be used as an untrusted-code boundary. Judge production and ordinary CLI remain read-only and return unavailable if verification is reached.
- Verify immutable snapshot inputs, run with trusted Foundry configuration and bounded output, and validate evidence for the intended test. Record safe execution provenance and retain read-only decoding of historical sandbox events and configuration.

Out of scope are general agent shell access, remote workspace providers, a real state-probe implementation, a production PoC activation path, and PostgreSQL deployment configuration.

Real CLI commands discover or start one shared local HTTP server using an OpenCode-style protected endpoint record and HTTP Basic credentials. Explicit foreground mode still accepts an operator-configured password.

## Capabilities

### New Capabilities

- `local-execution`: Rule-checked host invocation, process supervision, trusted local Foundry verification, portable host admission and historical reads.

### Modified Capabilities

- `asynchronous-run-api`: Require a configured password and HTTP Basic authentication for the standalone CLI server.
- `blueprint-structure`: Replace `sandbox/` with `execution/` and `verification/`.
- `agent-loop-protocol-contracts`: Remove sandbox operations from protocol and document core ownership.
- `judge-run-lifecycle`: Make the verification stage conditional and handle unavailable execution as unverified when execution is required.
- `judge-step-execution`: Move eligible probe calls to the verification contract while retaining tier and budget checks.
- `agent-loop-demo-evidence`: Migrate to scripted verification and execution doubles and retain deterministic offline evidence.

## Impact

- Core owns the new operational contracts, runner integration and testing doubles. Protocol retains safe event and configuration data, including historical decoders.
- Server and CLI wire disabled verification for ordinary Judge. Internal tests can compose the reviewed-fixture verifier explicitly.
- Current blueprint, package documentation and PoC setup guidance describe trusted host execution and platform prerequisites. If code is adapted, attribute its exact source path at OpenCode revision `21eaa626a37f77d7a8d80fa01997fa7d52506c97` and update `NOTICE`.
