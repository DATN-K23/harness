import { DefaultMaxProbeRuns, isValidDeconstructedClaim, type BceSlice, type ContextItem, type DeconstructedClaim, type ToolRegistryPort } from "@harness/protocol"
import {
  RunStateProbeToolName,
  buildInitialContext,
  composeTools,
  createProbeCounter,
  stateProbeFor,
  type SanitizedPoc,
} from "../judge/adjudication-step"
import { textDigest } from "../util/digest"
import { checkBoundary, type CancellationBoundary } from "./cancellation"
import { fastRejectVerdict, type FastReject, type FastRejectReason } from "./fast-reject"
import type { HydratedHistory } from "./history-hydrator"
import type { JudgeRunInput, JudgeRunnerDeps } from "./judge-runner"
import { StepFault, asFault, type Persist } from "./judge-step-support"
import type { TerminalCommit } from "./run-writer"

/** What the stage code of one run needs from the runner. */
export interface StageContext {
  deps: JudgeRunnerDeps
  runId: string
  input: JudgeRunInput
  persist: Persist
  systemPrompt: string
  signal?: AbortSignal
  probeEvidence: Map<string, { before: string; after: string }>
}

type StageName = "ingestion" | "sanitizer" | "sandbox"

class SandboxCallFailed extends Error {
  constructor(readonly sandboxError: unknown) { super("sandbox call failed") }
}

export type Staged =
  | { kind: "ended"; terminal: TerminalCommit }
  | { kind: "passed"; pocCode?: string; claim?: DeconstructedClaim; bceSlices: BceSlice[]; sanitized?: SanitizedPoc; trace: string }

export type Tooling =
  { kind: "ready"; tools: ToolRegistryPort; traceDigest?: string } | { kind: "ended"; terminal: TerminalCommit }

/** One stage port call between `stage.started` and `stage.finished`; a throwing port is recorded as `failed`. */
const runStage = async <Result>(
  context: StageContext,
  stage: StageName,
  call: () => Promise<Result>,
  rejected: (result: Result) => string | undefined,
) => {
  const { clock } = context.deps
  const startedAt = clock.nowMs()
  const durationMs = () => Math.max(0, Math.round(clock.nowMs() - startedAt))
  await context.persist("stage.started", { stage })
  const result = await call().catch(async (error: unknown) => {
    await context.persist("stage.finished", { stage, outcome: "failed", durationMs: durationMs() })
    if (stage === "sandbox" && !context.signal?.aborted) throw new SandboxCallFailed(error)
    throw new StepFault("worker_interrupted", error)
  })
  const reasonCode = rejected(result)
  await context.persist("stage.finished", {
    stage,
    outcome: reasonCode === undefined ? "ok" : "rejected",
    ...(reasonCode === undefined ? {} : { reasonCode }),
    durationMs: durationMs(),
  })
  return result
}

/**
 * Stages 1-3 (design 4.1-4.3, D12) with cancellation boundary 1 before ingestion and before the sandbox. Any reject
 * ends the run `completed` with a fast-reject verdict; no model call is possible from here.
 */
