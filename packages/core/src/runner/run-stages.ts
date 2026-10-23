import {
  DefaultMaxProbeRuns,
  isValidDeconstructedClaim,
  type BceSlice,
  type ContextItem,
  type DeconstructedClaim,
  type IngestionResult,
  type ToolRegistryPort,
} from "@harness/protocol"
import {
  RunStateProbeToolName,
  buildInitialContext,
  claimFromItems,
  composeTools,
  createProbeCounter,
  selectTier,
  stateProbeFor,
  type SanitizedPoc,
} from "../judge/adjudication-step"
import { structuredOutputPrompt, withSubmissionTools } from "../judge/structured-output"
import { SandboxUnverified, unverifiedVerdict, type VerdictWording } from "../judge/unverified-verdict"
import { textDigest } from "../util/digest"
import { checkBoundary, type CancellationBoundary } from "./cancellation"
import { fastRejectVerdict, type FastReject } from "./fast-reject"
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
  | { kind: "passed"; pocCode?: string; claim?: DeconstructedClaim; bceSlices: BceSlice[]; bceIncomplete: boolean; sanitized?: SanitizedPoc; trace: string }

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

/** What an ingestion result means for the run: a claim to judge, a zero-token fast-reject, or an unresolved end. */
type Admission =
  | { kind: "judge"; claim?: DeconstructedClaim; pocCode?: string; bceSlices: BceSlice[] }
  | { kind: "fast_reject"; reject: FastReject }
  | { kind: "unresolved"; wording: VerdictWording }

const InvalidReport: VerdictWording = {
  summary: "The submitted report could not be safely interpreted.",
  reasoning:
    "Report input was malformed or contained prohibited metadata, so no provider or sandbox evaluation was attempted.",
}

const InvalidClaim: VerdictWording = {
  summary: "The report claim is incomplete and cannot be verified.",
  reasoning: "The deconstructed claim lacks required target or semantic fields.",
}

const unmapped = (reason: string): VerdictWording => ({
  summary: "The report or source context could not be mapped completely.",
  reasoning: `Ingestion was incomplete (${reason}); no structured claim or source evidence was available, so the finding remains unresolved.`,
})

/** An empty PoC is no PoC. */
const pocOf = (pocCode: string | undefined) => (pocCode === undefined || pocCode.trim() === "" ? undefined : pocCode)

const admit = (ingested: IngestionResult): Admission => {
  switch (ingested.kind) {
    case "missing_poc":
      return { kind: "fast_reject", reject: { reasonCode: "MISSING_POC" } }
    case "invalid_report":
      return { kind: "unresolved", wording: InvalidReport }
    case "ok":
      // A malformed claim next to a PoC is dropped: the PoC is still judged, without claim-driven verification.
      return {
        kind: "judge",
        pocCode: pocOf(ingested.pocCode),
        bceSlices: ingested.bceSlices,
        ...(ingested.claim !== undefined && isValidDeconstructedClaim(ingested.claim) ? { claim: ingested.claim } : {}),
      }
    case "incomplete":
    case "narrative_only": {
      if (ingested.claim === undefined) return { kind: "unresolved", wording: unmapped(ingested.kind === "incomplete" ? ingested.reason : ingested.kind) }
      if (!isValidDeconstructedClaim(ingested.claim)) return { kind: "unresolved", wording: InvalidClaim }
      return { kind: "judge", claim: ingested.claim, pocCode: pocOf(ingested.pocCode), bceSlices: ingested.bceSlices ?? [] }
    }
  }
}

/** The ingestion stage is `rejected` whenever the run ends there, so the trajectory says why no model was called. */
const admissionRejection = (admission: Admission) =>
  admission.kind === "judge" ? undefined : admission.kind === "fast_reject" ? admission.reject.reasonCode : "UNRESOLVED"

/**
 * Stages 1-3 (design 4.1-4.3, D12) with cancellation boundary 1 before ingestion and before the sandbox. A reject ends
 * the run `completed` with a fast-reject verdict, an unusable report or a sandbox without a validated outcome ends it
 * `unverified`; no model call is possible from here.
 */
