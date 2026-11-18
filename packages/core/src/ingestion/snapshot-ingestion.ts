import type { DeconstructedClaim, IngestionPort, IngestionResult, SourceSnapshotPort } from "@harness/protocol"
import { draftClaim, missingFields, withExtracted, type ClaimDraft } from "./report-normalizer"
import { MaxResolutionLines, resolveTarget, type ResolvedTarget } from "./target-resolver"

const MaxReportBytes = 64_000
const prohibitedKey = /(?:ground.?truth|adjudication|scor(?:e|ing)|label)/i
// A metadata key in prose: one key token (no spaces, except "ground truth") right before a colon. Prose such as
// "Labeled Roles from _rolesSet ...: " or "guards label processing ...:" is report content, not metadata.
const prohibitedProseKey = /(?:^|[\s"'`{,])["'`]?[\w-]*(?:ground.?truth|adjudication|scor(?:e|ing)|label)[\w-]*["'`]?\s*:/im
const hasProhibitedKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasProhibitedKey)
  if (typeof value !== "object" || value === null) return false
  return Object.entries(value).some(([key, child]) => prohibitedKey.test(key) || hasProhibitedKey(child))
}

const toClaim = (draft: ClaimDraft, target: ResolvedTarget): DeconstructedClaim => ({
  targetContracts: [target.contract],
  targetFunctions: [target.functionName],
  rootCause: draft.rootCause ?? "",
  attackScenario: draft.attackScenario ?? "",
  callerAssumptions: draft.callerAssumptions,
  claimedImpact: draft.impact ?? "",
  claimedState: draft.state ?? "",
})

export class SnapshotIngestion implements IngestionPort {
  constructor(private readonly options: { source: SourceSnapshotPort; maxReportBytes?: number }) {}

  /** The first `MaxResolutionLines` lines of one file the report points to, to confirm a target named in it. */
  private async readForResolution(snapshotId: string, path: string, signal?: AbortSignal) {
    const read = await this.options.source.readLines({ snapshotId, path, startLine: 1, endLine: MaxResolutionLines }, signal)
    if (read.kind === "ok") return read.lines.join("\n")
    if (read.kind !== "out_of_range" || read.lineCount === 0) return undefined
    const whole = await this.options.source.readLines({ snapshotId, path, startLine: 1, endLine: read.lineCount }, signal)
    return whole.kind === "ok" ? whole.lines.join("\n") : undefined
  }

  async ingest(input: Parameters<IngestionPort["ingest"]>[0], signal?: AbortSignal): Promise<IngestionResult> {
    const { reportMarkdown } = input.finding
    if (new TextEncoder().encode(reportMarkdown).byteLength > (this.options.maxReportBytes ?? MaxReportBytes)) return { kind: "invalid_report" }
    try {
      const jsonBlocks = [...reportMarkdown.matchAll(/```json\s*\n([\s\S]*?)```/gi)].map((match) => match[1]!)
      if (jsonBlocks.some((block) => hasProhibitedKey(JSON.parse(block)))) return { kind: "invalid_report" }
      const prose = reportMarkdown.replace(/```(?:json|solidity|sol|forge)?[^\n]*\n[\s\S]*?```/gi, "")
      if (prohibitedProseKey.test(prose)) return { kind: "invalid_report" }
    } catch { return { kind: "invalid_report" } }
    // matchAll consumes fences pairwise; a single search could open at one block's closing fence and capture prose.
    const pocCode = [...reportMarkdown.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)]
      .find((fence) => /^(?:solidity|sol|forge)?\s*$/i.test(fence[1]!))?.[2]
      ?.trim()
    // Any platform's layout is mapped onto the claim fields by excerpt; the report itself is never rewritten.
    const draft = withExtracted(draftClaim(reportMarkdown), input.extracted, reportMarkdown)

    const paths = (await this.options.source.listFiles({ snapshotId: input.snapshotId }, signal))
      .filter((path) => !/(?:ground.?truth|adjudication|scor(?:e|ing))/i.test(path))
      .filter((path) => path.endsWith(".sol"))
      .sort()
    const target = await resolveTarget(draft.targets, paths, (path) => this.readForResolution(input.snapshotId, path, signal))
    const missing = missingFields(draft, target !== undefined)
    if (target === undefined || missing.length > 0) {
      const unresolvedTarget = target === undefined && draft.targets.length > 0 && missing.length === 1
      return { kind: "incomplete", reason: unresolvedTarget ? "target_not_found" : "unsupported_report", missingFields: missing }
    }
    // The model reads the source it needs through the snapshot tools; ingestion only maps the report onto a claim.
    return { kind: "narrative_only", claim: toClaim(draft, target), ...(pocCode ? { pocCode } : {}) }
  }
}
