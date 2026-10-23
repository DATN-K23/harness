import type { BudgetLimits } from "@harness/protocol"
import type { VerificationDirection } from "./bidirectional-verifier"

/**
 * Steps one verification direction may take, its answer included. Measured on Gemini 3.8 Flash (2026-10-23): the model
 * never ends its reading on its own (8-10 tool steps in every forward direction), while 4-6 reads already reached the
 * code the report points to. The backward direction starts with everything the forward one read.
 */
export const DefaultVerificationStepBudget = 6

/**
 * No practical step limit: a run config must record a finite number (its canonical JSON cannot hold Infinity), so the
 * step count is set far beyond any run. Runs end on the phase budgets, the verdict, or these limits instead.
 */
export const UnlimitedSteps = 10_000

/**
 * Judge run limits. Steps are not limited (`UnlimitedSteps`); each verification direction is still forced to answer at
 * its own budget, so a run reaches its verdict. What bounds a run is its tokens and wall clock: a step re-sends the
 * growing context (3-10k tokens per step, about 600 more each step in the 2026-10-23 traces) and Gemini answers in
 * 2-25 s per step.
 */
export const JudgeDefaultLimits: BudgetLimits = {
  maxSteps: UnlimitedSteps,
  totalTokenBudget: 400_000,
  wallClockTimeoutMs: 900_000,
  noProgressMaxRepeats: 3,
}

/** Steps a run must keep after the current one to finish: the backward answer (if forward is pending), the verdict, one repair. */
export const stepsStillNeeded = (pending: VerificationDirection) => (pending === "forward" ? 1 : 0) + 2
