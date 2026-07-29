export const DomainInvariantErrorCode = {
  invalidRun: "INVALID_RUN",
  invalidRunTransition: "INVALID_RUN_TRANSITION",
  invalidVerdict: "INVALID_VERDICT",
  invalidStopReason: "INVALID_STOP_REASON",
  invalidTimestamp: "INVALID_TIMESTAMP",
  invalidToolCall: "INVALID_TOOL_CALL",
  invalidToolCallTransition: "INVALID_TOOL_CALL_TRANSITION",
  toolCallAlreadySettled: "TOOL_CALL_ALREADY_SETTLED",
  invalidToolResult: "INVALID_TOOL_RESULT",
  invalidToolError: "INVALID_TOOL_ERROR",
} as const;

export type DomainInvariantErrorCode =
  (typeof DomainInvariantErrorCode)[keyof typeof DomainInvariantErrorCode];

export type InvariantErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export class DomainInvariantError extends Error {
  readonly code: DomainInvariantErrorCode;
  readonly details: InvariantErrorDetails;

  constructor(
    code: DomainInvariantErrorCode,
    message: string,
    details: InvariantErrorDetails = {},
  ) {
    super(message);
    this.name = "DomainInvariantError";
    this.code = code;
    this.details = details;
  }
}
