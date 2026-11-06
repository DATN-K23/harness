import type { ClaimField, ExtractedClaimFields } from "@harness/protocol"

/** The report layouts the normalizer recognizes; `markdown` is any other sectioned report. */
export type ReportFormat = "harness" | "hound" | "code4rena" | "sherlock" | "codehawks" | "markdown"

/** A place a report points at; it becomes a claim target only after it resolves in the snapshot. */
export interface TargetReference {
  contract?: string
  functionName?: string
  filePath?: string
  line?: number
  /** Named by an explicit target field: trusted like `Target:` and checked later by the compiler, not by reading. */
  explicit?: boolean
}

/**
 * The claim fields found in one report. Every text field is an excerpt of the report exactly as written (a `Key:`
 * line value or a section body, trimmed), so mapping a platform's layout onto the harness template never rewords it.
 */
export interface ClaimDraft {
  format: ReportFormat
  rootCause?: string
  attackScenario?: string
  impact?: string
  state?: string
  callerAssumptions: string[]
  targets: TargetReference[]
}

type TextField = "rootCause" | "attackScenario" | "impact" | "state"

const identifier = "[A-Za-z_$][\\w$]*"

// `Key: value` lines: the harness template (`Target:`, `Root cause:` …) and Hound (`ROOT CAUSE:`, `ATTACK VECTOR:` …).
const lineFields: ReadonlyArray<readonly [TextField, readonly string[]]> = [
  ["rootCause", ["root cause"]],
  ["attackScenario", ["attack scenario", "attack vector", "attack path"]],
  ["impact", ["impact"]],
  ["state", ["state", "claimed state"]],
]

// Section titles in priority order: Sherlock, Code4rena and Codehawks templates, then generic fallbacks.
const sectionFields: ReadonlyArray<readonly [TextField, readonly string[]]> = [
  ["rootCause", ["root cause", "vulnerability detail", "vulnerability details", "finding description", "description", "summary"]],
  ["attackScenario", ["attack path", "attack scenario", "exploit scenario", "proof of concept", "poc"]],
  ["impact", ["impact", "impact details"]],
  ["state", ["state", "state change"]],
]

const assumptionSections = ["internal pre-conditions", "external pre-conditions", "preconditions"]

const titleKey = (title: string) =>
  title
    .replace(/[*_`]/g, "")
    .replace(/^\s*(?:\d+[.)]\s*)?/, "")
    .replace(/[:.\s]+$/, "")
    .trim()
    .toLowerCase()

/** `Key: value` lines outside code fences, keyed by the lower-cased key. The first occurrence of a key wins. */
const keyedLines = (prose: string) => {
  const values = new Map<string, string>()
  for (const line of prose.split(/\r?\n/)) {
    const match = /^\s*(?:[-*]\s+)?\**([A-Za-z][A-Za-z /-]{1,40}?)\**\s*:\s*(\S.*)$/.exec(line)
    if (match === null) continue
    const key = titleKey(match[1]!)
    if (!values.has(key)) values.set(key, match[2]!.trim())
  }
  return values
}

/** Markdown sections: each heading's body runs to the next heading of any level. The first title occurrence wins. */
const sections = (report: string) => {
  const bodies = new Map<string, string>()
  const lines = report.split(/\r?\n/)
  let fence = false
  let title: string | undefined
  let body: string[] = []
  const close = () => {
    const text = body.join("\n").trim()
    if (title !== undefined && text !== "" && !bodies.has(title)) bodies.set(title, text)
  }
  for (const line of lines) {
    if (/^\s*```/.test(line)) fence = !fence
    const heading = fence ? null : /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading !== null) {
      close()
      title = titleKey(heading[1]!)
      body = []
    } else body.push(line)
  }
  close()
  return bodies
}

const withoutFences = (report: string) => report.replace(/```[^\n]*\n[\s\S]*?```/g, "")

const detectFormat = (report: string, keyed: Map<string, string>, titled: Map<string, string>): ReportFormat => {
  if (keyed.has("target") && keyed.has("root cause")) return "harness"
  if (keyed.has("affected code") || keyed.has("affected nodes") || keyed.has("vulnerability type")) return "hound"
  if (titled.has("lines of code")) return "code4rena"
  if (titled.has("attack path") || titled.has("internal pre-conditions") || titled.has("code snippet")) return "sherlock"
  if (titled.has("vulnerability details") && titled.has("tools used")) return "codehawks"
  return /\n\s*(?:critical|high|medium|low)\s*\n/i.test(report.slice(0, 200)) ? "sherlock" : "markdown"
}

