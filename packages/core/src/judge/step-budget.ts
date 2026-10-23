import type { BudgetLimits } from "@harness/protocol"
import type { VerificationDirection } from "./bidirectional-verifier"

/**
 * Steps one verification direction may take, its answer included. Measured on Gemini 3.8 Flash (2026-10-23): the model
 * never ends its reading on its own (8-10 tool steps in every forward direction), while 4-6 reads already reached the
 * code the report points to. The backward direction starts with everything the forward one read.
 */
export const DefaultVerificationStepBudget = 6

/**
 * Judge run limits sized for bidirectional verification: forward and backward direction budgets (6 + 6) plus a verdict
 * phase of up to 8 steps. A step re-sends the growing context (3-10k tokens per step, about 600 more each step in the
 * same traces), so 20 steps need about 190-230k tokens; the budget keeps a margin. Gemini answers in 2-25 s per step.
 */
export const JudgeDefaultLimits: BudgetLimits = {
  maxSteps: 20,
  totalTokenBudget: 400_000,
  wallClockTimeoutMs: 900_000,
  noProgressMaxRepeats: 3,
}

/** Steps a run must keep after the current one to finish: the backward answer (if forward is pending), the verdict, one repair. */
export const stepsStillNeeded = (pending: VerificationDirection) => (pending === "forward" ? 1 : 0) + 2
