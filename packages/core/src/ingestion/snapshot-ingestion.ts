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

const parseClaim = (report: string, pocCode?: string): { claim: DeconstructedClaim; pocCode?: string } | undefined => {
  const values = new Map<string, string>()
  for (const line of report.split(/\r?\n/)) {
    const match = /^(Target|Root cause|Attack scenario|Impact|State):\s*(.+)$/.exec(line.trim())
    if (match) values.set(match[1]!, match[2]!.trim())
  }
  if (fields.some((field) => !values.has(field))) return undefined
  const target = values.get("Target")!
  const [contract, functionName] = target.split(".", 2)
  if (!contract || !functionName || !/^[A-Za-z_$][\w$]*$/.test(contract) || !/^[A-Za-z_$][\w$]*$/.test(functionName)) return undefined
  return {
    claim: {
      targetContracts: [contract], targetFunctions: [functionName], rootCause: values.get("Root cause")!,
      attackScenario: values.get("Attack scenario")!, callerAssumptions: [], claimedImpact: values.get("Impact")!, claimedState: values.get("State")!,
    },
    ...(pocCode ? { pocCode } : {}),
  }
}

const sourceWithoutComments = (source: string): string | undefined => {
  let result = ""
  let quote = ""
  let lineComment = false
  let blockComment = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    const next = source[i + 1]
    if (lineComment) {
      if (char === "\n") { lineComment = false; result += char }
      else result += " "
    } else if (blockComment) {
      if (char === "*" && next === "/") { result += "  "; i++; blockComment = false }
      else result += char === "\n" ? "\n" : " "
    } else if (quote) {
      result += char
      if (char === "\\" && next !== undefined) { result += next; i++ }
      else if (char === quote) quote = ""
    } else if (char === "'" || char === '"') {
      quote = char
      result += char
    } else if (char === "/" && next === "/") {
      lineComment = true
      result += "  "
      i++
    } else if (char === "/" && next === "*") {
      blockComment = true
      result += "  "
      i++
    } else result += char
  }
  return quote || blockComment || lineComment ? undefined : result
}

const hasTargetInContract = (source: string, contract: string, functionName: string) => {
  const code = sourceWithoutComments(source)
  if (code === undefined) return false
  const declaration = new RegExp(`\\b(?:abstract\\s+)?contract\\s+${contract}\\b[^\\{]*\\{`, "g")
  for (const match of code.matchAll(declaration)) {
    const start = match.index! + match[0].length
    let depth = 1
    let end = start
    for (; end < code.length && depth > 0; end++) {
      if (code[end] === "{") depth++
      else if (code[end] === "}") depth--
    }
    if (depth === 0 && new RegExp(`\\bfunction\\s+${functionName}\\b`).test(code.slice(start, end - 1))) return true
  }
  return false
}

export class SnapshotIngestion implements IngestionPort {
  constructor(private readonly options: { source: SourceSnapshotPort; maxReportBytes?: number }) {}

  async ingest(input: Parameters<IngestionPort["ingest"]>[0], signal?: AbortSignal): Promise<IngestionResult> {
    const { reportMarkdown } = input.finding
    if (new TextEncoder().encode(reportMarkdown).byteLength > (this.options.maxReportBytes ?? MaxReportBytes)) return { kind: "invalid_report" }
    try {
      const jsonBlocks = [...reportMarkdown.matchAll(/```json\s*\n([\s\S]*?)```/gi)].map((match) => match[1]!)
      if (jsonBlocks.some((block) => hasProhibitedKey(JSON.parse(block)))) return { kind: "invalid_report" }
      const prose = reportMarkdown.replace(/```(?:json|solidity|sol|forge)?[^\n]*\n[\s\S]*?```/gi, "")
      if (/(?:["'`]?(?:ground.?truth|adjudication|scor(?:e|ing)|label)[\w -]*["'`]?)\s*:/i.test(prose)) return { kind: "invalid_report" }
    } catch { return { kind: "invalid_report" } }
    const pocCode = /```(?:solidity|sol|forge)?\s*\n([\s\S]*?)```/i.exec(reportMarkdown)?.[1]?.trim()
    const prose = reportMarkdown.replace(/```[^\n]*\n[\s\S]*?```/gi, "")
    const parsed = parseClaim(prose, pocCode)
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
      if (!hasTargetInContract(read.lines.join("\n"), parsed.claim.targetContracts[0]!, parsed.claim.targetFunctions[0]!)) continue
      const bceSlices: BceSlice[] = [{ filePath: path, content: read.lines.join("\n"), lineRange: [1, read.lines.length] }]
      return { kind: "incomplete", reason: "bce_unavailable", ...parsed, bceSlices }
    }
    return { kind: "incomplete", reason: exceededSourceBound ? "bce_unavailable" : "target_not_found" }
  }
}
