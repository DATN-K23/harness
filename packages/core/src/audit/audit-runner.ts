import type {
  BudgetLimits,
  CancellationPort,
  ClockPort,
  ModelGatewayPort,
  SandboxPort,
  SourceSnapshotPort,
  ToolRegistryPort,
} from "@harness/protocol"
import type { AuditFinding, AuditReport } from "./audit-report"
import { createAuditReport } from "./audit-report"

/** Configuration for an autonomous codebase exploration run in Audit Mode. */
export interface AuditRunConfig {
  readonly runId: string
  readonly snapshotId: string
  readonly budgetLimits?: BudgetLimits
  readonly maxExplorationSteps?: number
  readonly targetContracts?: readonly string[]
  readonly focusAreas?: readonly string[]
}

/** Dependencies required by the AuditRunner orchestrator. */
export interface AuditRunnerDeps {
  readonly sourceSnapshot: SourceSnapshotPort
  readonly modelGateway?: ModelGatewayPort
  readonly toolRegistry?: ToolRegistryPort
  readonly sandbox?: SandboxPort
  readonly clock?: ClockPort
  readonly cancellation?: CancellationPort
}

/** Orchestrator stub for autonomous codebase exploration and audit report synthesis. */
export class AuditRunner {
  constructor(private readonly deps: AuditRunnerDeps) {}

  /**
   * Executes an exploration run over the target source snapshot.
   * In this scaffolding phase, validates the source snapshot availability,
   * enforces boundary cancellation, and produces a structured AuditReport.
   */
  async run(config: AuditRunConfig, signal?: AbortSignal): Promise<AuditReport> {
    signal?.throwIfAborted()

    if (this.deps.cancellation !== undefined) {
      const isCancelled = await this.deps.cancellation.isRequested(config.runId, signal)
      if (isCancelled) {
        throw new Error(`AuditRun ${config.runId} was cancelled`)
      }
    }

    const startTime = this.deps.clock?.nowMs() ?? Date.now()
    // Validate that the snapshot is accessible by listing available files
    const files = await this.deps.sourceSnapshot.listFiles(
      { snapshotId: config.snapshotId },
      signal,
    )

    signal?.throwIfAborted()

    // Autonomous exploration stub: full LLM agent loop will be wired in future sprint
    const findings: readonly AuditFinding[] = []
    const endTime = this.deps.clock?.nowMs() ?? Date.now()
    const durationMs = Math.max(0, endTime - startTime)

    return createAuditReport({
      auditRunId: config.runId,
      snapshotId: config.snapshotId,
      findings,
      durationMs,
      filesScanned: files.length,
    })
  }
}