export const runStages = async (context: StageContext): Promise<Staged> => {
  const { deps, runId, input, signal } = context
  const stage = { runId, snapshotId: input.snapshotId }
  const end = (terminal: TerminalCommit): Staged => ({ kind: "ended", terminal })
  const reject = (fastReject: FastReject) =>
    end({
      state: "completed",
      verdict: fastRejectVerdict({ runId, findingId: input.finding.findingId }, fastReject),
    })
  const cancelled = (boundary: CancellationBoundary) => end({ state: "cancelled", boundary })
  const sandboxFailure = (): Staged => ({ kind: "ended", terminal: { state: "completed", verdict: {
    runId, findingId: input.finding.findingId, validity: "unverified", verificationStatus: "UNVERIFIED",
    reasonCode: "EXECUTION_FAILED", confidence: "LOW", summary: "Sandbox execution did not establish a result.",
    reasoning: "The sandbox failed before reporting a validated test outcome.", citesEvidence: [],
  } } })

  const beforeIngestion = await checkBoundary(deps.cancellation, runId, "before_stages", { stage: "ingestion", signal })
  if (beforeIngestion.kind === "cancel") return cancelled(beforeIngestion.boundary)
  const ingested = await runStage(
    context,
    "ingestion",
    () => deps.ingestion.ingest({ ...stage, finding: input.finding }, signal),
    () => undefined,
  )
  if (ingested.kind === "narrative_only" && !isValidDeconstructedClaim(ingested.claim))
    return { kind: "ended", terminal: { state: "completed", verdict: { runId, findingId: input.finding.findingId, validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED", confidence: "LOW", summary: "The report claim is incomplete and cannot be verified.", reasoning: "The deconstructed claim lacks required target or semantic fields.", citesEvidence: [] } } }
  if (ingested.kind === "missing_poc") return reject({ reasonCode: "MISSING_POC" })
  if (ingested.kind === "narrative_only") {
    if (ingested.pocCode !== undefined) {
      const sanitized = await runStage(
        context,
        "sanitizer",
        () => deps.sanitizer.sanitize({ ...stage, pocCode: ingested.pocCode! }, signal),
        (result) => (result.kind === "cheat_detected" ? "NON_FAITHFUL_OVERRIDE" : undefined),
      )
      if (sanitized.kind === "cheat_detected")
        return reject({ reasonCode: "NON_FAITHFUL_OVERRIDE", findings: sanitized.findings })
      const beforeSandbox = await checkBoundary(deps.cancellation, runId, "before_stages", { stage: "sandbox", signal })
      if (beforeSandbox.kind === "cancel") return cancelled(beforeSandbox.boundary)
      let executed: Awaited<ReturnType<typeof deps.sandbox.runSingleShot>>
      try { executed = await runStage(context, "sandbox", () => deps.sandbox.runSingleShot({ ...stage, testFile: sanitized.stitchedTestFile }, signal), (result) => (result.outcome === "passed" ? undefined : "EXECUTION_FAILED")) }
      catch (error) { if (error instanceof SandboxCallFailed) return sandboxFailure(); throw error }
      if (executed.outcome !== "passed")
        return { kind: "ended", terminal: { state: "completed", verdict: {
          runId, findingId: input.finding.findingId, validity: "unverified", verificationStatus: "UNVERIFIED",
          reasonCode: "EXECUTION_FAILED", confidence: "LOW", summary: "Sandbox execution did not establish a result.",
          reasoning: "The sandbox did not report a validated test outcome; infrastructure, setup, timeout, or assertion status cannot be inferred from the process exit code.",
          citesEvidence: [], traceDigest: textDigest(executed.trace),
        } } }
      return { kind: "passed", pocCode: ingested.pocCode, claim: ingested.claim, bceSlices: ingested.bceSlices, sanitized, trace: executed.trace }
    }
    return { kind: "passed", claim: ingested.claim, bceSlices: ingested.bceSlices, trace: "" }
  }
  if (ingested.kind === "invalid_report") return end({ state: "failed", reason: "worker_interrupted", message: "report deconstruction failed" })
  if (ingested.pocCode === undefined) return { kind: "passed", claim: ingested.claim, bceSlices: ingested.bceSlices, trace: "" }
  const pocCode = ingested.pocCode

  const sanitized = await runStage(
    context,
    "sanitizer",
    () => deps.sanitizer.sanitize({ ...stage, pocCode }, signal),
    (result) => (result.kind === "cheat_detected" ? "NON_FAITHFUL_OVERRIDE" : undefined),
  )
  if (sanitized.kind === "cheat_detected")
    return reject({ reasonCode: "NON_FAITHFUL_OVERRIDE", findings: sanitized.findings })

  const beforeSandbox = await checkBoundary(deps.cancellation, runId, "before_stages", { stage: "sandbox", signal })
  if (beforeSandbox.kind === "cancel") return cancelled(beforeSandbox.boundary)
  let executed: Awaited<ReturnType<typeof deps.sandbox.runSingleShot>>
  try { executed = await runStage(context, "sandbox", () => deps.sandbox.runSingleShot({ ...stage, testFile: sanitized.stitchedTestFile }, signal), (result) => (result.outcome === "passed" ? undefined : "EXECUTION_FAILED")) }
  catch (error) { if (error instanceof SandboxCallFailed) return sandboxFailure(); throw error }
  if (executed.outcome !== "passed")
    return { kind: "ended", terminal: { state: "completed", verdict: {
      runId, findingId: input.finding.findingId, validity: "unverified", verificationStatus: "UNVERIFIED",
      reasonCode: "EXECUTION_FAILED", confidence: "LOW", summary: "Sandbox execution did not establish a result.",
      reasoning: "The sandbox did not report a validated test outcome; infrastructure, setup, timeout, or assertion status cannot be inferred from the process exit code.",
      citesEvidence: [], traceDigest: textDigest(executed.trace),
    } } }
  return { kind: "passed", pocCode, claim: ingested.claim, bceSlices: ingested.bceSlices, sanitized, trace: executed.trace }
}

const maxProbeRunsOf = (input: JudgeRunInput) => input.config.maxProbeRuns ?? DefaultMaxProbeRuns

/** The run's registry: the snapshot tools, plus `run_state_probe` only for a sanitized assertion-free PoC. */
const toolsFor = (context: StageContext, sanitized: SanitizedPoc, probeRunsUsed: number, claim?: DeconstructedClaim) => {
  const probe = stateProbeFor({
    sanitized,
    ...(claim === undefined ? {} : { claim }),
    stage: { runId: context.runId, snapshotId: context.input.snapshotId },
    sanitizer: context.deps.sanitizer,
    sandbox: context.deps.sandbox,
    security: context.deps.security,
    maxProbeRuns: maxProbeRunsOf(context.input),
    counter: createProbeCounter(probeRunsUsed),
    evidence: context.probeEvidence,
  })
  return composeTools(context.deps.tools, probe)
}

/**
 * Stage 4 entry (D12): the trace passes the security filter, then `shapeToolResult` (a truncation is recorded as
 * `context.transformed`), and the initial pinned items are built in cache order and each persisted.
 */
export const enterStageFour = async (
  context: StageContext,
  staged: Extract<Staged, { kind: "passed" }>,
): Promise<{ items: ContextItem[]; tools: ToolRegistryPort; traceDigest: string }> => {
  const { deps, input, signal } = context
  const tools = staged.sanitized === undefined ? deps.tools : toolsFor(context, staged.sanitized, 0, staged.claim)
  const filtered = await deps.security.filterSecrets(staged.trace, signal).catch(asFault("worker_interrupted"))
  const shaped = await deps.contextEngine
    .shapeToolResult({ content: filtered.content, toolName: "execution_trace", policy: input.config.policy })
    .catch(asFault("worker_interrupted"))
  const note = shaped.isTruncated ? shaped.continuationNote : undefined
  const shapedTrace =
    note !== undefined && !shaped.content.includes(note) ? `${shaped.content}\n${note}` : shaped.content
  const noPoc = staged.sanitized === undefined
  const items = buildInitialContext({
    runId: context.runId,
    snapshotId: input.snapshotId,
    finding: input.finding,
    pocCode: staged.pocCode ?? "",
    bceSlices: staged.bceSlices,
    tier: staged.sanitized?.hasSubmitterAssertions ? 1 : 2,
    ...(staged.claim === undefined ? {} : { claim: staged.claim }),
    maxProbeRuns: maxProbeRunsOf(input),
    systemPrompt: context.systemPrompt,
    tools: tools.definitions(),
    ...(deps.verdictSchema === undefined ? {} : { verdictSchema: deps.verdictSchema }),
    shapedTrace,
    ids: deps.ids,
  })
  if (staged.claim !== undefined && staged.claim.targetFunctions.length + staged.claim.targetContracts.length > 0) {
    items.push({
      id: deps.ids.next("itm_"),
      turn: 0,
      type: "system_prompt",
      isPinned: true,
      content: "Verification direction: forward",
    })
  }
  for (const item of items) await context.persist("context.item_added", { item })
  const traceItem = items.find((item) => item.type === "execution_trace")
  if (shaped.isTruncated && traceItem !== undefined)
    await context.persist("context.transformed", {
      action: "truncated",
      targetItemId: traceItem.id,
      tokensBefore: shaped.tokensBefore,
      tokensAfter: shaped.tokensAfter,
      replacementNote: note ?? "",
    })
  return { items, tools, traceDigest: textDigest(shapedTrace) }
}

/**
 * The registry after a takeover. A Tier 2 run (its persisted tool descriptions offer the probe) needs the stitched
 * test file again: the sanitizer is a stage port without model or sandbox work, so it is asked once more, silently.
 * The probe counter starts at the probe runs the history already requested.
 */
export const recoverTools = async (context: StageContext, history: HydratedHistory): Promise<Tooling> => {
  const { deps, runId, input, signal } = context
  const traceItem = history.items.find((item) => item.type === "execution_trace")
  const traceDigest = traceItem === undefined ? undefined : textDigest(traceItem.content)
  const probeOffered = history.items.some(
    (item) => item.type === "tool_description" && item.content.startsWith(`${RunStateProbeToolName}:`),
  )
  if (!probeOffered) return { kind: "ready", tools: deps.tools, traceDigest }
  const pocCode = history.items.find((item) => item.type === "submitter_poc")?.content ?? ""
  const sanitized = await deps.sanitizer
    .sanitize({ runId, snapshotId: input.snapshotId, pocCode }, signal)
    .catch(asFault("worker_interrupted"))
  if (sanitized.kind !== "ok")
    return {
      kind: "ended",
      terminal: {
        state: "failed",
        reason: "persistence_failure",
        message: "the sanitizer no longer accepts the persisted PoC, so the state probe cannot be restored",
      },
    }
  const claimItem = history.items.find((item) => item.type === "candidate_finding")
  const claim = claimItem === undefined ? undefined : (() => { try { return JSON.parse(claimItem.content.slice(claimItem.content.indexOf("\n") + 1)) as DeconstructedClaim } catch { return undefined } })()
  return { kind: "ready", tools: toolsFor(context, sanitized, history.probeRunsUsed, claim), traceDigest }
}
