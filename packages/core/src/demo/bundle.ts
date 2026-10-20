import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  EventPayloadSchemas,
  type AntiCheatFinding,
  type AttemptPurpose,
  type JudgeVerdict,
  type StateDelta,
  type TrajectoryEvent,
} from "@harness/protocol"
import type { JudgeRunResult } from "../runner/judge-runner"
import { estimateTokens } from "../testing/fake-context-engines"
import type { InvariantReport } from "./invariants"
import type { StageRecord } from "./recorder"

export const BundleFiles = [
  "01-verdict.json",
  "02-dossier.md",
  "03-trajectory.json",
  "04-exploit-proof.json",
  "05-context-economics.json",
  "06-event-stream.jsonl",
  "07-reliability.json",
] as const

export interface BundleInput {
  scenario: string
  result: JudgeRunResult
  /** The persisted events of the run. */
  events: readonly TrajectoryEvent[]
  /** The events as the live bus delivered them during the run. */
  streamed: readonly TrajectoryEvent[]
  stages: StageRecord
  invariants: InvariantReport
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const verdictOf = (result: JudgeRunResult): JudgeVerdict | undefined =>
  result.kind === "committed" ? result.verdict : undefined

/** The committed state and terminal reason, e.g. `budget_exhausted, max_steps`; the result kind when nothing committed. */
const endedAs = (result: JudgeRunResult) => {
  if (result.kind !== "committed") return result.kind
  return result.terminalReason === undefined ? result.state : `${result.state}, ${result.terminalReason}`
}

const eventsOf = (events: readonly TrajectoryEvent[], type: TrajectoryEvent["type"]) =>
  events.filter((event) => event.type === type)

const table = (header: string[], rows: string[][]) =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => cell.replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |`),
  ].join("\n")

/** Why pillar 4 has no execution, from the furthest stage the run reached. */
const noExecutionReason = (stages: StageRecord) => {
  if (stages.pocCode === undefined)
    return "No execution was performed: the candidate finding has no executable PoC, so the run was rejected at ingestion."
  if (stages.sanitizer?.kind === "cheat_detected")
    return "No execution was performed: the anti-cheat sanitizer rejected the PoC before it reached the sandbox."
  return "No execution was performed."
}

interface ExploitProof {
  applicable: boolean
  reason?: string
  pocCode: string | null
  execution?: { performed: true; exitCode: number; durationMs: number; rawTrace: string }
  stateDeltaTable: { rows: StateDelta[]; reason?: string }
  antiCheatReport: { rulesChecked: string[]; findings: AntiCheatFinding[]; passed: boolean } | { reason: string }
}

const exploitProof = ({ stages }: BundleInput): ExploitProof => {
  const { sanitizer, sandbox, stateProbes, pocCode } = stages
  if (pocCode === undefined || sandbox === undefined)
    return {
      applicable: false,
      reason: noExecutionReason(stages),
      pocCode: pocCode ?? null,
      antiCheatReport:
        sanitizer?.kind === "cheat_detected"
          ? { rulesChecked: [], findings: sanitizer.findings, passed: false }
          : { reason: "The sanitizer was not reached." },
      stateDeltaTable: { rows: [], reason: "No execution was performed, so no state was measured." },
    }
  const rows = stateProbes.filter((run) => run.exitCode === 0).flatMap((run) => run.stateDeltas)
  const failed = sandbox.exitCode !== 0
  return {
    applicable: true,
    pocCode,
    execution: { performed: true, exitCode: sandbox.exitCode, durationMs: sandbox.durationMs, rawTrace: sandbox.trace },
    stateDeltaTable: {
      rows,
      ...(rows.length > 0
        ? {}
        : {
            reason: failed
              ? "The PoC did not run to completion, so no state delta was measured."
              : "No state probe was requested: the PoC carries its own assertions (Tier 1).",
          }),
    },
    antiCheatReport:
      sanitizer?.kind === "ok"
        ? { ...sanitizer.antiCheatReport, passed: sanitizer.antiCheatReport.findings.length === 0 }
        : { reason: "The sanitizer did not report." },
  }
}

const proofSection = ({ execution, reason, stateDeltaTable, antiCheatReport }: ExploitProof) => {
  if (execution === undefined)
    return [
      reason ?? "",
      ...("findings" in antiCheatReport
        ? antiCheatReport.findings.map((finding) => `- ${finding.ruleId}: ${finding.message}`)
        : []),
      "",
    ].join("\n")
  return [
    `PoC exit code ${execution.exitCode}, ${execution.durationMs} ms.`,
    "",
    stateDeltaTable.rows.length === 0
      ? (stateDeltaTable.reason ?? "")
      : table(
          ["variable", "before", "after"],
          stateDeltaTable.rows.map((row) => [row.variable, row.before, row.after]),
        ),
    "",
  ].join("\n")
}

const dossier = (input: BundleInput, proof: ExploitProof) => {
  const verdict = verdictOf(input.result)
  if (verdict === undefined)
    return `# Audit dossier: ${input.scenario}\n\nThe run ended without a verdict (${endedAs(input.result)}), so there is nothing to report.\n`
  const { report, classification } = verdict
  const section = (title: string, body: string | undefined, absent: string) => `## ${title}\n\n${body ?? absent}\n`
  const na = "Not applicable: no model analysis was produced for this scenario."
  return [
    `# Audit dossier: ${input.scenario}`,
    "",
    `Finding \`${verdict.findingId}\` in run \`${verdict.runId}\`: **${verdict.validity}** (${verdict.verificationStatus}), reason \`${verdict.reasonCode}\`, confidence ${verdict.confidence}${verdict.severity === undefined ? "" : `, severity ${verdict.severity}`}.`,
    classification === undefined
      ? "Classification: not assigned."
      : `Classification: ${classification.name}${classification.standardId === undefined ? "" : ` (${classification.standardId})`}.`,
    "",
    section("Executive summary", report?.executiveSummary ?? verdict.summary, na),
    section("Reasoning", verdict.reasoning, na),
    section("Root cause", report?.rootCause, na),
    section("Attack path", report?.attackPath, na),
    section("Impact", report?.impact, na),
    section("Remediation", report?.remediation, na),
    "## Cited evidence\n",
    verdict.citesEvidence.length === 0
      ? "No source evidence is cited: the run ended before any source was examined.\n"
      : `${table(
          ["file", "lines", "explanation", "digest"],
          verdict.citesEvidence.map((item) => [
            item.filePath,
            `${item.startLine}-${item.endLine}`,
            item.explanation,
            item.contentDigest ?? "",
          ]),
        )}\n`,
    "## Exploit proof\n",
    proofSection(proof),
  ].join("\n")
}

