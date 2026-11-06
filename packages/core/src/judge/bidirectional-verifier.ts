import type { ContextItem } from "@harness/protocol"
import { loadPrompt } from "../prompts/index"
import { textDigest } from "../util/digest"
import { parseJsonObject } from "../util/json-object"

export type ForwardResult = { reachability: "reachable" | "blocked" | "incomplete" }
export type BackwardResult = { reconstruction: "reconstructed" | "blocked" | "incomplete" }
export type ConsensusDecision = "agreed-valid" | "agreed-invalid" | "disputed" | "inconclusive"
export type VerificationDirection = "forward" | "backward"

export type ParsedResult<T> = { kind: "ok"; result: T } | { kind: "invalid" }

/**
 * One direction's result: its own field and a non-empty explanation. Other keys (the other direction's field, which a
 * model may fill as well) are ignored, so a stated result is never lost to an extra field.
 */
const parseResult = <T extends Record<string, unknown>>(
  text: string,
  field: string,
  values: readonly string[],
): ParsedResult<T> => {
  const reply = parseJsonObject(text)
  const value = reply?.[field]
  const explanation = reply?.explanation
  if (typeof value !== "string" || !values.includes(value) || typeof explanation !== "string" || explanation.trim() === "")
    return { kind: "invalid" }
  return { kind: "ok", result: { [field]: value, explanation } as unknown as T }
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

/**
 * v2 defines blocked strictly (a check read in the code, cited, that holds for every permitted caller) and rules out
 * costly or rare preconditions, unenforced trust and unread code as blockers, in neutral wording. With v1, both
 * directions answered blocked on a create2 address-collision finding that the contest judged a valid Medium
 * (Gemini 3.8 Flash, 2026-10-23); the incomplete-BCE rule kept that from becoming an invalid verdict.
 */
const DirectionPromptVersion = "v2"

export const directionPrompt = (direction: VerificationDirection) =>
  `${DirectionPrefix}${direction}\n${loadPrompt(`${direction}-verification.${DirectionPromptVersion}`).text}`

/** Sent instead of the step-limit prompt when a direction's step budget ends before it answered. */
export const directionLimitPrompt = (direction: VerificationDirection) =>
  loadPrompt("verification-limit.v1")
    .text.replaceAll("{direction}", direction)
    .replaceAll("{field}", direction === "forward" ? "reachability" : "reconstruction")

/** Sent when the verdict phase after an agreed consensus stops finding new evidence. */
export const verdictLimitPrompt = () => loadPrompt("verdict-limit.v1").text

/** Recorded in the run configuration (Rule R1): the direction prompts and their limit prompts shape every verdict. */
export const verificationPromptDigest = () =>
  textDigest(
    [
      loadPrompt(`forward-verification.${DirectionPromptVersion}`).digest,
      loadPrompt(`backward-verification.${DirectionPromptVersion}`).digest,
      loadPrompt("verification-limit.v1").digest,
      loadPrompt("verdict-limit.v1").digest,
    ].join("\n"),
  )

export const resultNote = (direction: VerificationDirection, result: ForwardResult | BackwardResult) =>
  `${resultPrefix(direction)}${JSON.stringify(result)}`

export const consensusNote = (decision: ConsensusDecision) => `${ConsensusPrefix}${decision}`

export const ConsensusVerdictInstruction =
  "Produce a normative JSON verdict only if source citations directly support the specific forward reachability and backward reconstruction/blocker claim. Cite exact snapshot lines: for a valid verdict the lines of the reachable path and of the state change; for an invalid verdict the lines of the check that blocks it (require, revert, assert or access modifier). Otherwise return validity unverified with reasonCode UNRESOLVED. Consensus by itself does not establish validity."

export interface VerificationState {
  /** The direction the model was last asked for; `undefined` when the run does not verify bidirectionally. */
  direction?: VerificationDirection
  /** The step whose results added the current direction (0 for the initial context): its steps are counted from here. */
  directionSince?: number
  forward?: ForwardResult & { explanation: string }
  backward?: BackwardResult & { explanation: string }
  consensus?: ConsensusDecision
  /** The step whose results added the consensus: the verdict phase's steps are counted from here. */
  consensusSince?: number
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
    else if (content.startsWith(DirectionPrefix)) {
      state.direction = content.startsWith(`${DirectionPrefix}forward\n`) ? "forward" : "backward"
      state.directionSince = item.turn
    }
    else if (content.startsWith(resultPrefix("forward"))) {
      const parsed = parseForwardResult(content.slice(resultPrefix("forward").length))
      if (parsed.kind === "ok") state.forward = parsed.result
    } else if (content.startsWith(resultPrefix("backward"))) {
      const parsed = parseBackwardResult(content.slice(resultPrefix("backward").length))
      if (parsed.kind === "ok") state.backward = parsed.result
    } else if (content.startsWith(ConsensusPrefix)) {
      const decision = content.slice(ConsensusPrefix.length)
      if (consensusValues.includes(decision)) {
        state.consensus = decision as ConsensusDecision
        state.consensusSince = item.turn
      }
    }
  }
  return state
}
