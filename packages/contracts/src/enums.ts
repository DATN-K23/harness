export type RunStatus =
  "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type VerdictStatus = "VALID" | "INVALID" | "UNVERIFIED";
export type SeverityLevel =
  "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";
export type ModelEventType =
  "THOUGHT" | "TOOL_REQUEST" | "SYSTEM_PROMPT" | "ERROR";
