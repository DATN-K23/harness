import { z } from "zod";

function systemId(description: string) {
  return z.string().trim().min(1).describe(description);
}

export const RunIdSchema = systemId("System-generated run identifier");
export const TurnIdSchema = systemId(
  "System-generated provider turn identifier",
);
export const MessageIdSchema = systemId("System-generated message identifier");
export const ToolCallIdSchema = systemId(
  "System-generated tool call identifier",
);
export const EventIdSchema = systemId("System-generated run event identifier");
export const FindingIdSchema = systemId("System-generated finding identifier");
export const VerificationIdSchema = systemId(
  "System-generated verification identifier",
);

export const SchemaVersionSchema = z
  .literal(1)
  .describe(
    "Contract schema version; increment only when shape or semantics change",
  );
export const SemanticVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/u)
  .describe("Semantic version in major.minor.patch form");
export const Sha256Schema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u)
  .describe("Lowercase SHA-256 digest prefixed with sha256:");
export const TimestampSchema = z.iso
  .datetime({ offset: true })
  .describe("ISO-8601 timestamp with timezone; persisted in UTC");
export const ArtifactRefSchema = z
  .string()
  .trim()
  .min(1)
  .describe("Opaque reference to an immutable artifact");

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  JsonValueSchema,
);

export type RunId = z.infer<typeof RunIdSchema>;
export type TurnId = z.infer<typeof TurnIdSchema>;
export type MessageId = z.infer<typeof MessageIdSchema>;
export type ToolCallId = z.infer<typeof ToolCallIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type FindingId = z.infer<typeof FindingIdSchema>;
export type VerificationId = z.infer<typeof VerificationIdSchema>;
export type Sha256 = z.infer<typeof Sha256Schema>;