const summaryOf = (input: BundleInput) => {
  const { events, result } = input
  const first = events.at(0)
  const last = events.at(-1)
  const started = first === undefined ? undefined : Date.parse(first.occurredAt)
  const finished = last === undefined ? undefined : Date.parse(last.occurredAt)
  const runStarted = eventsOf(events, "run.started").at(0)
  const committed = result.kind === "committed" ? result : undefined
  return {
    runId: result.runId,
    state: committed?.state ?? result.kind,
    terminalReason: committed?.terminalReason ?? null,
    observedLimits: committed?.observedLimits ?? [],
    steps: result.lastStepIndex,
    modelCalls: eventsOf(events, "provider.attempted").length,
    toolCalls: eventsOf(events, "tool.requested").length,
    usage: result.usage,
    startedAt: first?.occurredAt ?? null,
    finishedAt: last?.occurredAt ?? null,
    durationMs: started === undefined || finished === undefined ? 0 : finished - started,
    configSnapshot: runStarted?.payload.snapshot ?? null,
    snapshotDigest: runStarted?.payload.snapshotDigest ?? null,
  }
}

/** Approximate layer sizes: the items as persisted (before any engine transformation), by type, per step. */
const economics = ({ events, result }: BundleInput) => {
  const added: Record<string, number> = {}
  let pending: { action: string; targetItemId: string; tokensSaved: number }[] = []
  const steps: unknown[] = []
  for (const event of events) {
    if (event.type === "context.item_added") {
      const { item } = EventPayloadSchemas["context.item_added"].parse(event.payload)
      added[item.type] = (added[item.type] ?? 0) + estimateTokens(item.content)
    }
    if (event.type === "context.transformed") {
      const change = EventPayloadSchemas["context.transformed"].parse(event.payload)
      pending.push({
        action: change.action,
        targetItemId: change.targetItemId,
        tokensSaved: change.tokensBefore - change.tokensAfter,
      })
    }
    if (event.type === "context.allocated") {
      const { stepIndex, telemetry } = EventPayloadSchemas["context.allocated"].parse(event.payload)
      const attemptsOf = (purpose: AttemptPurpose) =>
        events
          .filter((other) => other.type === "provider.attempted")
          .map((other) => EventPayloadSchemas["provider.attempted"].parse(other.payload))
          .filter((payload) => payload.stepIndex === stepIndex && payload.purpose === purpose)
      const tokensOf = (payloads: ReturnType<typeof attemptsOf>) => {
        const known = payloads.flatMap((payload) => payload.usage?.totalTokens ?? [])
        return known.length === payloads.length ? known.reduce((sum, value) => sum + value, 0) : null
      }
      const costOf = (payloads: ReturnType<typeof attemptsOf>) => {
        const known = payloads.flatMap((payload) => payload.costUsd ?? [])
        return known.length === payloads.length ? known.reduce((sum, value) => sum + value, 0) : null
      }
      const attempts = attemptsOf("reasoning")
      const compaction = attemptsOf("compaction")
      const room = telemetry.windowLimitTokens - telemetry.outputReserveTokens
      steps.push({
        stepIndex,
        estimatedInputTokens: telemetry.estimatedInputTokens,
        windowLimitTokens: telemetry.windowLimitTokens,
        outputReserveTokens: telemetry.outputReserveTokens,
        windowFill: room > 0 ? Number((telemetry.estimatedInputTokens / room).toFixed(4)) : null,
        budgetRemainingTokens: telemetry.budgetRemainingTokens,
        tokensSaved: telemetry.tokensSaved + pending.reduce((sum, change) => sum + change.tokensSaved, 0),
        transformations: pending,
        itemTokensByType: { ...added },
        modelTokens: tokensOf(attempts),
        costUsd: costOf(attempts),
        compactionTokens: tokensOf(compaction),
        compactionCostUsd: costOf(compaction),
      })
      pending = []
    }
  }
  const tokensSaved = steps.reduce<number>((sum, step) => sum + (step as { tokensSaved: number }).tokensSaved, 0)
  return {
    tokenizerNote:
      "Token counts come from the stand-in context engine (characters / 4), not the authoritative o200k_base count.",
    totals: { ...result.usage, tokensSaved },
    steps,
    ...(steps.length === 0
      ? { reason: "No reasoning step ran: the run ended before any model call, so zero tokens were spent." }
      : {}),
  }
}

