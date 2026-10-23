import type { ContextItem, ExtractedClaimFields } from "@harness/protocol"
import { loadPrompt } from "../prompts/index"
import { parseJsonObject } from "../util/json-object"

/** Snapshot paths listed for the model to name a target; a longer listing is cut and says so. */
export const MaxListedSourceFiles = 400
/** Claim extraction answers with short excerpts, so it never needs the run's full output allowance. */
export const MaxExtractionOutputTokens = 2_000

/**
 * v2 frames the request as clerical work in an authorized, defensive review and keeps attack vocabulary out of the
 * instructions and field names: measured on Gemini 3.8 Flash via 9router, v1 was blocked by the provider's safety
 * filter on 3 of 6 calls and never answered in the required format, v2 on none (2026-10-23, 3 real reports x 2).
 */
export const claimExtractionPrompt = () => loadPrompt("claim-extraction.v2")

/**
 * The request items, in the layout v2 was measured with: the prompt as the system message, then one user message with
 * the snapshot's Solidity paths and the report verbatim, quoted in `<report>` tags. The fields still missing are not
 * named: the model locates every field and the ingestion port keeps only what the report's layout did not yield.
 */
export const claimExtractionItems = (input: {
  reportMarkdown: string
  sourcePaths: readonly string[]
  id: () => string
}): ContextItem[] => {
  const listed = input.sourcePaths.slice(0, MaxListedSourceFiles)
  const omitted = input.sourcePaths.length - listed.length
  const item = (type: ContextItem["type"], content: string): ContextItem => ({ id: input.id(), turn: 0, type, isPinned: true, content })
  return [
    item("system_prompt", claimExtractionPrompt().text),
    item(
      "candidate_finding",
      [
        "Snapshot Solidity files:",
        ...listed,
        ...(omitted > 0 ? [`(${omitted} more files not listed)`] : []),
        "",
        "<report>",
        input.reportMarkdown,
        "</report>",
      ].join("\n"),
    ),
  ]
}

/** Reply keys mapped onto the claim fields: v2's neutral names, and v1's names, which are still accepted. */
const replyKeys = {
  target: ["target"],
  rootCause: ["rootCause"],
  attackScenario: ["callSequence", "attackScenario"],
  impact: ["consequence", "impact"],
  state: ["stateChange", "state"],
} as const

/**
 * The fields of the model's reply, or `undefined` when the reply is not one JSON object. Values are only typed here;
 * the ingestion port decides which are verbatim excerpts and which target exists.
 */
export const parseExtractedFields = (text: string): ExtractedClaimFields | undefined => {
  const reply = parseJsonObject(text)
  if (reply === undefined) return undefined
  const fields: ExtractedClaimFields = {}
  for (const [name, keys] of Object.entries(replyKeys) as Array<[keyof ExtractedClaimFields, readonly string[]]>) {
    const value = keys.map((key) => reply[key]).find((candidate) => typeof candidate === "string" && candidate.trim() !== "")
    if (typeof value === "string") fields[name] = value
  }
  return fields
}
