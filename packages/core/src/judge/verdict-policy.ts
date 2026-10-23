import type { JudgeVerdict } from "@harness/protocol"
import type { ConsensusDecision } from "./bidirectional-verifier"
import type { VerdictWording } from "./unverified-verdict"

/**
 * A blocking check in cited source: require/revert/assert, or an access modifier in the usual naming (`onlyOwner`,
 * `whenNotPaused`, MakerDAO's `auth`). Comments are removed first, so a guard only mentioned in a comment does not count.
 */
const GuardPattern = /\brequire\s*\(|\brevert\b|\bassert\s*\(|\bonly[A-Z_]\w*|\bwhen[A-Z_]\w*|\bauth\b/

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ")

/** Whether a cited span, as the harness read it from the snapshot, contains a blocking check. */
export const citesGuard = (verdict: JudgeVerdict) =>
  verdict.citesEvidence.some((evidence) => evidence.snippet !== undefined && GuardPattern.test(withoutComments(evidence.snippet)))

export type StaticVerdictDecision = { kind: "accept" } | { kind: "withhold"; wording: VerdictWording }

const withhold = (summary: string, reasoning: string): StaticVerdictDecision => ({ kind: "withhold", wording: { summary, reasoning } })

/**
 * The conclusion rules of the TV4 Judge proposal (docs/tv4-judge-pipeline-proposal.md, section 4) for a verdict without
 * execution evidence. Its citations have already been resolved against the snapshot by the verdict synthesizer.
 * - Forward reaches the path and backward reconstructs the impact: the claim may be concluded statically, so a valid
 *   verdict with resolved citations is accepted.
 * - A blocking guard confirmed from source: the claim may be rejected, so an invalid verdict is accepted only when both
 *   directions are blocked and a cited span, read by the harness, contains the guard. The model saying "blocked" is not
 *   enough: on 2026-10-23 both directions answered blocked on a finding the contest judged valid.
 * - Anything else (disputed, inconclusive, no consensus) stays unverified: missing evidence is never a negative.
 */
export const staticVerdictDecision = (verdict: JudgeVerdict, consensus: ConsensusDecision | undefined): StaticVerdictDecision => {
  if (verdict.validity === "unverified") return { kind: "accept" }
  if (verdict.validity === "valid") {
    if (consensus !== "agreed-valid")
      return withhold(
        "The claim is not established by both verification directions.",
        "A valid verdict without execution evidence needs the forward direction to reach the path and the backward direction to reconstruct the impact; that consensus was not reached, so the result remains unresolved.",
      )
    return verdict.citesEvidence.length > 0
      ? { kind: "accept" }
      : withhold(
          "The valid verdict cites no source evidence.",
          "Both directions support the claim, but a static valid verdict must cite snapshot lines that the harness can resolve; none were cited, so the result remains unresolved.",
        )
  }
  if (consensus !== "agreed-invalid")
    return withhold(
      "The rejection is not supported by both verification directions.",
      "An invalid verdict without execution evidence needs both directions to find the path blocked; that consensus was not reached, so the result remains unresolved.",
    )
  return citesGuard(verdict)
    ? { kind: "accept" }
    : withhold(
        "No blocking guard was confirmed in the cited source.",
        "Both directions report the path as blocked, but none of the cited snapshot lines contains a blocking check (require, revert, assert or an access modifier), so the rejection is not confirmed and the result remains unresolved.",
      )
}
