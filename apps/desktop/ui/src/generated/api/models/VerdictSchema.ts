/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EvidenceSchema } from "./EvidenceSchema";
export type VerdictSchema = {
  schemaVersion?: string;
  validity: string;
  severity: string;
  confidence: number;
  rationale: string;
  evidence?: Array<EvidenceSchema>;
  verificationStatus?: string;
  labelNormalizationVersion?: string;
};
