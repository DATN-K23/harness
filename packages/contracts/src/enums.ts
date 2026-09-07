/**
 * @file enums.ts
 * @description Định nghĩa các enum và type chuẩn cho toàn bộ hệ sinh thái Harness
 */

export type RunStatus =
  "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type VerdictValidity = "valid" | "invalid";

export type VerificationStatus = "unverified";

export type SeverityLevel =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "none"
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "INFORMATIONAL";

export type VerdictStatus =
  "VALID" | "INVALID" | "UNVERIFIED" | "valid" | "invalid" | "unverified";

export type ModelEventType =
  "THOUGHT" | "TOOL_REQUEST" | "SYSTEM_PROMPT" | "ERROR";
