import {
  validateVerdict,
  type JudgeVerdict,
  type SecurityFilterPort,
  type SourceSnapshotPort,
  type VerdictIssue,
} from "@harness/protocol"
import { isAbsoluteLooking } from "../runner/event-sink"
import { textDigest } from "../util/digest"

/** A verdict that fails validation may be repaired at most this many times before the run fails. */
export const MaxSchemaRepairs = 2

export interface VerdictSynthesisDeps {
  snapshot: SourceSnapshotPort
  /** Evidence snippets are source text that ends up in events, so they pass the same filter as tool output. */
  security: SecurityFilterPort
}

export interface VerdictSynthesisInput {
  /** The model's final text, expected to be one JSON object, optionally inside a ```json fence. */
  text: string
  runId: string
  findingId: string
  snapshotId: string
  /** The digest of the execution trace, when the run has one; the model never supplies it. */
  traceDigest?: string
  enableSchemaRepair: boolean
  /** Repairs already granted in this run. */
  repairsUsed: number
  maxRepairs?: number
  signal?: AbortSignal
}

export type VerdictSynthesis =
  | { kind: "accepted"; verdict: JudgeVerdict }
  /** Invalid, and a repair is still allowed: `feedback` goes to the model for the next step. */
  | { kind: "repair"; attempt: number; issues: VerdictIssue[]; feedback: string }
  /** Invalid with no repair left (or repair disabled): the run fails with `schema_repair_exhausted`. */
  | { kind: "rejected"; attempt: number; issues: VerdictIssue[] }

/** Fields only the harness may set: the model's values for them are dropped before validation. */
const HarnessVerdictFields = ["runId", "findingId", "traceDigest"]
const HarnessEvidenceFields = ["snippet", "contentDigest"]
const MaxListedIssues = 20

const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const withoutKeys = (record: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))

