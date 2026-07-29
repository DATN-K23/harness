import {
  JsonObjectSchema,
  TimestampSchema,
  ToolCallSchema,
  ToolErrorSchema,
  ToolResultSchema,
  type JsonObject,
  type ToolCall,
  type ToolError,
  type ToolResult,
} from "@audit-harness/contracts";
import { DomainInvariantError, DomainInvariantErrorCode } from "./errors.js";

const terminalStatuses = new Set<ToolCall["status"]>([
  "completed",
  "error",
  "denied",
  "cancelled",
]);

function parseTimestamp(value: unknown): string {
  const parsed = TimestampSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainInvariantError(
      DomainInvariantErrorCode.invalidTimestamp,
      "The transition timestamp must be an ISO-8601 value with timezone.",
    );
  }
  return parsed.data;
}

function assertNotBefore(
  timestamp: string,
  boundary: string,
  label: string,
): void {
  if (Date.parse(timestamp) < Date.parse(boundary)) {
    throw new DomainInvariantError(
      DomainInvariantErrorCode.invalidTimestamp,
      `${label} cannot be before ${boundary}.`,
      { timestamp, boundary },
    );
  }
}

function parseToolCall(value: unknown): ToolCall {
  const parsed = ToolCallSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainInvariantError(
      DomainInvariantErrorCode.invalidToolCall,
      "ToolCall does not satisfy the frozen contract.",
      { issue_count: parsed.error.issues.length },
    );
  }
  return parsed.data;
}

function parseToolResult(value: unknown): ToolResult {
  const parsed = ToolResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainInvariantError(
      DomainInvariantErrorCode.invalidToolResult,
      "Tool result does not satisfy the frozen contract.",
      { issue_count: parsed.error.issues.length },
    );
  }
  return parsed.data;
}

function parseToolError(value: unknown): ToolError {
  const parsed = ToolErrorSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainInvariantError(
      DomainInvariantErrorCode.invalidToolError,
      "Tool error does not satisfy the frozen contract.",
      { issue_count: parsed.error.issues.length },
    );
  }
  return parsed.data;
}

function parseInput(value: unknown): JsonObject {
  const parsed = JsonObjectSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainInvariantError(
      DomainInvariantErrorCode.invalidToolCall,
      "Validated tool input must be a JSON object.",
    );
  }
  return parsed.data;
}

export class ToolCallState {
  readonly #call: ToolCall;

  private constructor(call: ToolCall) {
    this.#call = call;
  }

  static create(value: unknown): ToolCallState {
    const call = parseToolCall(value);
    if (call.status !== "pending") {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidToolCall,
        "A new ToolCall must start in pending status.",
        { status: call.status },
      );
    }
    return new ToolCallState(call);
  }

  get call(): ToolCall {
    return structuredClone(this.#call);
  }

  start(validatedInput: unknown, startedAt: unknown): ToolCallState {
    this.assertStatus(["pending"], "running");
    const timestamp = parseTimestamp(startedAt);
    assertNotBefore(timestamp, this.#call.requested_at, "started_at");
    return this.fromValue({
      ...this.#call,
      status: "running",
      validated_input: parseInput(validatedInput),
      started_at: timestamp,
    });
  }

  complete(result: unknown, settledAt: unknown): ToolCallState {
    this.assertCanSettle(["running"], "completed");
    if (this.#call.status !== "running") {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidToolCallTransition,
        "ToolCall must be running before completion.",
      );
    }
    return this.fromValue({
      ...this.#call,
      status: "completed",
      settled_at: this.parseSettlementTimestamp(settledAt),
      result: parseToolResult(result),
    });
  }

  fail(error: unknown, settledAt: unknown): ToolCallState {
    this.assertCanSettle(["pending", "running"], "error");
    const toolError = parseToolError(error);
    return this.fromValue({
      ...this.commonFields(),
      status: "error",
      started_at:
        this.#call.status === "running" ? this.#call.started_at : null,
      settled_at: this.parseSettlementTimestamp(settledAt),
      error: toolError,
    });
  }

  deny(error: unknown, settledAt: unknown): ToolCallState {
    this.assertCanSettle(["pending"], "denied");
    const toolError = parseToolError(error);
    if (toolError.category !== "permission_denied") {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidToolError,
        "A denied ToolCall requires a permission_denied error.",
      );
    }
    return this.fromValue({
      ...this.commonFields(),
      status: "denied",
      settled_at: this.parseSettlementTimestamp(settledAt),
      error: toolError,
    });
  }

  cancel(error: unknown, settledAt: unknown): ToolCallState {
    this.assertCanSettle(["pending", "running"], "cancelled");
    const toolError = parseToolError(error);
    if (toolError.category !== "cancelled") {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidToolError,
        "A cancelled ToolCall requires a cancelled error.",
      );
    }
    return this.fromValue({
      ...this.commonFields(),
      status: "cancelled",
      started_at:
        this.#call.status === "running" ? this.#call.started_at : null,
      settled_at: this.parseSettlementTimestamp(settledAt),
      error: toolError,
    });
  }

  private assertCanSettle(
    allowed: readonly ToolCall["status"][],
    target: ToolCall["status"],
  ): void {
    if (terminalStatuses.has(this.#call.status)) {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.toolCallAlreadySettled,
        `ToolCall in ${this.#call.status} status cannot settle as ${target}.`,
        { from: this.#call.status, to: target },
      );
    }
    this.assertStatus(allowed, target);
  }

  private assertStatus(
    allowed: readonly ToolCall["status"][],
    target: ToolCall["status"],
  ): void {
    if (!allowed.includes(this.#call.status)) {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidToolCallTransition,
        `ToolCall cannot transition from ${this.#call.status} to ${target}.`,
        { from: this.#call.status, to: target },
      );
    }
  }

  private fromValue(value: unknown): ToolCallState {
    return new ToolCallState(parseToolCall(value));
  }

  private commonFields() {
    return {
      tool_call_id: this.#call.tool_call_id,
      run_id: this.#call.run_id,
      turn_id: this.#call.turn_id,
      tool_id: this.#call.tool_id,
      tool_version: this.#call.tool_version,
      raw_input: this.#call.raw_input,
      requested_at: this.#call.requested_at,
    };
  }

  private parseSettlementTimestamp(value: unknown): string {
    const timestamp = parseTimestamp(value);
    const boundary =
      this.#call.status === "running"
        ? this.#call.started_at
        : this.#call.requested_at;
    assertNotBefore(timestamp, boundary, "settled_at");
    return timestamp;
  }
}
