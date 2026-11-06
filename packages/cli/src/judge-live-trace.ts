import { createEvidenceTracker, type EvidenceNovelty } from "@harness/core"
import type { ContextItem, TrajectoryEvent } from "@harness/protocol"

/** Longest model text or tool argument shown on one line; the full text stays in the persisted events. */
const MaxShownChars = 240

const oneLine = (text: string, max = MaxShownChars) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const tokens = (count: number) => (count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count))

const novelty = (added: EvidenceNovelty) =>
  added.kind === "lines" ? (added.newLines > 0 ? `${added.newLines} new lines` : "nothing new") : added.isNew ? "new" : "nothing new"

const harnessMarkers = /^(Verification direction: \w+|Bidirectional (forward|backward) result: .*|Bidirectional consensus: .*)$/m

/**
 * Turns the events of a live Judge run into short human-readable lines, one or more per event, so a person can follow
 * each step while the run is going: the model call, the tools it asks for, what each read or search returns (and
 * whether it added lines not seen before, counted as the evidence-saturation rule counts them), the model's own words,
 * the direction results, the consensus and the verdict. Stateful: it tracks the evidence already seen to mark repeats.
 */
export const createJudgeLiveTrace = () => {
  const evidence = createEvidenceTracker()

  return (event: TrajectoryEvent): string[] => {
    const payload = event.payload as Record<string, any>
    switch (event.type) {
      case "stage.finished":
        return [`[stage] ${payload.stage} ${payload.outcome}${payload.reasonCode ? ` (${payload.reasonCode})` : ""}`]
      case "step.started":
        return [`── step ${payload.stepIndex}${payload.toolsDisabled ? " (forced: must answer now)" : ""}`]
      case "provider.attempted": {
        const usage = payload.usage as { totalTokens?: number } | null
        const kind = payload.errorClassification ? `${payload.errorCategory}/${payload.errorClassification}` : payload.errorCategory
        const reason = payload.errorMessage ? `: ${oneLine(String(payload.errorMessage), 160)}` : ""
        const error = payload.errorCategory ? ` ERROR ${kind} (${payload.retryDecision})${reason}` : ""
        return [
          `   model call ${payload.purpose} #${payload.attemptIndex}: ${tokens(usage?.totalTokens ?? 0)} tokens, ${(payload.latencyMs / 1000).toFixed(1)}s${error}`,
        ]
      }
      case "model.responded":
        return [`   model → ${payload.toolCallCount > 0 ? `${payload.toolCallCount} tool call(s)` : `answer (${payload.finishReason})`}`]
      case "tool.requested":
        return [`   → ${payload.toolName} ${oneLine(JSON.stringify(payload.arguments ?? {}), 160)}${payload.argumentsError ? ` (bad arguments: ${payload.argumentsError})` : ""}`]
      case "tool.failed":
        return [`   ✗ ${payload.toolName}: ${oneLine(String(payload.message ?? ""), 160)}`]
      case "verdict.validation_failed":
        return [`   ✗ answer rejected (attempt ${payload.attempt}): ${(payload.issues as { reason: string; path: unknown[] }[]).map((issue) => `${issue.reason} ${issue.path.join(".") || "(root)"}`).join(", ")}`]
      case "context.compacted":
        return [`   context compacted: ${payload.replacedItemIds?.length ?? 0} items summarized`]
      case "context.item_added": {
        const item = payload.item as ContextItem
        if (item.type === "assistant_reasoning") return [`   model says: ${oneLine(item.content)}`]
        if (item.type === "tool_result" && item.toolMeta !== undefined && item.toolMeta.isError !== true) {
          const { toolName, filePath, lineRange } = item.toolMeta
          const added = novelty(evidence(item))
          if (filePath !== undefined && lineRange !== undefined)
            return [`   ← ${toolName} ${filePath}:${lineRange[0]}-${lineRange[1]} (${added})`]
          return [`   ← ${toolName}: ${item.content.split("\n").length} lines of output (${added})`]
        }
        if ((item.type === "system_prompt" || item.type === "harness_instruction") && item.turn > 0) {
          const marker = harnessMarkers.exec(item.content)?.[0]
          if (marker !== undefined) return [`   ★ ${oneLine(marker)}`]
          return [`   harness: ${oneLine(item.content, 160)}`]
        }
        return []
      }
      case "run.completed": {
        const verdict = payload.verdict as { validity: string; verificationStatus: string; reasonCode: string; summary: string } | undefined
        return [verdict ? `■ verdict ${verdict.validity}/${verdict.verificationStatus}/${verdict.reasonCode}: ${oneLine(verdict.summary)}` : "■ run completed"]
      }
      case "run.failed":
        return [`■ run failed (${payload.reason}): ${oneLine(String(payload.message ?? ""))}`]
      case "run.budget_exhausted":
        return [`■ run stopped: budget exhausted (${payload.reason})`]
      case "run.cancelled":
        return [`■ run cancelled (${payload.boundary})`]
      default:
        return []
    }
  }
}
