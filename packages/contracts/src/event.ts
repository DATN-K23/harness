import { z } from "zod";
import {
  EventIdSchema,
  FindingIdSchema,
  JsonObjectSchema,
  RunIdSchema,
  SchemaVersionSchema,
  Sha256Schema,
  TimestampSchema,
  ToolCallIdSchema,
  TurnIdSchema,
} from "./common.js";
import { JudgeVerdictSchema } from "./finding.js";
import {
  ProviderAttemptIdSchema,
  ProviderErrorSchema,
  ProviderFinishReasonSchema,
  TokenUsageSchema,
} from "./provider.js";
import { RunConfigSnapshotSchema, RunStatusSchema } from "./run.js";
import { ToolErrorSchema, ToolResultSchema } from "./tool.js";

const RunEventEnvelopeShape = {
  event_id: EventIdSchema,
  run_id: RunIdSchema,
  sequence: z.number().int().positive(),
  occurred_at: TimestampSchema,
  schema_version: SchemaVersionSchema,
};

const runtimeErrorSchema = z.strictObject({
  category: z.enum([
    "invalid_input",
    "budget_exceeded",
    "provider_error",
    "cancelled",
    "internal",
  ]),
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  details: JsonObjectSchema,
});

export const RunEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("run_created"),
    payload: z.strictObject({
      status: z.literal("queued"),
      config_snapshot: RunConfigSnapshotSchema,
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("run_started"),
    payload: z.strictObject({
      status: z.literal("running"),
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("provider_turn_started"),
    payload: z.strictObject({
      turn_id: TurnIdSchema,
      provider_attempt_id: ProviderAttemptIdSchema,
      prompt_hash: Sha256Schema,
      visible_tool_ids: z.array(z.string().trim().min(1)),
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("tool_call_requested"),
    payload: z.strictObject({
      turn_id: TurnIdSchema,
      tool_call_id: ToolCallIdSchema,
      provider_tool_call_id: z.string().trim().min(1),
      tool_id: z.string().trim().min(1),
      raw_input: JsonObjectSchema,
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("provider_turn_completed"),
    payload: z.strictObject({
      turn_id: TurnIdSchema,
      provider_attempt_id: ProviderAttemptIdSchema,
      finish_reason: ProviderFinishReasonSchema,
      usage: TokenUsageSchema,
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("tool_call_started"),
    payload: z.strictObject({
      turn_id: TurnIdSchema,
      tool_call_id: ToolCallIdSchema,
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("tool_call_completed"),
    payload: z.strictObject({
      turn_id: TurnIdSchema,
      tool_call_id: ToolCallIdSchema,
      result: ToolResultSchema,
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("tool_call_failed"),
    payload: z.strictObject({
      turn_id: TurnIdSchema,
      tool_call_id: ToolCallIdSchema,
      error: ToolErrorSchema,
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("provider_turn_failed"),
    payload: z.strictObject({
      turn_id: TurnIdSchema,
      provider_attempt_id: ProviderAttemptIdSchema,
      error: ProviderErrorSchema,
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("verdict_produced"),
    payload: z.strictObject({
      finding_id: FindingIdSchema,
      verdict: JudgeVerdictSchema,
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("run_completed"),
    payload: z.strictObject({
      status: z.literal("completed"),
      verdict: JudgeVerdictSchema,
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("run_failed"),
    payload: z.strictObject({
      status: z.literal("failed"),
      error: runtimeErrorSchema,
    }),
  }),
  z.strictObject({
    ...RunEventEnvelopeShape,
    type: z.literal("run_cancelled"),
    payload: z.strictObject({
      status: z.literal("cancelled"),
      reason: z.string().trim().min(1),
    }),
  }),
]);

export const TerminalRunStatusSchema = RunStatusSchema.extract([
  "completed",
  "failed",
  "cancelled",
]);

export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent["type"];
export type TerminalRunStatus = z.infer<typeof TerminalRunStatusSchema>;
