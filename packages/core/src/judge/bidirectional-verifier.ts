import type { ContextItem } from "@harness/protocol"
import { loadPrompt } from "../prompts/index"
import { textDigest } from "../util/digest"
import { parseJsonObject } from "../util/json-object"

export type ForwardResult = { reachability: "reachable" | "blocked" | "incomplete" }
export type BackwardResult = { reconstruction: "reconstructed" | "blocked" | "incomplete" }
export type ConsensusDecision = "agreed-valid" | "agreed-invalid" | "disputed" | "inconclusive"
export type VerificationDirection = "forward" | "backward"

export type ParsedResult<T> = { kind: "ok"; result: T } | { kind: "invalid" }

const parseResult = <T extends Record<string, unknown>>(
  text: string,
  field: string,
  values: readonly string[],
): ParsedResult<T> => {
  const result = parseJsonObject(text)
  if (
    result === undefined ||
    Object.keys(result).length !== 2 ||
    !values.includes(result[field] as string) ||
    typeof result.explanation !== "string" ||
    result.explanation.trim() === ""
  )
    return { kind: "invalid" }
  return { kind: "ok", result: result as T }
}

export const parseForwardResult = (text: string): ParsedResult<ForwardResult & { explanation: string }> =>
  parseResult(text, "reachability", ["reachable", "blocked", "incomplete"])

export const parseBackwardResult = (text: string): ParsedResult<BackwardResult & { explanation: string }> =>
  parseResult(text, "reconstruction", ["reconstructed", "blocked", "incomplete"])

/** Only two agreeing, definite directions agree; any `incomplete` or a split is never read as a negative. */
export const decideConsensus = (forward: ForwardResult, backward: BackwardResult): ConsensusDecision => {
  if (forward.reachability === "blocked" && backward.reconstruction === "blocked") return "agreed-invalid"
  if (forward.reachability === "reachable" && backward.reconstruction === "reconstructed") return "agreed-valid"
  if (forward.reachability === "incomplete" && backward.reconstruction === "incomplete") return "inconclusive"
  return "disputed"
}

// The verification state lives in the context as harness-authored, pinned `system_prompt` items: the model's own text
// (stored as `assistant_reasoning`) can never advance or forge it, and compaction never drops it.
const DirectionPrefix = "Verification direction: "
const resultPrefix = (direction: VerificationDirection) => `Bidirectional ${direction} result: `
const ConsensusPrefix = "Bidirectional consensus: "

export const BceIncompleteNote =
  "BCE status: incomplete. Source slices are retrieval context only; missing edges prove nothing. Return UNVERIFIED unless independent validated evidence establishes the claim."

export const directionPrompt = (direction: VerificationDirection) =>
  `${DirectionPrefix}${direction}\n${loadPrompt(`${direction}-verification.v1`).text}`

/** Recorded in the run configuration (Rule R1): both direction prompts shape every bidirectional verdict. */
export const verificationPromptDigest = () =>
  textDigest(`${loadPrompt("forward-verification.v1").digest}\n${loadPrompt("backward-verification.v1").digest}`)

export const resultNote = (direction: VerificationDirection, result: ForwardResult | BackwardResult) =>
  `${resultPrefix(direction)}${JSON.stringify(result)}`

export const consensusNote = (decision: ConsensusDecision) => `${ConsensusPrefix}${decision}`

export const ConsensusVerdictInstruction =
  "Produce a normative JSON verdict only if source citations directly support the specific forward reachability and backward reconstruction/blocker claim. Cite exact snapshot lines; otherwise return validity unverified with reasonCode UNRESOLVED. Consensus by itself does not establish validity."

export interface VerificationState {
  /** The direction the model was last asked for; `undefined` when the run does not verify bidirectionally. */
  direction?: VerificationDirection
  forward?: ForwardResult & { explanation: string }
  backward?: BackwardResult & { explanation: string }
  consensus?: ConsensusDecision
  bceIncomplete: boolean
  hasBceSlices: boolean
}

const consensusValues: readonly string[] = ["agreed-valid", "agreed-invalid", "disputed", "inconclusive"]

export const readVerificationState = (items: readonly ContextItem[]): VerificationState => {
  const state: VerificationState = {
    bceIncomplete: false,
    hasBceSlices: items.some((item) => item.type === "bce_sliced_ast"),
  }
  for (const item of items) {
    if (item.type !== "system_prompt") continue
    const { content } = item
    if (content === BceIncompleteNote) state.bceIncomplete = true
    else if (content.startsWith(DirectionPrefix))
      state.direction = content.startsWith(`${DirectionPrefix}forward\n`) ? "forward" : "backward"
    else if (content.startsWith(resultPrefix("forward"))) {
      const parsed = parseForwardResult(content.slice(resultPrefix("forward").length))
      if (parsed.kind === "ok") state.forward = parsed.result
    } else if (content.startsWith(resultPrefix("backward"))) {
      const parsed = parseBackwardResult(content.slice(resultPrefix("backward").length))
      if (parsed.kind === "ok") state.backward = parsed.result
    } else if (content.startsWith(ConsensusPrefix)) {
      const decision = content.slice(ConsensusPrefix.length)
      if (consensusValues.includes(decision)) state.consensus = decision as ConsensusDecision
    }
  }
  return state
}
