import {
  DefaultMaxProbeRuns,
  isValidDeconstructedClaim,
  type BceSlice,
  type ClaimField,
  type ContextItem,
  type DeconstructedClaim,
  type IngestionResult,
  type StopReason,
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
import { MaxExtractionOutputTokens, claimExtractionItems, parseExtractedFields } from "../judge/claim-extraction"
import { structuredOutputPrompt, withSubmissionTools } from "../judge/structured-output"
import { SandboxUnverified, unverifiedVerdict, type VerdictWording } from "../judge/unverified-verdict"
import { isDeniedSourceFile } from "../source/source-snapshot"
import { textDigest } from "../util/digest"
import { checkBoundary, type CancellationBoundary } from "./cancellation"
import { fastRejectVerdict, type FastReject } from "./fast-reject"
import type { HydratedHistory } from "./history-hydrator"
import type { JudgeRunInput, JudgeRunnerDeps } from "./judge-runner"
import { StaleWrite, StepFault, asFault, attemptPayload, bounded, type Persist } from "./judge-step-support"
import type { AttemptRecord, RetryPolicy } from "./retry-policy"
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
  /** The run's retry policy and accounting, for the one stage that calls the model (claim extraction). */
  retryPolicy: RetryPolicy
  charge: (attempt: AttemptRecord) => void
  beforeRetry: () => StopReason | undefined
  deadlineMs: number
}

type StageName = "ingestion" | "claim_extraction" | "sanitizer" | "sandbox"

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
    // A refused write ends this worker's writes; a typed fault (a failed provider call) keeps its reason.
    if (error instanceof StaleWrite) throw error
    await context.persist("stage.finished", { stage, outcome: "failed", durationMs: durationMs() })
    if (stage === "sandbox" && !context.signal?.aborted) throw new SandboxCallFailed(error)
    throw error instanceof StepFault ? error : new StepFault("worker_interrupted", error)
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
  /** `missing` is set when the report only lacked claim fields, which claim extraction may still locate. */
  | { kind: "unresolved"; wording: VerdictWording; missing?: ClaimField[] }

const InvalidReport: VerdictWording = {
  summary: "The submitted report could not be safely interpreted.",
  reasoning:
    "Report input was malformed or contained prohibited metadata, so no provider or sandbox evaluation was attempted.",
}

const InvalidClaim: VerdictWording = {
  summary: "The report claim is incomplete and cannot be verified.",
  reasoning: "The deconstructed claim lacks required target or semantic fields.",
}

const fieldLabels: Record<ClaimField, string> = {
  target: "the target function",
  rootCause: "the root cause",
  attackOrImpact: "the attack scenario or impact",
}

const insufficient = (missing: readonly ClaimField[], extracted: boolean): VerdictWording => ({
  summary: "The report does not state enough to verify the claim.",
  reasoning: `The report does not state ${missing.map((field) => fieldLabels[field]).join(", ")}${
    extracted
      ? " in a form the snapshot confirms, even after the model was asked to locate them word for word in the report"
      : " in any recognized layout, and claim extraction is disabled for this run"
  }, so the finding remains unresolved and no reasoning step was run.`,
})

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
      if (ingested.kind === "incomplete" && ingested.missingFields !== undefined && ingested.missingFields.length > 0)
        return { kind: "unresolved", wording: insufficient(ingested.missingFields, false), missing: ingested.missingFields }
      if (ingested.claim === undefined) return { kind: "unresolved", wording: unmapped(ingested.kind === "incomplete" ? ingested.reason : ingested.kind) }
      if (!isValidDeconstructedClaim(ingested.claim)) return { kind: "unresolved", wording: InvalidClaim }
      return { kind: "judge", claim: ingested.claim, pocCode: pocOf(ingested.pocCode), bceSlices: ingested.bceSlices ?? [] }
    }
  }
}

/** The ingestion stage is `rejected` whenever the run ends there, so the trajectory says why no model was called. */
const admissionRejection = (admission: Admission) => {
  if (admission.kind === "judge") return undefined
  if (admission.kind === "fast_reject") return admission.reject.reasonCode
  return admission.missing === undefined ? "UNRESOLVED" : "CLAIM_INCOMPLETE"
}