export const runStages = async (context: StageContext): Promise<Staged> => {
  const { deps, runId, input, signal } = context
  const stage = { runId, snapshotId: input.snapshotId }
  const identity = { runId, findingId: input.finding.findingId }
  const end = (terminal: TerminalCommit): Staged => ({ kind: "ended", terminal })
  const reject = (fastReject: FastReject) =>
    end({ state: "completed", verdict: fastRejectVerdict(identity, fastReject) })
  const unverified = (wording: VerdictWording, reasonCode: "UNRESOLVED" | "EXECUTION_FAILED", traceDigest?: string) =>
    end({ state: "completed", verdict: unverifiedVerdict({ ...identity, ...(traceDigest === undefined ? {} : { traceDigest }) }, reasonCode, wording) })
  const cancelled = (boundary: CancellationBoundary) => end({ state: "cancelled", boundary })

  const beforeIngestion = await checkBoundary(deps.cancellation, runId, "before_stages", { stage: "ingestion", signal })
  if (beforeIngestion.kind === "cancel") return cancelled(beforeIngestion.boundary)
  const ingested = await runStage(
    context,
    "ingestion",
    () => deps.ingestion.ingest({ ...stage, finding: input.finding }, signal),
    (result) => admissionRejection(admit(result)),
  )
  const admission = admit(ingested)
  if (admission.kind === "fast_reject") return reject(admission.reject)
  if (admission.kind === "unresolved") return unverified(admission.wording, "UNRESOLVED")

  // No ingestion port certifies a complete BCE yet (`IngestionResult` has no such status), so every judged claim is
  // marked incomplete: a missing call-graph edge must never turn into a negative, and no model verdict leaves
  // UNVERIFIED before verification (proposal 4, timeline sprint 9-10).
  const judged = { claim: admission.claim, bceSlices: admission.bceSlices, bceIncomplete: true }
  const { pocCode } = admission
  if (pocCode === undefined) return { kind: "passed", ...judged, trace: "" }
  if (!input.config.enablePocExecution) return { kind: "passed", ...judged, pocCode, trace: "" }

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
  const executed = await runStage(
    context,
    "sandbox",
    () => deps.sandbox.runSingleShot({ ...stage, testFile: sanitized.stitchedTestFile }, signal),
    (result) => (result.outcome === "passed" ? undefined : "EXECUTION_FAILED"),
  ).catch((error: unknown) => {
    if (error instanceof SandboxCallFailed) return undefined
    throw error
  })
  // An infrastructure failure or a failing exit code never becomes an invalid finding.
  if (executed === undefined)
    return unverified(
      { summary: SandboxUnverified.summary, reasoning: "The sandbox failed before reporting a validated test outcome." },
      "EXECUTION_FAILED",
    )
  if (executed.outcome !== "passed") return unverified(SandboxUnverified, "EXECUTION_FAILED", textDigest(executed.trace))
  return { kind: "passed", ...judged, pocCode, sanitized, trace: executed.trace }
}

const maxProbeRunsOf = (input: JudgeRunInput) => input.config.maxProbeRuns ?? DefaultMaxProbeRuns

const structured = (input: JudgeRunInput) => input.config.enableStructuredOutput === true

/**
 * The run's registry in a fixed order, so a takeover rebuilds the definitions it persisted: the snapshot tools,
 * `run_state_probe` only for a sanitized assertion-free PoC, then the submission tools when output is structured.
 */
const runTools = (context: StageContext, probe?: { sanitized: SanitizedPoc; probeRunsUsed: number; claim?: DeconstructedClaim }) => {
  const base = probe === undefined ? context.deps.tools : probeTools(context, probe.sanitized, probe.probeRunsUsed, probe.claim)
  return structured(context.input) ? withSubmissionTools(base) : base
}

const probeTools = (context: StageContext, sanitized: SanitizedPoc, probeRunsUsed: number, claim?: DeconstructedClaim) => {
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
  const tools = runTools(
    context,
    staged.sanitized === undefined ? undefined : { sanitized: staged.sanitized, probeRunsUsed: 0, claim: staged.claim },
  )
  const verifiesClaim = staged.claim !== undefined && input.config.enableBidirectionalVerification !== false
  const filtered = await deps.security.filterSecrets(staged.trace, signal).catch(asFault("worker_interrupted"))
  const shaped = await deps.contextEngine
    .shapeToolResult({ content: filtered.content, toolName: "execution_trace", policy: input.config.policy })
    .catch(asFault("worker_interrupted"))
  const note = shaped.isTruncated ? shaped.continuationNote : undefined
  const shapedTrace =
    note !== undefined && !shaped.content.includes(note) ? `${shaped.content}\n${note}` : shaped.content
  const items = buildInitialContext({
    runId: context.runId,
    snapshotId: input.snapshotId,
    finding: input.finding,
    pocCode: staged.pocCode ?? "",
    bceSlices: staged.bceSlices,
    bceIncomplete: staged.bceIncomplete,
    ...(staged.sanitized === undefined ? {} : { tier: selectTier(staged.sanitized) }),
    ...(staged.claim === undefined ? {} : { claim: staged.claim }),
    ...(verifiesClaim ? { verificationDirection: "forward" as const } : {}),
    maxProbeRuns: maxProbeRunsOf(input),
    systemPrompt: context.systemPrompt,
    tools: tools.definitions(),
    ...(deps.verdictSchema === undefined ? {} : { verdictSchema: deps.verdictSchema }),
    ...(structured(input) ? { structuredOutputInstruction: structuredOutputPrompt().text } : {}),
    shapedTrace,
    ids: deps.ids,
  })
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
  if (!probeOffered || !input.config.enablePocExecution) return { kind: "ready", tools: runTools(context), traceDigest }
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
  // The claim item, not the report (both are `candidate_finding`): without it the probe would silently disappear.
  const probe = { sanitized, probeRunsUsed: history.probeRunsUsed, claim: claimFromItems(history.items) }
  return { kind: "ready", tools: runTools(context, probe), traceDigest }
}