const explicitTarget = (value: string | undefined): TargetReference[] => {
  const match = value === undefined ? null : new RegExp(`^\\s*\`?(${identifier})\\.(${identifier})`).exec(value)
  return match === null ? [] : [{ contract: match[1]!, functionName: match[2]!, explicit: true }]
}

/** Every target reference in the report, strongest first; duplicates are dropped. */
const targetReferences = (report: string, keyed: Map<string, string>): TargetReference[] => {
  const references: TargetReference[] = [...explicitTarget(keyed.get("target"))]
  for (const node of (keyed.get("affected nodes") ?? "").matchAll(new RegExp(`\\b(?:func|function):(${identifier})\\.(${identifier})`, "g")))
    references.push({ contract: node[1]!, functionName: node[2]!, explicit: true })
  for (const code of report.matchAll(new RegExp(`([\\w./-]+\\.sol):(${identifier})\\b`, "g")))
    references.push({ filePath: code[1]!, functionName: code[2]! })
  for (const link of report.matchAll(/([\w./-]+\.sol)#L(\d+)/g)) references.push({ filePath: link[1]!, line: Number(link[2]) })
  for (const code of report.matchAll(new RegExp(`\`(${identifier})\\.(${identifier})(?:\\([^\`]*\\))?\``, "g")))
    references.push({ contract: code[1]!, functionName: code[2]! })
  // A call written in prose, e.g. `Hub.reportDeficit(`: the weakest hint, kept only if the snapshot confirms it.
  for (const prose of withoutFences(report).matchAll(/\b([A-Z][\w$]*)\.([a-z_$][\w$]*)\(/g))
    references.push({ contract: prose[1]!, functionName: prose[2]! })
  const seen = new Set<string>()
  return references.filter((reference) => {
    const key = JSON.stringify([reference.contract, reference.functionName, reference.filePath, reference.line])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Maps any supported report layout onto the harness claim fields without changing a word of the report. */
export const draftClaim = (report: string): ClaimDraft => {
  const prose = withoutFences(report)
  const keyed = keyedLines(prose)
  const titled = sections(report)
  const pick = (field: TextField) => {
    for (const [name, keys] of lineFields) if (name === field) for (const key of keys) if (keyed.has(key)) return keyed.get(key)
    for (const [name, keys] of sectionFields) if (name === field) for (const key of keys) if (titled.has(key)) return titled.get(key)
    return undefined
  }
  const draft: ClaimDraft = {
    format: detectFormat(report, keyed, titled),
    callerAssumptions: assumptionSections.flatMap((key) => (titled.has(key) ? [titled.get(key)!] : [])),
    targets: targetReferences(report, keyed),
  }
  for (const field of ["rootCause", "attackScenario", "impact", "state"] as const) {
    const value = pick(field)
    if (value !== undefined && value !== "") draft[field] = value
  }
  return draft
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim()

/** True when `excerpt` appears in `report` word for word (whitespace-insensitive) and is not trivially short. */
export const isVerbatimExcerpt = (excerpt: string, report: string) =>
  collapse(excerpt).length >= 8 && collapse(report).includes(collapse(excerpt))

/**
 * Fills the fields the report's layout did not yield with excerpts a model located. Fields the layout yielded are
 * kept; an extracted text that is not a verbatim excerpt of the report is dropped, never trusted.
 */
export const withExtracted = (draft: ClaimDraft, extracted: ExtractedClaimFields | undefined, report: string): ClaimDraft => {
  if (extracted === undefined) return draft
  const merged: ClaimDraft = { ...draft, targets: [...draft.targets] }
  for (const field of ["rootCause", "attackScenario", "impact", "state"] as const) {
    const value = extracted[field]
    if (merged[field] === undefined && typeof value === "string" && isVerbatimExcerpt(value, report)) merged[field] = value.trim()
  }
  const target = extracted.target?.trim() ?? ""
  const qualified = new RegExp(`^(${identifier})\\.(${identifier})$`).exec(target)
  const located = new RegExp(`^([\\w./-]+\\.sol):(${identifier})$`).exec(target)
  // A model's target is never explicit: it must be found by reading the snapshot.
  if (qualified !== null) merged.targets.push({ contract: qualified[1]!, functionName: qualified[2]! })
  else if (located !== null) merged.targets.push({ filePath: located[1]!, functionName: located[2]! })
  return merged
}

/** The fields still needed before the draft is a judgeable claim, given the target that resolved (if any). */
export const missingFields = (draft: ClaimDraft, targetResolved: boolean): ClaimField[] => [
  ...(targetResolved ? [] : ["target" as const]),
  ...(draft.rootCause === undefined ? ["rootCause" as const] : []),
  ...(draft.attackScenario === undefined && draft.impact === undefined ? ["attackOrImpact" as const] : []),
]
