import type { BudgetLimits } from "@harness/protocol"
import type { VerificationDirection } from "./bidirectional-verifier"

/**
 * No practical step limit: a run config must record a finite number (its canonical JSON cannot hold Infinity), so the
 * step count is set far beyond any run. Runs end on the phase budgets, the verdict, or these limits instead.
 */
export const UnlimitedSteps = 10_000

/**
 * Judge run limits. Steps are not limited (`UnlimitedSteps`), per run or per direction; a direction is forced to answer
 * once the tokens left only cover finishing the run (`mustAnswerNow`), so a run still reaches its verdict. What bounds a run is its tokens and wall clock: a step re-sends the
 * growing context (3-10k tokens per step, about 600 more each step in the 2026-10-23 traces) and Gemini answers in
 * 2-25 s per step.
 */
export const JudgeDefaultLimits: BudgetLimits = {
  maxSteps: UnlimitedSteps,
  totalTokenBudget: 400_000,
  wallClockTimeoutMs: 900_000,
  noProgressMaxRepeats: 3,
}

/**
 * Steps one verification direction may take, its answer included: none in practice. The model reads as long as the run
 * can afford it; a direction is forced to answer only when the remaining tokens just cover finishing the run
 * (`mustAnswerNow`). Set `verificationStepBudget` to cap a direction by steps instead (R1-recorded either way).
 */
export const DefaultVerificationStepBudget = UnlimitedSteps

/** Steps a run must keep after the current one to finish: the backward answer (if forward is pending), the verdict, one repair. */
export const stepsStillNeeded = (pending: VerificationDirection) => (pending === "forward" ? 1 : 0) + 2

/**
 * Whether a pending direction must answer in this step because the tokens left only cover finishing the run: this
 * step and every step still needed, each estimated at this step's prepared input plus the output allowance, with the
 * policy's safety margin. Measured on Gemini 3.8 Flash (2026-10-23), the model never ends its reading on its own, so
 * without this a run with unlimited steps reads until its token budget is gone and never reaches a verdict.
 */
export const mustAnswerNow = (input: {
  pending: VerificationDirection
  estimatedInputTokens: number
  maxOutputTokens: number
  safetyMarginFactor: number
  totalTokensUsed: number
  totalTokenBudget: number
}) => {
  const perStep = Math.ceil((input.estimatedInputTokens + input.maxOutputTokens) * input.safetyMarginFactor)
  return input.totalTokenBudget - input.totalTokensUsed < perStep * (1 + stepsStillNeeded(input.pending))
}

