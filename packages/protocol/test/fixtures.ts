import type { ContextItem, ContextPolicy } from "../src/context"
import type { RunConfigSnapshot } from "../src/run-config"
import type { JudgeVerdict } from "../src/verdict"

export const digest = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`

export const contextPolicy = (): ContextPolicy => ({
  policyVersion: "v1",
  windowLimitTokens: 100000,
  outputReserveTokens: 4000,
  compactionThreshold: 0.8,
  safetyMarginFactor: 1.2,
  recentWindowTokens: 20000,
  toolOutputMaxTokens: 4000,
  toolOutputMaxLines: 200,
  maxCompactions: 2,
  flags: {
    enableToolTruncation: true,
    enableObsMasking: true,
    enableSupersedeReads: true,
    enableDropEmpty: true,
    enableLlmCompaction: true,
    enableSessionNote: false,
  },
})

export const snapshot = (): RunConfigSnapshot => ({
  flags: {
    enableToolTruncation: true,
    enableObsMasking: true,
    enableSupersedeReads: true,
    enableDropEmpty: true,
    enableLlmCompaction: true,
    enableSessionNote: false,
    enableSchemaRepair: true,
    enableMaxStepsForcing: true,
    enableNoProgressDetection: true,
    enableInfraRetry: true,
    enableParallelToolDispatch: true,
  },
  contextPolicy: contextPolicy(),
  retry: {
    maxRetries: 5,
    maxTimeoutRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 10000,
    jitterMs: 1000,
    retryableStatuses: [429, 500, 503],
  },
  budget: {
    wallClockTimeoutMs: 600000,
    totalTokenBudget: 500000,
    maxSteps: 20,
    noProgressMaxRepeats: 3,
  },
  maxProbeRuns: 2,
  enablePocExecution: false,
  systemPromptDigest: digest("a"),
  verdictSchemaDigest: digest("b"),
})

export const legacySnapshot = () => {
  const { safetyMarginFactor: _newField, ...legacyPolicy } = contextPolicy()
  return { ...snapshot(), contextPolicy: legacyPolicy }
}

export const contextItem = (overrides: Partial<ContextItem> = {}): ContextItem => ({
  id: "item-1",
  turn: 1,
  type: "assistant_reasoning",
  isPinned: false,
  content: "thinking",
  ...overrides,
})

export const verdict = (): JudgeVerdict => ({
  runId: "run-1",
  findingId: "finding-1",
  validity: "invalid",
  verificationStatus: "FAIL",
  reasonCode: "MISSING_POC",
  confidence: "HIGH",
  summary: "Rejected because the report has no executable PoC.",
  reasoning: "The report does not contain a Foundry test block, so Judge Mode cannot verify the claim.",
  citesEvidence: [],
})
