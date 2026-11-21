# Tasks

Owners are proposed. Record reproducible evidence before marking a task or delivery gate complete.

## 1. Contracts and records (G1)

- [x] 1.1 [TV1, G1] Define public core execution and verification contracts, including explicit unavailable results. Verify callers use the correct public subpaths and process exit alone cannot imply verification success. Document the module boundary in the blueprint.
- [x] 1.2 [TV1, G1] Add versioned `localExecution` metadata, new event/cancellation names and historical decoders. Bind the existing `enablePocExecution` flag to telemetry and immutable snapshots. Test enabled/disabled records, unchanged historical digests and rejection of historical execution admission. Document both formats.
- [x] 1.3 [TV5, G1] Tie frozen experiment identity to backend, platform, policy and toolchain provenance. Test identical and changed profiles and document how to record a new experiment cell.

## 2. Permission and portable process service (G2)

- [x] 2.1 [TV4, G2] Authorize trusted executable, fixed argv and canonical staged paths. Construct explicit environment and stdio bindings. Verify shell indirection, overrides, traversal and symlink escapes are denied before spawn, and synthetic secrets are excluded from bindings. Document the application permission boundary.
- [x] 2.2 [TV2, G2] Implement the single host driver and capability/toolchain-based admission. Exercise path handling and direct argv on available OS runners, including Windows when prerequisites are present. Verify missing toolchains give unavailable and no platform-name gate or OS sandbox probe is required. Document verified hosts and prerequisites, including the distinction between executor portability and full Harness platform support.
- [x] 2.3 [TV2, G2] Implement timeout, cancellation, lease-loss handling and combined output limits. Verify one terminal outcome, child termination on supported runtime controls, bounded output and explicit failure on uncertain cleanup. Document the owned-child guarantee and its limits.

## 3. Reviewed Foundry fixtures (G3)

- [x] 3.1 [TV4, G3] Admit only registered maintainer-reviewed fixture manifests in explicit internal composition with no scorer-store binding. Test that the flag alone, unreviewed inputs and modified manifests cannot start a process. Document the trusted-host requirement and how fixtures are reviewed.
- [x] 3.2 [TV3, G3] Verify pinned toolchain artifacts offline, stage immutable snapshot inputs and generate trusted Foundry settings with FFI disabled. Test artifact mismatches, missing dependencies, snapshot integrity and invocation-specific scratch. Document artifact provisioning.
- [x] 3.3 [TV1, G3] Validate evidence for the intended test and bind it to input and toolchain digests. Cover pass, assertion failure, partial/missing output, zero tests and unavailable real probes. Verify test outcomes do not directly decide a verdict.
- [x] 3.4 [TV2, G3] Emit safe authorization outcomes, byte counts and phase timings. Verify tests redact host paths and secrets before model or persistence exposure. Document metrics and distinguish measured resource use from enforced limits.

## 4. Migrate consumers and delete the Docker backend (G4)

- [x] 4.1 [TV1, G4] Migrate Judge, adjudication, cancellation and Audit to verification. Verify tier, probe budget, cancellation and model-attempt accounting in connected tests. Verify read-only runs skip verification and enabled failures remain unverified. Update active pipeline docs.
- [x] 4.2 [TV6, G4] Wire server and ordinary CLI to unavailable verification, replacing success placeholders. Test production rejects enablement and disabled paths perform no spawn or toolchain discovery. Update composition docs.
- [x] 4.3 [TV6, G4] Migrate demo/test fakes and trace readers. Verify identical seeded demos, explicit simulation labels and old/new trace fixtures with untouched digests. Update demo and history docs.
- [x] 4.4 [TV1, G4] Delete old sandbox module, Docker adapter and wrapper, obsolete operational types and exports, PoC Docker tests and setup. Audit live references and update the blueprint, setup documentation and attribution for adapted code. Keep legacy data readers and database setup.

- [x] 4.5 [TV6, G4] Replace Keychain and the standalone token file with configured HTTP Basic authentication. Verify password preflight, authenticated requests and rejection of old Bearer credentials. Update operator instructions and the local-runtime boundary.

- [x] 4.6 [TV6, G4] Reuse one shared daemon for real CLI commands. Verify authenticated discovery, concurrent singleton startup, continued service after client exit, command output and authenticated shutdown. Document configuration lifetime and offline mock behavior.

## 5. Integrated evidence (G5)

- [x] 5.1 [TV1, G5] Run `bun turbo typecheck`, `bun turbo test`, the six existing offline demo scenarios and the 100-run stress suite. Record commands and results in sprint evidence.
- [x] 5.2 [TV4, G5] Run reviewed Foundry fixtures directly on each platform claimed supported. Record actual OS/architecture, toolchain digest and pass, denied and unavailable outcomes. Mark unavailable runners unverified and do not count skipped tests as native evidence.
- [x] 5.3 [TV5, G5] Measure cold/warm native startup, phase and total latency and observed resource use. Report samples, median/p95, platform, toolchain and any comparable historical baseline. Record evidence and status in sprint/timeline documentation.

Validation on macOS 26.2 ARM64: typecheck passed in all six packages. The six offline demos completed and the 100-run stress suite reported zero invariant violations and zero unhandled errors. With configured HTTP Basic authentication, the full unfiltered suite passed (1,331 passing tests, 20 default opt-in skips). Native Foundry fixtures and the benchmark passed separately. See the core README for the toolchain, measurements and reproduction commands.

Shared daemon verification: real CLI subprocesses raced startup, reused one PID, preserved snapshot data, rejected an unauthenticated status request, stopped through the authenticated control route and restarted with a new PID and password. The smoke run used a disposable user profile and snapshot directory. It exercised the unavailable paths for commands that need live PostgreSQL or a model provider.
