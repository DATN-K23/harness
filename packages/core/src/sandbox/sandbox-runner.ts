import type {
  SandboxPort,
  SandboxResult,
  StageInput,
  StateProbeResult,
} from "@harness/protocol"

/** Network isolation mode: strictly 'none' in smart contract security evaluation to prevent test PoCs from making outbound calls. */
export type DockerSandboxNetworkMode = "none"

/** Resource and security constraints enforced on the sandbox execution container. */
export interface SandboxExecutionConstraints {
  /** Network isolation policy; strictly "none" to guarantee offline PoC execution. */
  readonly networkMode: DockerSandboxNetworkMode
  /** Hard timeout in milliseconds before the execution process or container is SIGKILLed. */
  readonly timeoutMs: number
  /** Maximum memory in megabytes allocated to the container (e.g. 2048 MB). */
  readonly maxMemoryMb?: number
  /** CPU limit (e.g. 1.0 or 2.0 cores). */
  readonly cpuLimit?: number
  /** Whether the root filesystem is mounted read-only (default: true). */
  readonly readOnlyRoot?: boolean
  /** Ephemeral scratch directory paths mounted via tmpfs. */
  readonly tmpfsMounts?: readonly string[]
  /** Allowed environment variable names passed to the container (secrets and host env are blocked). */
  readonly envAllowlist?: readonly string[]
}

/** Default execution constraints guaranteeing strict offline isolation and bounded runtime. */
export const DEFAULT_SANDBOX_CONSTRAINTS: SandboxExecutionConstraints = {
  networkMode: "none",
  timeoutMs: 60_000,
  maxMemoryMb: 2048,
  cpuLimit: 2.0,
  readOnlyRoot: true,
  envAllowlist: ["FOUNDRY_PROFILE", "PATH"],
}

/** Options for configuring a Foundry test execution run inside the sandbox. */
export interface FoundrySandboxConfig {
  /** Docker image tag to execute (e.g. "ghcr.io/foundry-rs/foundry:latest"). */
  readonly image: string
  /** Execution constraints enforced on the sandbox container. */
  readonly constraints: SandboxExecutionConstraints
  /** Number of fuzz test runs (e.g. 256). */
  readonly fuzzRuns?: number
  /** Forge test verbosity flag (e.g. 2 for -vv, 3 for -vvv, 4 for -vvvv). */
  readonly verbosity?: number
}

/** Input for running a single-shot exploit PoC in the sandbox. */
export interface SandboxRunInput extends StageInput {
  readonly testFile: string
  readonly constraints?: Partial<SandboxExecutionConstraints>
}

/** Input for running a state probe in the sandbox. */
export interface SandboxProbeInput extends StageInput {
  readonly probedTestFile: string
  readonly constraints?: Partial<SandboxExecutionConstraints>
}

/** Extended runner port that exposes sandbox execution constraints and metadata. */
export interface DockerSandboxRunnerPort extends SandboxPort {
  readonly constraints: SandboxExecutionConstraints
}

/** Validates that constraints enforce required offline isolation and a positive timeout. */
export const validateSandboxConstraints = (
  constraints: SandboxExecutionConstraints,
): { valid: true } | { valid: false; reason: string } => {
  if (constraints.networkMode !== "none") {
    return {
      valid: false,
      reason: `Network mode must be 'none', got '${constraints.networkMode}'`,
    }
  }
  if (constraints.timeoutMs <= 0 || !Number.isFinite(constraints.timeoutMs)) {
    return {
      valid: false,
      reason: `Timeout must be a positive finite integer, got ${constraints.timeoutMs}`,
    }
  }
  return { valid: true }
}
