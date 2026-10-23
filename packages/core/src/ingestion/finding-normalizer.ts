import type { ContextItem, ModelGatewayPort, ModelUsage } from "@harness/protocol"
import { loadPrompt } from "../prompts/index"
import { parseClaim } from "./snapshot-ingestion"

export const FindingNormalizerPrompt = "finding-normalizer.v1" as const
const MaxAttempts = 2
const identifier = /^[A-Za-z_$][\w$]*$/
const fencedBlock = /```[^\n]*\n[\s\S]*?```/g
// Fields of a JSON finding (Hound hypothesis, verification-data JSON) that describe the claim; everything else,
// such as status, confidence or model names, is adjudication metadata and is dropped (Rule R2).
const ClaimFields = [
  "title",
  "severity",
  "vulnerability_type",
  "description",
  "implicated_functions",
  "affected_functions",
  "node_refs",
  "source_files",
  "expected_invariants",
  "reasoning",
] as const

export type FindingNormalization =
  | { kind: "template"; reportMarkdown: string }
  | { kind: "normalized"; reportMarkdown: string; usage: ModelUsage; latencyMs: number; attempts: number }
  | { kind: "failed"; message: string; usage: ModelUsage; latencyMs: number; attempts: number }

export interface FindingNormalizerDeps {
  gateway: ModelGatewayPort
  profileId: string
  maxOutputTokens: number
  signal?: AbortSignal
}

/** True when the report already has the five `Target:`, `Root cause:` ... lines `SnapshotIngestion` parses. */
export const isTemplateFinding = (reportMarkdown: string) => parseClaim(reportMarkdown.replace(fencedBlock, "")) !== undefined

/** A JSON finding becomes markdown holding only its claim fields; any other report is returned as is. */
export const claimMarkdown = (report: string): string => {
  let parsed: unknown
  try {
    parsed = JSON.parse(report)
  } catch {
    return report
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return report
  const record = parsed as Record<string, unknown>
  const nested = typeof record.properties === "object" && record.properties !== null ? (record.properties as Record<string, unknown>) : {}
  const lines = ClaimFields.flatMap((field) => {
    const value = record[field] ?? nested[field]
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0) || value === "") return []
    return [`## ${field}\n\n${typeof value === "string" ? value : JSON.stringify(value)}`]
  })
  return lines.join("\n\n")
}

// Only a fence holding Solidity test code stays a PoC; other fences become text so ingestion does not take them as one.
const retagFences = (markdown: string) =>
  markdown.replace(fencedBlock, (block) => {
    const body = block.slice(block.indexOf("\n") + 1)
    const isPoc = /pragma solidity|function test\w*\s*\(/.test(body)
    return `\`\`\`${isPoc ? "solidity" : "text"}\n${body}`
  })

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim()

const parseNormalizedClaim = (text: string) => {
  const trimmed = text.trim()
  const candidate = trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)
  let value: unknown
  try {
    value = JSON.parse(candidate)
  } catch {
    return undefined
  }
  if (value === null || typeof value !== "object") return undefined
  const claim = value as Record<string, unknown>
  const fields = ["target", "rootCause", "attackScenario", "impact", "state"] as const
  if (fields.some((field) => typeof claim[field] !== "string" || (claim[field] as string).trim() === "")) return undefined
  const [contract, fn, ...rest] = (claim.target as string).trim().split(".")
  if (!contract || !fn || rest.length > 0 || !identifier.test(contract) || !identifier.test(fn)) return undefined
  return [
    `Target: ${contract}.${fn}`,
    `Root cause: ${oneLine(claim.rootCause as string)}`,
    `Attack scenario: ${oneLine(claim.attackScenario as string)}`,
    `Impact: ${oneLine(claim.impact as string)}`,
    `State: ${oneLine(claim.state as string)}`,
  ].join("\n")
}

const addUsage = (sum: ModelUsage, next: ModelUsage): ModelUsage => ({
  promptTokens: sum.promptTokens + next.promptTokens,
  completionTokens: sum.completionTokens + next.completionTokens,
  totalTokens: sum.totalTokens + next.totalTokens,
  costUsd: sum.costUsd + next.costUsd,
  ...(sum.pricing === "unpriced" || next.pricing === "unpriced" ? { pricing: "unpriced" as const } : {}),
})

/**
 * Brings a candidate finding into the claim template `SnapshotIngestion` reads. A report already in the template is
 * returned unchanged; any other report (free-form markdown, a JSON finding) is rewritten by one provider call, with one
 * repair. The narrative follows the template lines, with only Solidity test code kept as a PoC fence.
 */
export const normalizeFinding = async (
  deps: FindingNormalizerDeps,
  input: { runId: string; reportMarkdown: string },
): Promise<FindingNormalization> => {
  const narrative = retagFences(claimMarkdown(input.reportMarkdown))
  if (isTemplateFinding(input.reportMarkdown)) return { kind: "template", reportMarkdown: input.reportMarkdown }
  const item = (id: string, type: ContextItem["type"], content: string): ContextItem => ({ id, turn: 0, type, isPinned: true, content })
  const items = [
    item("normalizer-system", "system_prompt", loadPrompt(FindingNormalizerPrompt).text),
    item("normalizer-report", "candidate_finding", narrative),
  ]
  let usage: ModelUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
  let latencyMs = 0
  let message = "the provider output is not the claim JSON"
  for (let attempt = 1; attempt <= MaxAttempts; attempt++) {
    const response = await deps.gateway.executeAttempt(
      { runId: input.runId, stepIndex: 1, attemptIndex: attempt, profileId: deps.profileId, items, maxOutputTokens: deps.maxOutputTokens },
      deps.signal,
    )
    usage = addUsage(usage, response.usage)
    latencyMs += response.latencyMs
    if (response.error) return { kind: "failed", message: response.error.message, usage, latencyMs, attempts: attempt }
    const template = parseNormalizedClaim(response.content ?? "")
    if (template !== undefined)
      return { kind: "normalized", reportMarkdown: `${narrative}\n\n## Claim\n\n${template}\n`, usage, latencyMs, attempts: attempt }
    message = `the provider output is not the claim JSON (attempt ${attempt})`
    items.push(
      item(`normalizer-output-${attempt}`, "assistant_reasoning", response.content ?? ""),
      item(`normalizer-repair-${attempt}`, "system_prompt", "Return only the JSON object with target as Contract.function and the four other non-empty string fields."),
    )
  }
  return { kind: "failed", message, usage, latencyMs, attempts: MaxAttempts }
}