type Extraction = { kind: "admitted"; admission: Admission } | { kind: "ended"; terminal: TerminalCommit; code: string }

/** One extraction attempt is a provider call: purpose `claim_extraction`, step 1, charged to the run as it happens. */
const ExtractionStep = 1

/**
 * Asks the model once to locate the missing claim fields in the report, then lets the ingestion port take the claim
 * again with them. The port keeps only verbatim excerpts and a target the snapshot confirms, so the model can point
 * at the report but never rewrite it; whatever is still missing makes the run truly unresolved.
 */
const extractClaim = async (context: StageContext, missing: readonly ClaimField[]): Promise<Extraction> => {
  const { deps, runId, input, signal } = context
  const { profileId, modelLimits } = input.config
  const sourcePaths = (await deps.snapshot.listFiles({ snapshotId: input.snapshotId }, signal))
    .filter((path) => path.endsWith(".sol") && !isDeniedSourceFile(path))
    .sort()
  const items = claimExtractionItems({
    reportMarkdown: input.finding.reportMarkdown,
    missing,
    sourcePaths,
    id: () => deps.ids.next("itm_"),
  })
  const outcome = await context.retryPolicy
    .run({
      request: {
        runId,
        stepIndex: ExtractionStep,
        profileId,
        items,
        toolsDisabled: true,
        maxOutputTokens: Math.min(modelLimits.maxOutputTokens, MaxExtractionOutputTokens),
      },
      deadlineMs: context.deadlineMs,
      signal,
      beforeRetry: context.beforeRetry,
      onAttempt: async (attempt) => {
        context.charge(attempt)
        await context.persist("provider.attempted", attemptPayload(ExtractionStep, "claim_extraction", profileId, attempt))
      },
    })
    .catch(asFault("worker_interrupted"))
  if (outcome.kind === "failed")
    throw new StepFault(outcome.reason, new Error(`claim extraction failed: ${bounded(outcome.error.message, 500)}`))
  if (outcome.kind === "context_overflow" || outcome.kind === "stopped") {
    const reason = outcome.kind === "stopped" ? outcome.reason : "context_budget_exhausted"
    return { kind: "ended", terminal: { state: "budget_exhausted", reason, observed: [reason] }, code: "BUDGET_EXHAUSTED" }
  }
  if (outcome.kind === "cancelled")
    return { kind: "ended", terminal: { state: "cancelled", boundary: "before_provider_call" }, code: "CANCELLED" }
  const extracted = parseExtractedFields(outcome.response.content ?? "")
  const ingested = await deps.ingestion.ingest(
    { runId, snapshotId: input.snapshotId, finding: input.finding, ...(extracted === undefined ? {} : { extracted }) },
    signal,
  )
  const admission = admit(ingested)
  return {
    kind: "admitted",
    admission:
      admission.kind === "unresolved" && admission.missing !== undefined
        ? { ...admission, wording: insufficient(admission.missing, true) }
        : admission,
  }
}

/**
 * Stages 1-3 (design 4.1-4.3, D12) with cancellation boundary 1 before ingestion and before the sandbox. A reject ends
 * the run `completed` with a fast-reject verdict, an unusable report or a sandbox without a validated outcome ends it
 * `unverified`. The only model call possible here is claim extraction, when the run enables it and the report's
 * layout left claim fields missing.
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
  let admission = admit(ingested)
  if (admission.kind === "unresolved" && admission.missing !== undefined && input.config.enableClaimExtraction === true) {
    const missing = admission.missing
    const extraction = await runStage(
      context,
      "claim_extraction",
      () => extractClaim(context, missing),
      (result) => (result.kind === "ended" ? result.code : result.admission.kind === "judge" ? undefined : "INSUFFICIENT_REPORT"),
    )
    if (extraction.kind === "ended") return end(extraction.terminal)
    admission = extraction.admission
  }
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
