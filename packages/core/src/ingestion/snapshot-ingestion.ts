import type { BceSlice, DeconstructedClaim, IngestionPort, IngestionResult, SourceSnapshotPort } from "@harness/protocol"

const MaxReportBytes = 64_000
const MaxSourceLines = 120
const prohibitedKey = /(?:ground.?truth|adjudication|scor(?:e|ing)|label)/i
const fields = ["Target", "Root cause", "Attack scenario", "Impact", "State"] as const

const hasProhibitedKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasProhibitedKey)
  if (typeof value !== "object" || value === null) return false
  return Object.entries(value).some(([key, child]) => prohibitedKey.test(key) || hasProhibitedKey(child))
}

const parseClaim = (report: string): { claim: DeconstructedClaim; pocCode?: string } | undefined => {
  const values = new Map<string, string>()
  for (const line of report.split(/\r?\n/)) {
    const match = /^(Target|Root cause|Attack scenario|Impact|State):\s*(.+)$/.exec(line.trim())
    if (match) values.set(match[1]!, match[2]!.trim())
  }
  if (fields.some((field) => !values.has(field))) return undefined
  const target = values.get("Target")!
  const [contract, functionName] = target.split(".", 2)
  if (!contract || !functionName || !/^[A-Za-z_$][\w$]*$/.test(contract) || !/^[A-Za-z_$][\w$]*$/.test(functionName)) return undefined
  const poc = /```(?:solidity|sol|forge)?\s*\n([\s\S]*?)```/i.exec(report)?.[1]?.trim()
  return {
    claim: {
      targetContracts: [contract], targetFunctions: [functionName], rootCause: values.get("Root cause")!,
      attackScenario: values.get("Attack scenario")!, callerAssumptions: [], claimedImpact: values.get("Impact")!, claimedState: values.get("State")!,
    },
    ...(poc ? { pocCode: poc } : {}),
  }
}

export class SnapshotIngestion implements IngestionPort {
  constructor(private readonly options: { source: SourceSnapshotPort; maxReportBytes?: number }) {}

  async ingest(input: Parameters<IngestionPort["ingest"]>[0], signal?: AbortSignal): Promise<IngestionResult> {
    const { reportMarkdown } = input.finding
    if (new TextEncoder().encode(reportMarkdown).byteLength > (this.options.maxReportBytes ?? MaxReportBytes)) return { kind: "invalid_report" }
    try {
      const jsonBlocks = [
        ...[...reportMarkdown.matchAll(/```json\s*\n([\s\S]*?)```/gi)].map((match) => match[1]!),
        ...(reportMarkdown.match(/\{[^{}]*\}/g) ?? []),
      ]
      if (jsonBlocks.some((block) => hasProhibitedKey(JSON.parse(block)))) return { kind: "invalid_report" }
      const prose = reportMarkdown.replace(/```(?:json|solidity|sol|forge)?[^\n]*\n[\s\S]*?```/gi, "")
      if (/(?:["'`]?(?:ground.?truth|adjudication|scor(?:e|ing)|label)[\w -]*["'`]?)\s*:/i.test(prose)) return { kind: "invalid_report" }
    } catch { return { kind: "invalid_report" } }
    const parsed = parseClaim(reportMarkdown)
    if (!parsed) return { kind: "incomplete", reason: "unsupported_report" }

    const paths = (await this.options.source.listFiles({ snapshotId: input.snapshotId }, signal))
      .filter((path) => !/(?:ground.?truth|adjudication|scor(?:e|ing))/i.test(path))
      .filter((path) => path.endsWith(".sol"))
      .sort()
    let exceededSourceBound = false
    for (const path of paths) {
      let read = await this.options.source.readLines({ snapshotId: input.snapshotId, path, startLine: 1, endLine: MaxSourceLines + 1 }, signal)
      if (read.kind === "out_of_range") {
        if (read.lineCount > MaxSourceLines) { exceededSourceBound = true; continue }
        read = await this.options.source.readLines({ snapshotId: input.snapshotId, path, startLine: 1, endLine: read.lineCount }, signal)
      } else if (read.kind === "ok") { exceededSourceBound = true; continue }
      if (read.kind !== "ok") continue
      if (!read.lines.some((line) => new RegExp(`\\bcontract\\s+${parsed.claim.targetContracts[0]}\\b`).test(line))) continue
      if (!read.lines.some((line) => new RegExp(`\\bfunction\\s+${parsed.claim.targetFunctions[0]}\\b`).test(line))) continue
      const bceSlices: BceSlice[] = [{ filePath: path, content: read.lines.join("\n"), lineRange: [1, read.lines.length] }]
      return { kind: "incomplete", reason: "bce_unavailable", ...parsed, bceSlices }
    }
    return { kind: "incomplete", reason: exceededSourceBound ? "bce_unavailable" : "target_not_found" }
  }
}
