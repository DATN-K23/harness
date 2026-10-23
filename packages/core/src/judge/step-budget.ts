import type { BudgetLimits, ContextItem } from "@harness/protocol"
import type { VerificationDirection } from "./bidirectional-verifier"

/**
 * No practical step limit: a run config must record a finite number (its canonical JSON cannot hold Infinity), so the
 * step count is set far beyond any run. Runs end on the phase budgets, the verdict, or these limits instead.
 */
export const UnlimitedSteps = 10_000

/**
 * Judge run limits, chosen for quality over cost: neither steps nor tokens constrain a run in practice. A direction ends
 * its reading once it stops finding new evidence (`isEvidenceSaturated`); the token and wall-clock limits are a safety
 * net only, and even at the token limit a direction is forced to answer (`mustAnswerNow`), so a run reaches its verdict.
 * Traces of 2026-10-23: 3-10k tokens per step, about 600 more each step; Gemini answers in 2-25 s per step.
 */
export const JudgeDefaultLimits: BudgetLimits = {
  maxSteps: UnlimitedSteps,
  totalTokenBudget: 5_000_000,
  wallClockTimeoutMs: 3_600_000,
  noProgressMaxRepeats: 3,
}

/**
 * Steps one verification direction may take, its answer included: none in practice. The model reads as long as the run
 * can afford it; a direction is forced to answer only when the remaining tokens just cover finishing the run
 * (`mustAnswerNow`). Set `verificationStepBudget` to cap a direction by steps instead (R1-recorded either way).
 */
export const DefaultVerificationStepBudget = UnlimitedSteps

/** The phase a run is in: a verification direction, or the verdict after an agreed consensus. */
export type ReadingPhase = VerificationDirection | "verdict"

/** Steps a run must keep after the current one to finish: the backward answer (if forward is pending), the verdict, one repair. */
export const stepsStillNeeded = (phase: ReadingPhase) => (phase === "forward" ? 3 : phase === "backward" ? 2 : 1)

/**
 * Whether a pending direction must answer in this step because the tokens left only cover finishing the run: this
 * step and every step still needed, each estimated at this step's prepared input plus the output allowance, with the
 * policy's safety margin. Measured on Gemini 3.8 Flash (2026-10-23), the model never ends its reading on its own, so
 * without this a run with unlimited steps reads until its token budget is gone and never reaches a verdict.
 */
export const mustAnswerNow = (input: {
  pending: ReadingPhase
  estimatedInputTokens: number
  maxOutputTokens: number
  safetyMarginFactor: number
  totalTokensUsed: number
  totalTokenBudget: number
}) => {
  const perStep = Math.ceil((input.estimatedInputTokens + input.maxOutputTokens) * input.safetyMarginFactor)
  return input.totalTokenBudget - input.totalTokensUsed < perStep * (1 + stepsStillNeeded(input.pending))
}

/** Consecutive tool results without new evidence after which a direction must answer. */
export const DefaultEvidenceSaturationReads = 3

/**
 * Whether the current phase (a verification direction, or the verdict) stopped finding evidence: its last `reads` tool
 * results all added nothing. A file read is new when it covers a line of that file no earlier result covered; a search
 * result when it names such a line; any other result (glob, list) when its text differs from every earlier result; an
 * error is never new. The model is free to read as long as reading
 * still turns up something (Gemini re-reads the same ranges once it has what it needs: traces of 2026-10-23).
 */
export const isEvidenceSaturated = (items: readonly ContextItem[], phaseSince: number, reads: number) => {
  const seenLines = new Map<string, Set<number>>()
  const seenTexts = new Set<string>()
  const novelty: boolean[] = []
  for (const item of items) {
    if (item.type !== "tool_result") continue
    let fresh = false
    if (item.toolMeta?.isError !== true) {
      const { filePath, lineRange } = item.toolMeta ?? {}
      if (filePath !== undefined && lineRange !== undefined) {
        const lines = seenLines.get(filePath) ?? new Set<number>()
        for (let line = lineRange[0]; line <= lineRange[1]; line++) {
          if (!lines.has(line)) fresh = true
          lines.add(line)
        }
        seenLines.set(filePath, lines)
      } else {
        // Search output lists `path:line: text`: new only if it names a line not seen before, so repeating or
        // rephrasing a search that finds the same code adds nothing. Other output is new when its text is.
        const hits = [...item.content.matchAll(/^(.+?):(\d+):/gm)]
        if (hits.length > 0) {
          for (const [, filePath, line] of hits) {
            const lines = seenLines.get(filePath!) ?? new Set<number>()
            if (!lines.has(Number(line))) fresh = true
            lines.add(Number(line))
            seenLines.set(filePath!, lines)
          }
        } else {
          fresh = !seenTexts.has(item.content)
          seenTexts.add(item.content)
        }
      }
    }
    if (item.turn > phaseSince) novelty.push(fresh)
  }
  return novelty.length >= reads && novelty.slice(-reads).every((fresh) => !fresh)
}

