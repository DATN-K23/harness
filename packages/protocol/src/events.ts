import { z } from "zod"
import { ContextItemSchema, PrepareTelemetrySchema, TransformationSchema } from "./context"
import { ModelUsageSchema, ProviderErrorCategorySchema, TokenUsageSchema, FinishReasons } from "./model-gateway"
import { RunConfigSnapshotSchema, Sha256DigestSchema } from "./run-config"
import { BudgetTerminalReasonSchema, TerminalReasonSchema } from "./stop-conditions"
import { VerdictReasonCodes, JudgeVerdictSchema } from "./verdict"

export const RunStates = [
  "accepted",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "budget_exhausted",
] as const

export type RunState = (typeof RunStates)[number]

export const TerminalRunStates = ["completed", "failed", "cancelled", "budget_exhausted"] as const

export type TerminalRunState = (typeof TerminalRunStates)[number]

export const BlueprintEventTypes = [
  "run.accepted",
  "run.queued",
  "run.started",
  "context.allocated",
  "context.transformed",
  "provider.attempted",
  "provider.failed",
  "model.responded",
  "tool.requested",
  "tool.completed",
  "tool.failed",
  "security.blocked",
  "finding.discovered",
  "finding.validated",
  "verdict.validation_failed",
  "run.cancel_requested",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.budget_exhausted",
] as const

/** Names the TV1 documents already use that `blueprint/vocabulary.md` does not list yet (gate G6). */
export const Tv1EventTypes = [
  "context.item_added",
  "context.compacted",
  "stage.started",
  "stage.finished",
  "step.started",
] as const

export const EventTypes = [...BlueprintEventTypes, ...Tv1EventTypes] as const

export type EventType = (typeof EventTypes)[number]

export const EventTypeSchema = z.enum(EventTypes)

export const EventSchemaVersion = 1

export const StageNames = ["ingestion", "sanitizer", "sandbox", "agent_loop", "verdict_synthesis"] as const

export const CancellationBoundaries = [
  "before_ingestion",
  "before_sandbox",
  "before_provider_call",
  "before_tool_dispatch",
] as const

export const RetryDecisions = ["none", "retry", "permanent", "exhausted", "context_overflow", "disabled"] as const

/**
 * A denied input as the model supplied it, relative to the snapshot. `..` segments are allowed because the
 * attempted traversal is exactly what gets recorded. Absolute host paths are rejected: `@harness/core` must replace
 * an absolute-looking denied input with the literal string `<absolute path redacted>` before appending the event.
 */
export const AbsolutePathRedactedPlaceholder = "<absolute path redacted>"

const absoluteHostPath = /^(?:[\\/]|[A-Za-z]:|file:\/\/)/i

const NormalizedRelativeInputSchema = z
  .string()
  .refine((input) => !absoluteHostPath.test(input), { message: "input must be relative, not an absolute host path" })

const OpenPayloadSchema = z.record(z.string(), z.unknown())

const ToolIdentitySchema = z.object({
  callIndex: z.number().int().nonnegative(),
  callId: z.string(),
  toolName: z.string(),
})