const reliability = ({ events, invariants }: BundleInput) => {
  const toolFailures = events.filter((event) => event.type === "tool.failed" || event.type === "security.blocked")
  return {
    crashFree: invariants.crashFree,
    violations: invariants.violations,
    checks: invariants.checks,
    recovery: {
      toolFailuresRecordedAsData: toolFailures.length,
      runEndedByToolFailure: eventsOf(events, "run.failed").length > 0 && toolFailures.length > 0,
    },
    stressEvidence: "The 100-run crash-free evidence is written by `bun run stress` to ../reliability-report.json.",
  }
}

/** The seven pillars of one run, keyed by file name. Pure: nothing is written and no model is called. */
export const renderBundle = (input: BundleInput): Record<(typeof BundleFiles)[number], string> => {
  const proof = exploitProof(input)
  const verdict = verdictOf(input.result)
  return {
    "01-verdict.json": json(verdict ?? { reason: `The run ended without a verdict (${endedAs(input.result)}).` }),
    "02-dossier.md": dossier(input, proof),
    "03-trajectory.json": json({ summary: summaryOf(input), events: input.events }),
    "04-exploit-proof.json": json(proof),
    "05-context-economics.json": json(economics(input)),
    "06-event-stream.jsonl": input.streamed
      .map((event) => JSON.stringify(event))
      .join("\n")
      .concat("\n"),
    "07-reliability.json": json(reliability(input)),
  }
}

export const writeBundle = (directory: string, files: Record<string, string>) => {
  mkdirSync(directory, { recursive: true })
  Object.entries(files).forEach(([name, content]) => writeFileSync(join(directory, name), content))
}
