import type { RunStorePort, TrajectoryEvent } from "@harness/protocol"
import { digestOf, getMultiTurnExecutionSummary, getRun, getRunHistory } from "@harness/core"
import { redactSecrets } from "../redaction"

export interface ViewCommandOptions {
  id?: string
  json?: boolean
  help?: boolean
}

export interface ViewCommandDeps {
  store: RunStorePort
  secrets?: string[]
}

/** Views a persisted run record and its chronological trajectory events. */
export async function executeViewCommand(
  options: ViewCommandOptions,
  deps: ViewCommandDeps,
): Promise<{ exitCode: number; output: string }> {
  const runId = options.id?.trim()
  if (!runId) return { exitCode: 1, output: "Error: --id <runId> is required to view a run." }

  const run = await getRun(runId, deps.store)
  if (!run) return { exitCode: 1, output: `Error: Run '${runId}' not found in persistent store.` }

  const events = await getRunHistory(runId, deps.store)
  const secrets = deps.secrets ?? []
  const isMultiTurn = run.snapshotId !== undefined || events.some(
    (event) => event.type === "context.item_added" || event.type.startsWith("tool."),
  )

  const completedEvent = events.findLast((event) => event.type === "run.completed")
  const verdict = (completedEvent?.payload as { verdict?: import("@harness/protocol").JudgeVerdict } | undefined)?.verdict
  // Stage events are Judge-only, so a Judge run that failed before a verdict is still shown as one.
  const isJudge = Boolean(run.findingId || verdict || events.some((event) => event.type === "stage.started"))

  if (isJudge) {
    if (options.json) {
      return {
        exitCode: 0,
        output: JSON.stringify({
          runId: run.runId,
          state: run.state,
          stateVersion: run.stateVersion,
          terminalReason: run.terminalReason,
          snapshotId: run.snapshotId,
          findingId: run.findingId,
          verdict: verdict ?? null,
          events: events.map((e) => ({ sequence: e.sequence, type: e.type, occurredAt: e.occurredAt })),
        }, null, 2),
      }
    }
    const lines = [
      "========================================",
      "Judge Run Inspection Record",
      "========================================",
      `Run ID:              ${run.runId}`,
      `State:               ${run.state}`,
      `Version:             ${run.stateVersion}`,
      ...(run.terminalReason ? [`Terminal:            ${run.terminalReason}`] : []),
      ...(run.snapshotId ? [`Snapshot ID:         ${run.snapshotId}`] : []),
      ...(run.findingId ? [`Finding ID:          ${run.findingId}`] : []),
      "----------------------------------------",
      ...(verdict
        ? [
            "Judge Verdict:",
            `  Validity:          ${verdict.validity}`,
            `  Status:            ${verdict.verificationStatus}`,
            `  Confidence:        ${verdict.confidence}`,
            `  Reason Code:       ${verdict.reasonCode}`,
            `  Summary:           ${verdict.summary}`,
            `  Reasoning:         ${verdict.reasoning}`,
            "  Cites Evidence:",
            ...(verdict.citesEvidence.length === 0
              ? ["    (none)"]
              : verdict.citesEvidence.map(
                  (c) => `    - ${c.filePath}:${c.startLine}-${c.endLine}${c.contentDigest ? ` (digest: ${c.contentDigest})` : ""}`,
                )),
          ]
        : ["Judge Verdict:       (none)"]),
      "----------------------------------------",
      `Trajectory Events (${events.length} recorded):`,
    ]
    if (events.length === 0) lines.push("  (no events recorded)")
    else for (const event of events) lines.push(formatEvent(event, secrets))
    lines.push("========================================")
    return { exitCode: 0, output: lines.join("\n") }
  }

  if (isMultiTurn) {
    const summary = await getMultiTurnExecutionSummary(runId, deps.store)
    if (!summary) return { exitCode: 1, output: `Error: Run '${runId}' not found in persistent store.` }
    const redactedSummary = JSON.parse(redactSecrets(JSON.stringify(summary), secrets)) as typeof summary
    const { events: _events, attempts: _attempts, prompt: _prompt, toolCalls: rawToolCalls, ...boundedSummary } = redactedSummary
    const safeSummary = {
      ...boundedSummary,
      toolCalls: rawToolCalls.map(({ resultContent: _resultContent, ...call }) => call),
      promptDigest: digestOf(summary.prompt ?? ""),
    }
    if (options.json) return { exitCode: 0, output: JSON.stringify(safeSummary, null, 2) }
    const lines = [
      "========================================",
      "Multi-turn Run Inspection",
      "========================================",
      `Run ID:       ${summary.runId}`,
      `State:        ${summary.state}`,
      ...(summary.terminalReason ? [`Terminal:     ${summary.terminalReason}`] : []),
      ...(summary.snapshotId ? [`Snapshot ID:  ${summary.snapshotId}`] : []),
      `Prompt digest: ${digestOf(summary.prompt ?? "")}`,
      `Limits:       ${JSON.stringify(summary.limits ?? {})}`,
      `Tool limits:  ${JSON.stringify(summary.toolLimits ?? {})}`,
      `Observed:     ${JSON.stringify(summary.observedLimits ?? [])}`,
      ...(summary.contextTelemetry.length ? [`Context telemetry: ${JSON.stringify(summary.contextTelemetry)}`] : []),
      "----------------------------------------",
    ]
    for (const step of summary.steps) {
      lines.push(
        `Step ${step.stepIndex} attempt ${step.attemptNumber}: ${step.model}`,
        `  Finish: ${step.finishReason ?? "unknown"}`,
        `  Tokens: ${step.totalTokens} (prompt ${step.promptTokens}, completion ${step.completionTokens})`,
        `  Cost: ${
          step.pricing === "unpriced" || step.costUsd === null ? "unknown" : `$${step.costUsd.toFixed(6)} USD`
        }`,
        `  Latency: ${step.latencyMs} ms`,
      )
      for (const call of summary.toolCalls.filter((item) => item.stepIndex === step.stepIndex)) {
        const preview = (call.resultContent ?? call.message ?? "").slice(0, 300)
        lines.push(
          `  Tool ${call.toolName}: ${call.status}`,
          `    Args: ${JSON.stringify(call.arguments)}`,
          `    Duration: ${call.durationMs ?? "-"} ms`,
          `    Truncated: ${call.isTruncated === true}`,
          `    Preview: ${redactSecrets(preview, secrets)}`,
        )
      }
    }
    if (summary.outputTruncated === true) lines.push("Output truncated: true")
    lines.push("========================================")
    return { exitCode: 0, output: redactSecrets(lines.join("\n"), secrets) }
  }

  const isUnpriced = events.some((event) => {
    if (event.type !== "provider.attempted") return false
    const usage = (event.payload as { usage?: { pricing?: string } }).usage
    return usage?.pricing === "unpriced"
  })
  const lines = [
    "========================================",
    "Run Inspection Record",
    "========================================",
    `Run ID:       ${run.runId}`,
    `State:        ${run.state}`,
    `Version:      ${run.stateVersion}`,
    ...(run.terminalReason ? [`Terminal:     ${run.terminalReason}`] : []),
    ...(run.modelProfile ? [`Model:        ${run.modelProfile}`] : []),
    ...(run.latencyMs !== undefined ? [`Latency:      ${run.latencyMs}ms`] : []),
    ...(run.costUsd !== undefined
      ? [`Cost:         ${isUnpriced || run.costUsd === null ? "unknown" : `$${Number(run.costUsd).toFixed(6)}`}`]
      : []),
    ...(run.totalTokens !== undefined || run.promptTokens !== undefined || run.completionTokens !== undefined
      ? [`Tokens:       ${run.totalTokens ?? 0} (prompt: ${run.promptTokens ?? 0}, ` +
        `completion: ${run.completionTokens ?? 0})`]
      : []),
    ...(run.prompt ? ["Prompt:", redactSecrets(run.prompt, secrets)] : []),
    ...(run.resultContent ? ["Model Output:", redactSecrets(run.resultContent, secrets)] : []),
    ...(run.errorMessage
      ? [`Error (${run.errorCategory ?? "unknown"}):`, redactSecrets(run.errorMessage, secrets)]
      : []),
    "----------------------------------------",
    `Trajectory Events (${events.length} recorded):`,
  ]
  if (events.length === 0) lines.push("  (no events recorded)")
  else for (const event of events) lines.push(formatEvent(event, secrets))
  lines.push("========================================")
  return { exitCode: 0, output: lines.join("\n") }
}

function formatEvent(event: TrajectoryEvent, secrets: readonly string[]): string {
  const payload = redactSecrets(JSON.stringify(event.payload), secrets)
  return `  [#${event.sequence}] ${event.occurredAt} | ${event.type} | ${payload}`
}
