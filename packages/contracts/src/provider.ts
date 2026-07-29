import { z } from "zod";
import {
  JsonObjectSchema,
  MessageIdSchema,
  RunIdSchema,
  ToolCallIdSchema,
  TurnIdSchema,
} from "./common.js";
import { ModelReferenceSchema } from "./run.js";
import { ToolDefinitionSchema } from "./tool.js";

export const ProviderAttemptIdSchema = z.string().trim().min(1);

export const ProviderToolCallRequestSchema = z.strictObject({
  tool_call_id: ToolCallIdSchema,
  tool_id: z.string().trim().min(1),
  input: JsonObjectSchema,
});

export const ProviderMessageSchema = z.discriminatedUnion("role", [
  z.strictObject({
    message_id: MessageIdSchema,
    role: z.literal("user"),
    content: z.string(),
  }),
  z.strictObject({
    message_id: MessageIdSchema,
    role: z.literal("assistant"),
    content: z.string().nullable(),
    tool_calls: z.array(ProviderToolCallRequestSchema),
  }),
  z.strictObject({
    message_id: MessageIdSchema,
    role: z.literal("tool"),
    tool_call_id: ToolCallIdSchema,
    content: z.string(),
  }),
]);

export const GenerationControlsSchema = z.strictObject({
  max_output_tokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2).nullable(),
});

export const ProviderRequestSchema = z.strictObject({
  provider_attempt_id: ProviderAttemptIdSchema,
  run_id: RunIdSchema,
  turn_id: TurnIdSchema,
  model: ModelReferenceSchema,
  system_context: z.string().min(1),
  messages: z.array(ProviderMessageSchema),
  visible_tools: z.array(ToolDefinitionSchema),
  structured_output_schema: JsonObjectSchema,
  generation: GenerationControlsSchema,
  provider_options: JsonObjectSchema,
});

export const TokenUsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  reasoning_tokens: z.number().int().nonnegative().nullable(),
  cached_input_tokens: z.number().int().nonnegative().nullable(),
});

export const ProviderFinishReasonSchema = z.enum([
  "final_result",
  "tool_calls",
  "length",
  "content_filter",
  "cancelled",
  "error",
  "other",
]);

export const ProviderErrorSchema = z.strictObject({
  category: z.enum([
    "invalid_request",
    "authentication",
    "rate_limit",
    "transient",
    "cancelled",
    "internal",
  ]),
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  retryable: z.boolean(),
  metadata: JsonObjectSchema,
});

const ModelEventBaseShape = {
  provider_attempt_id: ProviderAttemptIdSchema,
};

export const ModelEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...ModelEventBaseShape,
    type: z.literal("response_started"),
    provider_response_id: z.string().trim().min(1),
    metadata: JsonObjectSchema,
  }),
  z.strictObject({
    ...ModelEventBaseShape,
    type: z.literal("text_delta"),
    delta: z.string(),
  }),
  z.strictObject({
    ...ModelEventBaseShape,
    type: z.literal("reasoning_delta"),
    delta: z.string(),
  }),
  z.strictObject({
    ...ModelEventBaseShape,
    type: z.literal("tool_input_started"),
    provider_tool_call_id: z.string().trim().min(1),
    tool_id: z.string().trim().min(1),
  }),
  z.strictObject({
    ...ModelEventBaseShape,
    type: z.literal("tool_input_delta"),
    provider_tool_call_id: z.string().trim().min(1),
    delta: z.string(),
  }),
  z.strictObject({
    ...ModelEventBaseShape,
    type: z.literal("tool_call"),
    provider_tool_call_id: z.string().trim().min(1),
    tool_id: z.string().trim().min(1),
    input: JsonObjectSchema,
  }),
  z.strictObject({
    ...ModelEventBaseShape,
    type: z.literal("usage"),
    usage: TokenUsageSchema,
  }),
  z.strictObject({
    ...ModelEventBaseShape,
    type: z.literal("finish"),
    reason: ProviderFinishReasonSchema,
    metadata: JsonObjectSchema,
  }),
  z.strictObject({
    ...ModelEventBaseShape,
    type: z.literal("error"),
    error: ProviderErrorSchema,
  }),
]);

export type ProviderAttemptId = z.infer<typeof ProviderAttemptIdSchema>;
export type ProviderToolCallRequest = z.infer<
  typeof ProviderToolCallRequestSchema
>;
export type ProviderMessage = z.infer<typeof ProviderMessageSchema>;
export type GenerationControls = z.infer<typeof GenerationControlsSchema>;
export type ProviderRequest = z.infer<typeof ProviderRequestSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type ProviderFinishReason = z.infer<typeof ProviderFinishReasonSchema>;
export type ProviderError = z.infer<typeof ProviderErrorSchema>;
export type ModelEvent = z.infer<typeof ModelEventSchema>;
