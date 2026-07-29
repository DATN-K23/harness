import {
  RunStatusSchema,
  type RunStatus,
} from "../../../packages/contracts/src/index.js";
import {
  DomainInvariantError,
  DomainInvariantErrorCode,
  RunState,
  assertRunTransition,
} from "../../../packages/domain/src/index.js";
import { describe, expect, it } from "vitest";

const createdAt = "2026-07-29T01:00:00.000Z";
const startedAt = "2026-07-29T01:00:01.000Z";
const completedAt = "2026-07-29T01:00:02.000Z";
const hash = `sha256:${"0".repeat(64)}`;

const allowedTransitions = [
  ["queued", "running"],
  ["queued", "cancelled"],
  ["running", "waiting_tool"],
  ["running", "verifying"],
  ["running", "completed"],
  ["running", "failed"],
  ["running", "cancelled"],
  ["waiting_tool", "running"],
  ["verifying", "running"],
  ["failed", "queued"],
] as const satisfies readonly (readonly [RunStatus, RunStatus])[];

const allowedTransitionKeys = new Set(
  allowedTransitions.map(([from, to]) => `${from}->${to}`),
);

const forbiddenTransitions = RunStatusSchema.options.flatMap((from) =>
  RunStatusSchema.options
    .filter((to) => !allowedTransitionKeys.has(`${from}->${to}`))
    .map((to) => [from, to] as const),
);

function createRun() {
  return {
    schema_version: 1,
    run_id: "run_001",
    parent_run_id: null,
    finding_id: "finding_001",
    mode: "judge",
    status: "queued",
    config_snapshot: {
      schema_version: 1,
      mode: "judge",
      model: {
        provider: "fake",
        model: "slice1-scripted",
      },
      prompt_manifest: {
        schema_version: 1,
        components: [
          {
            id: "harness-policy",
            version: "1.0.0",
            content_hash: hash,
          },
        ],
        aggregate_hash: hash,
      },
      enabled_tool_ids: ["read_file"],
      enabled_skill_ids: [],
      feature_flags: {
        tools: true,
        skills: false,
        context_compaction: false,
        session_note: false,
        long_term_memory: false,
        verification: false,
        retry: false,
        no_progress_detection: false,
      },
      limits: {
        max_steps: 4,
        max_input_tokens: 10_000,
        max_output_tokens: 2_000,
        max_cost_usd: 0,
        wall_clock_timeout_ms: 30_000,
      },
      pricing_catalog_hash: null,
      created_at: createdAt,
    },
    created_at: createdAt,
    started_at: null,
    completed_at: null,
  };
}

function createVerdict() {
  return {
    classification: "valid",
    severity: "high",
    reasoning_summary: "The external call occurs before balance clearing.",
    evidence_refs: ["contracts/Vault.sol:28"],
  };
}

function expectInvariant(
  action: () => unknown,
  code: DomainInvariantErrorCode,
): DomainInvariantError {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DomainInvariantError);
    const invariantError = error as DomainInvariantError;
    expect(invariantError.code).toBe(code);
    return invariantError;
  }
  throw new Error(`Expected invariant error ${code}.`);
}

describe("Run state", () => {
  it.each(allowedTransitions)(
    "allows %s -> %s",
    (from: RunStatus, to: RunStatus) => {
      expect(() => assertRunTransition(from, to)).not.toThrow();
    },
  );

  it.each(forbiddenTransitions)(
    "rejects %s -> %s",
    (from: RunStatus, to: RunStatus) => {
      expectInvariant(
        () => assertRunTransition(from, to),
        DomainInvariantErrorCode.invalidRunTransition,
      );
    },
  );

  it("executes the Slice 1 Run path without mutating prior states", () => {
    const queued = RunState.create(createRun());
    const running = queued.start(startedAt);
    const waiting = running.waitForTool();
    const resumed = waiting.resume();
    const completed = resumed.complete(createVerdict(), completedAt);

    expect(queued.run.status).toBe("queued");
    expect(running.run.status).toBe("running");
    expect(waiting.run.status).toBe("waiting_tool");
    expect(resumed.run.status).toBe("running");
    expect(completed.run.status).toBe("completed");
    expect(completed.verdict?.classification).toBe("valid");
    expect(completed.stopReason).toBeNull();
  });

  it("supports the reserved verification round trip", () => {
    const running = RunState.create(createRun()).start(startedAt);

    expect(running.startVerification().resume().run.status).toBe("running");
  });

  it("does not complete with an invalid structured verdict", () => {
    const running = RunState.create(createRun()).start(startedAt);

    expectInvariant(
      () =>
        running.complete(
          {
            ...createVerdict(),
            classification: "probably_valid",
          },
          completedAt,
        ),
      DomainInvariantErrorCode.invalidVerdict,
    );
    expect(running.run.status).toBe("running");
  });

  it.each([
    {
      reason: {
        kind: "max_steps",
        limit: 4,
        observed_steps: 4,
      },
      expectedKind: "max_steps",
    },
    {
      reason: {
        kind: "timeout",
        timeout_ms: 30_000,
      },
      expectedKind: "timeout",
    },
    {
      reason: {
        kind: "internal_failure",
        code: "INVARIANT_FAILURE",
        message: "Unexpected internal state.",
      },
      expectedKind: "internal_failure",
    },
  ] as const)("preserves $expectedKind when a Run fails", ({ reason }) => {
    const failed = RunState.create(createRun())
      .start(startedAt)
      .fail(reason, completedAt);

    expect(failed.run.status).toBe("failed");
    expect(failed.stopReason).toEqual(reason);
    expect(failed.retry().stopReason).toBeNull();
  });

  it("preserves cancellation reason from queued and running states", () => {
    const reason = {
      kind: "cancellation",
      source: "user",
      reason: "The run was cancelled by its owner.",
    };
    const queuedCancelled = RunState.create(createRun()).cancel(
      reason,
      completedAt,
    );
    const runningCancelled = RunState.create(createRun())
      .start(startedAt)
      .cancel(reason, completedAt);

    expect(queuedCancelled.stopReason).toEqual(reason);
    expect(runningCancelled.stopReason).toEqual(reason);
  });

  it("rejects mismatched modes, missing Judge finding and done status", () => {
    expectInvariant(
      () =>
        RunState.create({
          ...createRun(),
          config_snapshot: {
            ...createRun().config_snapshot,
            mode: "audit",
          },
        }),
      DomainInvariantErrorCode.invalidRun,
    );
    expectInvariant(
      () => RunState.create({ ...createRun(), finding_id: null }),
      DomainInvariantErrorCode.invalidRun,
    );
    expectInvariant(
      () => RunState.create({ ...createRun(), status: "done" }),
      DomainInvariantErrorCode.invalidRun,
    );
  });

  it("rejects invalid stop semantics and non-monotonic timestamps", () => {
    const running = RunState.create(createRun()).start(startedAt);

    expectInvariant(
      () =>
        running.fail(
          {
            kind: "max_steps",
            limit: 4,
            observed_steps: 3,
          },
          completedAt,
        ),
      DomainInvariantErrorCode.invalidStopReason,
    );
    expectInvariant(
      () => running.fail({ kind: "cancellation" }, completedAt),
      DomainInvariantErrorCode.invalidStopReason,
    );
    expectInvariant(
      () => running.complete(createVerdict(), createdAt),
      DomainInvariantErrorCode.invalidTimestamp,
    );
  });
});
