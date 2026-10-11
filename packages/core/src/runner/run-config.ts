import {
  DefaultMaxProbeRuns,
  RunConfigSnapshotSchema,
  type BudgetLimits,
  type ContextPolicy,
  type ResolvedFlags,
  type RetryConfig,
  type RunConfigSnapshot,
} from "@harness/protocol"
import { digestOf } from "../util/digest"

export interface RunConfigInput {
  flags: ResolvedFlags
  policy: ContextPolicy
  retry: RetryConfig
  limits: BudgetLimits
  maxProbeRuns?: number
  systemPromptDigest: string
  verdictSchemaDigest: string
}

export interface BuiltRunConfig {
  snapshot: RunConfigSnapshot
  /** SHA-256 over the canonical JSON of `snapshot`; the value `run.started` records as `snapshotDigest`. */
  digest: string
}

/**
 * Resolves the configuration a run starts with into the protocol snapshot and its digest. The snapshot is parsed, so a
 * malformed digest, a missing field or context flags that disagree with `policy.flags` throw before a run starts.
 */
export const buildRunConfigSnapshot = (input: RunConfigInput): BuiltRunConfig => {
  const snapshot = RunConfigSnapshotSchema.parse({
    flags: input.flags,
    contextPolicy: input.policy,
    retry: input.retry,
    budget: input.limits,
    maxProbeRuns: input.maxProbeRuns ?? DefaultMaxProbeRuns,
    systemPromptDigest: input.systemPromptDigest,
    verdictSchemaDigest: input.verdictSchemaDigest,
  })
  return { snapshot, digest: digestOf(snapshot) }
}
