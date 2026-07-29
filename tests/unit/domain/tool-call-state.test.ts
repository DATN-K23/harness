import {
  DomainInvariantError,
  DomainInvariantErrorCode,
  ToolCallState,
} from "../../../packages/domain/src/index.js";
import { describe, expect, it } from "vitest";

const requestedAt = "2026-07-29T01:00:00.000Z";
const startedAt = "2026-07-29T01:00:01.000Z";
const settledAt = "2026-07-29T01:00:02.000Z";

function createToolCall() {
  return {
    tool_call_id: "tool_call_001",
    run_id: "run_001",
    turn_id: "turn_001",
    tool_id: "read_file",
    tool_version: "1.0.0",
    raw_input: {
      path: "contracts/Vault.sol",
    },
    requested_at: requestedAt,
    status: "pending",
  };
}

function createResult() {
  return {
    title: "contracts/Vault.sol",
    model_output: "28: (bool success, ) = msg.sender.call...",
    artifact_refs: [],
    metadata: {
      start_line: 28,
      end_line: 28,
    },
  };
}

function createExecutionError() {
  return {
    category: "execution_failed",
    code: "READ_FAILED",
    message: "The file could not be read.",
    model_message: "read_file failed; inspect the path and try again.",
    details: {},
    retryable: true,
  };
}

function createPermissionError() {
  return {
    category: "permission_denied",
    code: "PATH_OUTSIDE_WORKSPACE",
    message: "The path is outside the source workspace.",
    model_message: "Use a path relative to the source workspace.",
    details: {},
    retryable: false,
  };
}

function createCancellationError() {
  return {
    category: "cancelled",
    code: "RUN_CANCELLED",
    message: "The owning Run was cancelled.",
    model_message: "The tool call was cancelled.",
    details: {},
    retryable: false,
  };
}

function expectInvariant(
  action: () => unknown,
  code: DomainInvariantErrorCode,
): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DomainInvariantError);
    expect((error as DomainInvariantError).code).toBe(code);
    return;
  }
  throw new Error(`Expected invariant error ${code}.`);
}

describe("ToolCall state", () => {
  it("transitions pending -> running -> completed without mutation", () => {
    const pending = ToolCallState.create(createToolCall());
    const running = pending.start({ path: "contracts/Vault.sol" }, startedAt);
    const completed = running.complete(createResult(), settledAt);

    expect(pending.call.status).toBe("pending");
    expect(running.call.status).toBe("running");
    expect(completed.call.status).toBe("completed");
    if (completed.call.status === "completed") {
      expect(completed.call.result).toEqual(createResult());
    }
  });

  it("supports every allowed terminal path", () => {
    const pending = ToolCallState.create(createToolCall());
    const running = pending.start({ path: "contracts/Vault.sol" }, startedAt);

    expect(pending.fail(createExecutionError(), settledAt).call.status).toBe(
      "error",
    );
    expect(running.fail(createExecutionError(), settledAt).call.status).toBe(
      "error",
    );
    expect(pending.deny(createPermissionError(), settledAt).call.status).toBe(
      "denied",
    );
    expect(
      pending.cancel(createCancellationError(), settledAt).call.status,
    ).toBe("cancelled");
    expect(
      running.cancel(createCancellationError(), settledAt).call.status,
    ).toBe("cancelled");
  });

  it.each(["completed", "error", "denied", "cancelled"] as const)(
    "does not settle a %s ToolCall again",
    (terminalStatus) => {
      const pending = ToolCallState.create(createToolCall());
      const running = pending.start({ path: "contracts/Vault.sol" }, startedAt);
      const terminal = {
        completed: running.complete(createResult(), settledAt),
        error: running.fail(createExecutionError(), settledAt),
        denied: pending.deny(createPermissionError(), settledAt),
        cancelled: running.cancel(createCancellationError(), settledAt),
      }[terminalStatus];

      expectInvariant(
        () => terminal.complete(createResult(), settledAt),
        DomainInvariantErrorCode.toolCallAlreadySettled,
      );
      expectInvariant(
        () => terminal.fail(createExecutionError(), settledAt),
        DomainInvariantErrorCode.toolCallAlreadySettled,
      );
    },
  );

  it("rejects completion before start and category-mismatched errors", () => {
    const pending = ToolCallState.create(createToolCall());

    expectInvariant(
      () => pending.complete(createResult(), settledAt),
      DomainInvariantErrorCode.invalidToolCallTransition,
    );
    expectInvariant(
      () => pending.deny(createExecutionError(), settledAt),
      DomainInvariantErrorCode.invalidToolError,
    );
    expectInvariant(
      () => pending.cancel(createExecutionError(), settledAt),
      DomainInvariantErrorCode.invalidToolError,
    );
  });

  it("rejects an invalid ToolResult before settlement", () => {
    const running = ToolCallState.create(createToolCall()).start(
      { path: "contracts/Vault.sol" },
      startedAt,
    );

    expectInvariant(
      () => running.complete({ title: "missing fields" }, settledAt),
      DomainInvariantErrorCode.invalidToolResult,
    );
    expect(running.call.status).toBe("running");
  });

  it("rejects non-monotonic ToolCall timestamps", () => {
    const pending = ToolCallState.create(createToolCall());
    const beforeRequest = "2026-07-29T00:59:59.000Z";

    expectInvariant(
      () => pending.start({ path: "contracts/Vault.sol" }, beforeRequest),
      DomainInvariantErrorCode.invalidTimestamp,
    );

    const running = pending.start({ path: "contracts/Vault.sol" }, startedAt);
    expectInvariant(
      () => running.complete(createResult(), requestedAt),
      DomainInvariantErrorCode.invalidTimestamp,
    );
  });
});
