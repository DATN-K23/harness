import type { RunState, TrajectoryEvent } from "./events"
import type { TerminalReason } from "./stop-conditions"

// Every type in this file that the agent can see (findings, tool results, stage results, snapshot reads)
// is free of labels, ground truth, adjudication reports and scores; scorer data never crosses these ports.

export interface CandidateFinding {
  findingId: string
  reportMarkdown: string
}

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema of the tool arguments. */
  parameters: Record<string, unknown>
}

export interface ToolCall {
  runId: string
  callId: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface ToolExecutionResult {
  content: string
  isError: boolean
  filePath?: string
  lineRange?: [number, number]
  isTruncated?: boolean
}

export interface ToolRegistryPort {
  definitions(): readonly ToolDefinition[]
  /** Tool failures resolve as `isError: true` results; the registry does not throw for them. */
  execute(call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult>
}

export interface SecurityFilterResult {
  content: string
  redactionCount: number
}

export interface SecurityFilterPort {
  filterSecrets(content: string, signal?: AbortSignal): Promise<SecurityFilterResult>
}

export interface StageInput {
  runId: string
  snapshotId: string
}

export interface BceSlice {
  filePath: string
  content: string
  lineRange?: [number, number]
}

export interface DeconstructedClaim {
  targetContracts: string[]
  targetFunctions: string[]
  rootCause: string
  attackScenario: string
  callerAssumptions: string[]
  claimedImpact: string
  claimedState: string
}

export const isValidDeconstructedClaim = (claim: DeconstructedClaim): boolean =>
  (claim.targetContracts.length > 0 || claim.targetFunctions.length > 0) &&
  claim.rootCause.trim() !== "" && claim.attackScenario.trim() !== "" &&
  claim.claimedImpact.trim() !== "" && claim.claimedState.trim() !== ""

export type IngestionResult =
  | { kind: "missing_poc" }
  | { kind: "narrative_only"; pocCode?: string; claim: DeconstructedClaim; bceSlices: BceSlice[] }
  | { kind: "invalid_report" }
  | { kind: "ok"; pocCode: string; claim?: DeconstructedClaim; bceSlices: BceSlice[] }

export interface IngestionPort {
  ingest(input: StageInput & { finding: CandidateFinding }, signal?: AbortSignal): Promise<IngestionResult>
}

export interface AntiCheatFinding {
  ruleId: string
  message: string
  line?: number
}

export interface AntiCheatReport {
  rulesChecked: string[]
  findings: AntiCheatFinding[]
}

export type SanitizerResult =
  | { kind: "cheat_detected"; findings: AntiCheatFinding[] }
  | { kind: "ok"; stitchedTestFile: string; hasSubmitterAssertions: boolean; antiCheatReport: AntiCheatReport }

export interface SanitizerPort {
  sanitize(input: StageInput & { pocCode: string }, signal?: AbortSignal): Promise<SanitizerResult>
  injectStateProbes(
    stitchedTestFile: string,
    stateVariables: string[],
    signal?: AbortSignal,
  ): Promise<{ probedTestFile: string }>
}

export interface SandboxResult {
  exitCode: number
  trace: string
  durationMs: number
}

export interface StateDelta {
  variable: string
  before: string
  after: string
}

export interface StateProbeResult {
  exitCode: number
  trace: string
  stateDeltas: StateDelta[]
}

export interface SandboxPort {
  runSingleShot(input: StageInput & { testFile: string }, signal?: AbortSignal): Promise<SandboxResult>
  runStateProbe(input: StageInput & { probedTestFile: string }, signal?: AbortSignal): Promise<StateProbeResult>
}

export type SnapshotReadResult =
  | { kind: "ok"; lines: string[] }
  | { kind: "not_found" }
  | { kind: "out_of_range"; lineCount: number }

/** Read-only by construction: no member writes, deletes, renames or executes. */
export interface SourceSnapshotPort {
  readLines(
    input: { snapshotId: string; path: string; startLine: number; endLine: number },
    signal?: AbortSignal,
  ): Promise<SnapshotReadResult>
  listFiles(input: { snapshotId: string; directory?: string }, signal?: AbortSignal): Promise<string[]>
}

export interface RunClaim {
  runId: string
  claimToken: string
  claimVersion: number
}

export interface RunAdmission {
  runId: string
  findingId: string
  reportMarkdown: string
  snapshotId: string
  config: Record<string, unknown>
  idempotencyKey: string
  requestDigest: string
}

export type AdmissionResult =
  | { kind: "accepted" | "replayed"; runId: string }
  | { kind: "conflict" }

// Adapted from OpenCode packages/core/src/session/runner/llm.ts @ 3f393d78bf (MIT License). See NOTICE.
export interface RunRecord {
  runId: string
  state: RunState
  stateVersion: number
  terminalReason?: TerminalReason
  prompt?: string
  snapshotId?: string
  findingId?: string
  configSnapshot?: Record<string, unknown>
  modelProfile?: string
  resultContent?: string
  errorMessage?: string
  errorCategory?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  costUsd?: string | number | null
  latencyMs?: number
}

export type ClaimResult =
  | { kind: "claimed"; claim: RunClaim; state: RunState; stateVersion: number }
  | { kind: "unavailable"; reason: "already_claimed" | "terminal" | "not_found" }

/** The store assigns `runId` (from the claim) and `sequence`. */
export type NewTrajectoryEvent = Omit<TrajectoryEvent, "runId" | "sequence">

export type StaleReason = "claim_lost" | "state_changed"

export type AppendResult = { kind: "appended"; event: TrajectoryEvent } | { kind: "stale"; reason: StaleReason }

export type TransitionResult = { kind: "transitioned"; stateVersion: number } | { kind: "stale"; reason: StaleReason }

/** Every mutation carries the claim and expected state version; a stale write returns `stale` and changes nothing. */
export interface RunStorePort {
  admit(input: RunAdmission, signal?: AbortSignal): Promise<AdmissionResult>
  findActiveRunsBySnapshot?(snapshotId: string): Promise<string[]>
  claim(input: { runId: string; workerId: string }, signal?: AbortSignal): Promise<ClaimResult>
  appendEvent(
    input: { claim: RunClaim; expectedStateVersion: number; event: NewTrajectoryEvent },
    signal?: AbortSignal,
  ): Promise<AppendResult>
  transition(
    input: {
      claim: RunClaim
      expectedState: RunState
      expectedStateVersion: number
      nextState: RunState
      terminalReason?: TerminalReason
      prompt?: string
      modelProfile?: string
      resultContent?: string
      errorMessage?: string
      errorCategory?: string
      promptTokens?: number
      completionTokens?: number
      totalTokens?: number
      costUsd?: string | number | null
      pricing?: "priced" | "unpriced"
      latencyMs?: number
    },
    signal?: AbortSignal,
  ): Promise<TransitionResult>
  loadRun(runId: string, signal?: AbortSignal): Promise<RunRecord | undefined>
  loadEvents(input: { runId: string; afterSequence?: number }, signal?: AbortSignal): Promise<TrajectoryEvent[]>
}

export interface ClockPort {
  /** Milliseconds since the Unix epoch. */
  nowMs(): number
}

export interface RandomPort {
  /** A value in [0, 1). */
  next(): number
}

export interface SleepPort {
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export interface CancellationPort {
  isRequested(runId: string, signal?: AbortSignal): Promise<boolean>
}