const parseObject = (text: string): Record<string, unknown> | undefined => {
  const trimmed = text.trim()
  const body = fenced.exec(trimmed)?.[1] ?? trimmed
  try {
    const parsed: unknown = JSON.parse(body)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Replaces the identity and every hash with the harness's values, so nothing the model wrote there is trusted. */
const withHarnessFields = (parsed: Record<string, unknown>, input: VerdictSynthesisInput) => ({
  ...withoutKeys(parsed, HarnessVerdictFields),
  ...(Array.isArray(parsed.citesEvidence)
    ? {
        citesEvidence: parsed.citesEvidence.map((item) =>
          isRecord(item) ? withoutKeys(item, HarnessEvidenceFields) : item,
        ),
      }
    : {}),
  runId: input.runId,
  findingId: input.findingId,
  ...(input.traceDigest === undefined ? {} : { traceDigest: input.traceDigest }),
})

type Evidence = JudgeVerdict["citesEvidence"][number]

type Resolution = { kind: "resolved"; evidence: Evidence } | { kind: "unresolved"; issue: VerdictIssue }

const unresolved = (index: number, field: string, message: string): Resolution => ({
  kind: "unresolved",
  issue: { reason: "EVIDENCE_UNRESOLVED", path: ["citesEvidence", index, field], message },
})

/** Path problems are reported without echoing the path, which may be an absolute host path. */
const pathProblem = (filePath: string) => {
  if (filePath.trim() === "") return "filePath is empty; cite a file path relative to the snapshot root"
  if (isAbsoluteLooking(filePath))
    return "filePath is an absolute path; cite the file by its path relative to the snapshot root"
  if (filePath.replaceAll("\\", "/").split("/").includes(".."))
    return "filePath contains a '..' segment and leaves the snapshot; cite a path inside the snapshot"
  return undefined
}

const resolveEvidence = async (
  deps: VerdictSynthesisDeps,
  input: VerdictSynthesisInput,
  evidence: Evidence,
  index: number,
): Promise<Resolution> => {
  const problem = pathProblem(evidence.filePath)
  if (problem !== undefined) return unresolved(index, "filePath", problem)
  const read = await deps.snapshot.readLines(
    { snapshotId: input.snapshotId, path: evidence.filePath, startLine: evidence.startLine, endLine: evidence.endLine },
    input.signal,
  )
  if (read.kind === "not_found")
    return unresolved(
      index,
      "filePath",
      "the cited file does not exist in the source snapshot; cite only files you have seen in this conversation",
    )
  if (read.kind === "out_of_range")
    return unresolved(
      index,
      "endLine",
      `lines ${evidence.startLine}-${evidence.endLine} are outside the cited file, which has ${read.lineCount} lines`,
    )
  const exact = read.lines.join("\n")
  const filtered = await deps.security.filterSecrets(exact, input.signal)
  return { kind: "resolved", evidence: { ...evidence, snippet: filtered.content, contentDigest: textDigest(exact) } }
}

const describePath = (path: VerdictIssue["path"]) => {
  if (path.length === 0) return "(verdict)"
  return path
    .map((segment, index) => (typeof segment === "number" ? `[${segment}]` : index === 0 ? segment : `.${segment}`))
    .join("")
}

const repairFeedback = (issues: readonly VerdictIssue[], attempt: number, remainingAfter: number) =>
  [
    `Your verdict was not accepted (validation attempt ${attempt}). Problems found:`,
    ...issues.slice(0, MaxListedIssues).map((issue) => `- ${describePath(issue.path)}: ${issue.message}`),
    ...(issues.length > MaxListedIssues ? [`- and ${issues.length - MaxListedIssues} more problems`] : []),
    "Reply with exactly one corrected JSON verdict object that follows the verdict format from your instructions, " +
      "and nothing else.",
    "Do not include snippet, contentDigest, traceDigest or any hash: " +
      "the harness reads the cited lines and computes them.",
    remainingAfter === 0
      ? "This is your last repair: if the next verdict is invalid, the run fails."
      : `${remainingAfter} more ${remainingAfter === 1 ? "repair remains" : "repairs remain"} after this one.`,
  ].join("\n")

/**
 * Turns the model's final text into a committed verdict: parse, schema and cross-field validation, then evidence
 * resolution through the snapshot port with the harness computing every digest. An invalid verdict yields the issues
 * (reason code and path only are safe to persist) and, while repairs remain and repair is enabled, feedback text for
 * the model's next step.
 */
export const synthesizeVerdict = async (
  deps: VerdictSynthesisDeps,
  input: VerdictSynthesisInput,
): Promise<VerdictSynthesis> => {
  const attempt = input.repairsUsed + 1
  const fail = (issues: VerdictIssue[]): VerdictSynthesis => {
    const maxRepairs = input.maxRepairs ?? MaxSchemaRepairs
    if (!input.enableSchemaRepair || input.repairsUsed >= maxRepairs) return { kind: "rejected", attempt, issues }
    return { kind: "repair", attempt, issues, feedback: repairFeedback(issues, attempt, maxRepairs - attempt) }
  }

  const parsed = parseObject(input.text)
  if (parsed === undefined)
    return fail([
      {
        reason: "SCHEMA_VIOLATION",
        path: [],
        message: "the reply is not a single JSON object; send only the JSON verdict, with no other text",
      },
    ])

  const validation = validateVerdict(withHarnessFields(parsed, input))
  if (!validation.ok) return fail(validation.issues)

  const resolutions = await Promise.all(
    validation.verdict.citesEvidence.map((evidence, index) => resolveEvidence(deps, input, evidence, index)),
  )
  const issues = resolutions.flatMap((resolution) => (resolution.kind === "unresolved" ? [resolution.issue] : []))
  if (issues.length > 0) return fail(issues)
  return {
    kind: "accepted",
    verdict: {
      ...validation.verdict,
      citesEvidence: resolutions.flatMap((resolution) => (resolution.kind === "resolved" ? [resolution.evidence] : [])),
    },
  }
}
