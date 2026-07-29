import { z } from "zod";
import {
  ArtifactRefSchema,
  FindingIdSchema,
  RunIdSchema,
  SchemaVersionSchema,
  Sha256Schema,
  TimestampSchema,
  VerificationIdSchema,
} from "./common.js";

export const SeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "informational",
  "unknown",
]);

export const FindingVerificationStatusSchema = z.enum([
  "verified",
  "rejected",
  "unverified",
  "not_attempted",
]);

export const FindingLocationSchema = z.strictObject({
  path: z.string().trim().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
});

export const FindingSchema = z.strictObject({
  finding_id: FindingIdSchema,
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  severity: SeveritySchema,
  locations: z.array(FindingLocationSchema).min(1),
  impact: z.string().trim().min(1),
  preconditions: z.array(z.string().trim().min(1)),
  evidence_refs: z.array(ArtifactRefSchema),
  verification_status: FindingVerificationStatusSchema,
  confidence: z.number().min(0).max(1),
});

export const WorkspaceReferenceSchema = z.strictObject({
  source_ref: z.string().trim().min(1),
  source_hash: Sha256Schema,
});

export const JudgeInputSchema = z.strictObject({
  run_id: RunIdSchema,
  finding: FindingSchema,
  workspace: WorkspaceReferenceSchema,
});

export const JudgeClassificationSchema = z.enum([
  "valid",
  "invalid",
  "uncertain",
]);

export const JudgeVerdictSchema = z.strictObject({
  classification: JudgeClassificationSchema,
  severity: SeveritySchema,
  reasoning_summary: z.string().trim().min(1),
  evidence_refs: z.array(ArtifactRefSchema),
});

const VerificationResultBaseShape = {
  schema_version: SchemaVersionSchema,
  verification_id: VerificationIdSchema,
  finding_id: FindingIdSchema,
  summary: z.string().trim().min(1),
  evidence_refs: z.array(ArtifactRefSchema),
  started_at: TimestampSchema,
  completed_at: TimestampSchema,
};

export const VerificationFailureReasonSchema = z.enum([
  "build_failed",
  "environment_unavailable",
  "dependency_missing",
  "insufficient_evidence",
  "timeout",
  "cancelled",
  "internal_error",
]);

export const VerificationResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...VerificationResultBaseShape,
    status: z.literal("verified"),
    exit_code: z.number().int(),
  }),
  z.strictObject({
    ...VerificationResultBaseShape,
    status: z.literal("rejected"),
    exit_code: z.number().int(),
  }),
  z.strictObject({
    ...VerificationResultBaseShape,
    status: z.literal("unverified"),
    reason: VerificationFailureReasonSchema,
    exit_code: z.number().int().nullable(),
  }),
]);

export type Severity = z.infer<typeof SeveritySchema>;
export type FindingVerificationStatus = z.infer<
  typeof FindingVerificationStatusSchema
>;
export type FindingLocation = z.infer<typeof FindingLocationSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type WorkspaceReference = z.infer<typeof WorkspaceReferenceSchema>;
export type JudgeInput = z.infer<typeof JudgeInputSchema>;
export type JudgeClassification = z.infer<typeof JudgeClassificationSchema>;
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;
export type VerificationFailureReason = z.infer<
  typeof VerificationFailureReasonSchema
>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