/** Payload contract per event type. Adding an event type without an entry here is a compile error. */
export const EventPayloadSchemas = {
  "run.accepted": OpenPayloadSchema,
  "run.queued": OpenPayloadSchema,
  "run.started": z.object({ snapshot: RunConfigSnapshotSchema, snapshotDigest: Sha256DigestSchema }),
  "context.allocated": z.object({ stepIndex: z.number().int().positive(), telemetry: PrepareTelemetrySchema }),
  "context.transformed": TransformationSchema,
  "provider.attempted": z.object({
    stepIndex: z.number().int().positive(),
    attemptIndex: z.number().int().nonnegative(),
    profileId: z.string(),
    usage: TokenUsageSchema,
    costUsd: z.number().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    errorCategory: ProviderErrorCategorySchema.optional(),
    retryDecision: z.enum(RetryDecisions),
    backoffMs: z.number().int().nonnegative(),
  }),
  "provider.failed": OpenPayloadSchema,
  "model.responded": z.object({
    stepIndex: z.number().int().positive(),
    attemptIndex: z.number().int().nonnegative(),
    finishReason: z.enum(FinishReasons),
    toolCallCount: z.number().int().nonnegative(),
  }),
  "tool.requested": ToolIdentitySchema.extend({ arguments: z.record(z.string(), z.unknown()) }),
  "tool.completed": ToolIdentitySchema.extend({
    durationMs: z.number().int().nonnegative(),
    isTruncated: z.boolean(),
    itemId: z.string(),
  }),
  "tool.failed": ToolIdentitySchema.extend({ durationMs: z.number().int().nonnegative(), message: z.string() }),
  "security.blocked": z.object({
    ruleId: z.string(),
    input: NormalizedRelativeInputSchema,
    toolName: z.string().optional(),
    callId: z.string().optional(),
  }),
  "finding.discovered": OpenPayloadSchema,
  "finding.validated": OpenPayloadSchema,
  "verdict.validation_failed": z.object({
    attempt: z.number().int().positive(),
    issues: z.array(
      z.strictObject({
        reason: z.enum(VerdictReasonCodes),
        path: z.array(z.union([z.string(), z.number()])),
      }),
    ),
  }),
  "run.cancel_requested": OpenPayloadSchema,
  "run.completed": z.object({ verdict: JudgeVerdictSchema }),
  "run.failed": z.object({ reason: TerminalReasonSchema, message: z.string() }),
  "run.cancelled": z.object({ reason: TerminalReasonSchema, boundary: z.enum(CancellationBoundaries) }),
  "run.budget_exhausted": z.object({
    reason: BudgetTerminalReasonSchema,
    observedLimits: z.array(BudgetTerminalReasonSchema),
  }),
  "context.item_added": z.object({ item: ContextItemSchema }),
  "context.compacted": z.object({
    replacedItemIds: z.array(z.string()),
    summaryItem: ContextItemSchema,
    usage: ModelUsageSchema,
  }),
  "stage.started": z.object({ stage: z.enum(StageNames) }),
  "stage.finished": z.object({
    stage: z.enum(StageNames),
    outcome: z.enum(["ok", "rejected", "failed"]),
    reasonCode: z.string().optional(),
    durationMs: z.number().int().nonnegative(),
  }),
  "step.started": z.object({ stepIndex: z.number().int().positive(), toolsDisabled: z.boolean() }),
} satisfies Record<EventType, z.ZodType>

export type EventPayload<Type extends EventType> = z.infer<(typeof EventPayloadSchemas)[Type]>

const payloadSchemas: Record<EventType, z.ZodType> = EventPayloadSchemas

/** Keys compared after lower-casing and dropping everything that is not a letter (`API-KEY` -> `apikey`). */
const forbiddenPayloadKeys: ReadonlySet<string> = new Set([
  "label",
  "labels",
  "groundtruth",
  "adjudication",
  "adjudicationreport",
  "score",
  "scorermetadata",
  "hostpath",
  "apikey",
  "password",
  "secret",
  "credentials",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "bearer",
  "privatekey",
])

/**
 * Raw model-supplied subtrees are recorded as data and must always be recordable, so the key scan skips them.
 * Every other, system-authored payload field is scanned.
 */
const modelSuppliedFields: Partial<Record<EventType, readonly string[]>> = {
  "tool.requested": ["arguments"],
}

const forbiddenKeyPaths = (value: unknown, path: Array<string | number>): Array<Array<string | number>> => {
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenKeyPaths(item, [...path, index]))
  if (value === null || typeof value !== "object") return []
  return Object.entries(value).flatMap(([key, inner]) =>
    forbiddenPayloadKeys.has(key.toLowerCase().replaceAll(/[^a-z]/g, ""))
      ? [[...path, key]]
      : forbiddenKeyPaths(inner, [...path, key]),
  )
}

export const TrajectoryEventSchema = z
  .object({
    eventId: z.string().min(1),
    runId: z.string().min(1),
    sequence: z.number().int().min(1),
    type: EventTypeSchema,
    schemaVersion: z.number().int().min(1),
    payload: OpenPayloadSchema,
    payloadDigest: Sha256DigestSchema,
    occurredAt: z.iso.datetime(),
  })
  .superRefine((event, ctx) => {
    const parsed = payloadSchemas[event.type].safeParse(event.payload)
    if (!parsed.success)
      parsed.error.issues.forEach((issue) =>
        ctx.addIssue({
          code: "custom",
          path: ["payload", ...issue.path.map((segment) => (typeof segment === "symbol" ? String(segment) : segment))],
          message: issue.message,
        }),
      )
    const exempt = modelSuppliedFields[event.type] ?? []
    const scanned = Object.fromEntries(Object.entries(event.payload).filter(([key]) => !exempt.includes(key)))
    forbiddenKeyPaths(scanned, ["payload"]).forEach((path) =>
      ctx.addIssue({
        code: "custom",
        path,
        message: "payload must not contain credentials, labels, ground truth or scorer metadata",
      }),
    )
  })

export type TrajectoryEvent = z.infer<typeof TrajectoryEventSchema>
