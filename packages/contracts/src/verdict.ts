/**
 * @file verdict.ts
 * @description Hợp đồng dữ liệu Verdict theo đặc tả judge-verdict-v1
 */

import type {
  VerdictValidity,
  VerificationStatus,
  SeverityLevel,
} from "./enums.js";

export interface EvidenceItem {
  path: string;
  start_line: number;
  end_line: number;
  content_digest?: string | null;
  note?: string | null;
}

export interface Verdict {
  id?: string;
  runId?: string;
  schemaVersion?: string;
  validity: VerdictValidity;
  severity: SeverityLevel;
  confidence: number;
  rationale: string;
  evidence?: EvidenceItem[] | null;
  verificationStatus?: VerificationStatus;
  labelNormalizationVersion?: string;
  timestamp?: string | Date;
}
