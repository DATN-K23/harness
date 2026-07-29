import { z } from "zod";
import {
  ArtifactRefSchema,
  JsonObjectSchema,
  RunIdSchema,
  SemanticVersionSchema,
  TimestampSchema,
  ToolCallIdSchema,
  TurnIdSchema,
} from "./common.js";

export const ToolCallStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "error",
  "denied",
  "cancelled",
]);

export const ToolCapabilitySchema = z.enum([
  "read_workspace",
  "write_workspace",
  "execute_process",
  "network",
]);

export const ToolDefinitionSchema = z.strictObject({
  id: z.string().trim().min(1),
  version: SemanticVersionSchema,
  description: z.string().trim().min(1),
  capability: ToolCapabilitySchema,
  input_schema: JsonObjectSchema,
});

export const ToolResultSchema = z.strictObject({
  title: z.string().trim().min(1),
  model_output: z.string(),
  artifact_refs: z.array(ArtifactRefSchema),
  metadata: JsonObjectSchema,
});

const ToolErrorBaseShape = {
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  model_message: z.string().trim().min(1),
  details: JsonObjectSchema,
};

export const ToolErrorSchema = z.discriminatedUnion("category", [
  z.strictObject({
    ...ToolErrorBaseShape,
    category: z.literal("invalid_input"),
    retryable: z.literal(true),
  }),
  z.strictObject({
    ...ToolErrorBaseShape,
    category: z.literal("permission_denied"),
    retryable: z.literal(false),
  }),
  z.strictObject({
    ...ToolErrorBaseShape,
    category: z.literal("budget_exceeded"),
    retryable: z.literal(false),
  }),
  z.strictObject({
    ...ToolErrorBaseShape,
    category: z.literal("execution_failed"),
    retryable: z.boolean(),
  }),
  z.strictObject({
    ...ToolErrorBaseShape,
    category: z.literal("cancelled"),
    retryable: z.literal(false),
  }),
  z.strictObject({
    ...ToolErrorBaseShape,
    category: z.literal("internal"),
    retryable: z.literal(false),
  }),
]);

const ToolCallBaseShape = {
  tool_call_id: ToolCallIdSchema,
  run_id: RunIdSchema,
  turn_id: TurnIdSchema,
  tool_id: z.string().trim().min(1),
  tool_version: SemanticVersionSchema,
  raw_input: JsonObjectSchema,
  requested_at: TimestampSchema,
};

export const ToolCallSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...ToolCallBaseShape,
    status: z.literal("pending"),
  }),
  z.strictObject({
    ...ToolCallBaseShape,
    status: z.literal("running"),
    validated_input: JsonObjectSchema,
    started_at: TimestampSchema,
  }),
  z.strictObject({
    ...ToolCallBaseShape,
    status: z.literal("completed"),
    validated_input: JsonObjectSchema,
    started_at: TimestampSchema,
    settled_at: TimestampSchema,
    result: ToolResultSchema,
  }),
  z.strictObject({
    ...ToolCallBaseShape,
    status: z.literal("error"),
    started_at: TimestampSchema.nullable(),
    settled_at: TimestampSchema,
    error: ToolErrorSchema,
  }),
  z.strictObject({
    ...ToolCallBaseShape,
    status: z.literal("denied"),
    settled_at: TimestampSchema,
    error: ToolErrorSchema,
  }),
  z.strictObject({
    ...ToolCallBaseShape,
    status: z.literal("cancelled"),
    started_at: TimestampSchema.nullable(),
    settled_at: TimestampSchema,
    error: ToolErrorSchema,
  }),
]);

export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ToolError = z.infer<typeof ToolErrorSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
