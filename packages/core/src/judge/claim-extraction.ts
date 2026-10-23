import type { ClaimField, ContextItem, ExtractedClaimFields } from "@harness/protocol"
import { loadPrompt } from "../prompts/index"
import { parseJsonObject } from "../util/json-object"

/** Snapshot paths listed for the model to name a target; a longer listing is cut and says so. */
export const MaxListedSourceFiles = 400
/** Claim extraction answers with short excerpts, so it never needs the run's full output allowance. */
export const MaxExtractionOutputTokens = 2_000

export const claimExtractionPrompt = () => loadPrompt("claim-extraction.v1")

const fieldNames: Record<ClaimField, string> = {
  target: "target",
  rootCause: "rootCause",
  attackOrImpact: "attackScenario or impact",
}

/** The request items: the prompt, what is missing with the snapshot's Solidity paths, then the report verbatim. */
export const claimExtractionItems = (input: {
  reportMarkdown: string
  missing: readonly ClaimField[]
  sourcePaths: readonly string[]
  id: () => string
}): ContextItem[] => {
  const listed = input.sourcePaths.slice(0, MaxListedSourceFiles)
  const omitted = input.sourcePaths.length - listed.length
  const item = (type: ContextItem["type"], content: string): ContextItem => ({ id: input.id(), turn: 0, type, isPinned: true, content })
  return [
    item("system_prompt", claimExtractionPrompt().text),
    item(
      "system_prompt",
      [
        `Fields the report's layout did not yield: ${input.missing.map((field) => fieldNames[field]).join(", ")}.`,
        "Snapshot Solidity files:",
        ...listed,
        ...(omitted > 0 ? [`(${omitted} more files not listed)`] : []),
      ].join("\n"),
    ),
    item("candidate_finding", input.reportMarkdown),
  ]
}

const textFields = ["target", "rootCause", "attackScenario", "impact", "state"] as const

/**
 * The fields of the model's reply, or `undefined` when the reply is not one JSON object. Values are only typed here;
 * the ingestion port decides which are verbatim excerpts and which target exists.
 */
export const parseExtractedFields = (text: string): ExtractedClaimFields | undefined => {
  const reply = parseJsonObject(text)
  if (reply === undefined) return undefined
  const fields: ExtractedClaimFields = {}
  for (const name of textFields) {
    const value = reply[name]
    if (typeof value === "string" && value.trim() !== "") fields[name] = value
  }
  return fields
}
