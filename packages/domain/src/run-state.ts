import {
  JudgeVerdictSchema,
  RunSchema,
  StopReasonSchema,
  TimestampSchema,
  type JudgeVerdict,
  type Run,
  type RunStatus,
  type StopReason,
} from "@audit-harness/contracts";
import { DomainInvariantError, DomainInvariantErrorCode } from "./errors.js";

const allowedTransitions = {
  queued: ["running", "cancelled"],
  running: ["waiting_tool", "verifying", "completed", "failed", "cancelled"],
  waiting_tool: ["running"],
  verifying: ["running"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
} as const satisfies Readonly<Record<RunStatus, readonly RunStatus[]>>;

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

function parseRun(value: unknown): Run {
  const parsed = RunSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainInvariantError(
      DomainInvariantErrorCode.invalidRun,
      "Run does not satisfy the frozen contract.",
      { issue_count: parsed.error.issues.length },
    );
  }
  return parsed.data;
}

function parseStopReason(value: unknown): StopReason {
  const parsed = StopReasonSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainInvariantError(
      DomainInvariantErrorCode.invalidStopReason,
      "Stop reason does not satisfy the frozen contract.",
      { issue_count: parsed.error.issues.length },
    );
  }
  if (
    parsed.data.kind === "max_steps" &&
    parsed.data.observed_steps < parsed.data.limit
  ) {
    throw new DomainInvariantError(
      DomainInvariantErrorCode.invalidStopReason,
      "A max_steps stop reason requires observed_steps to reach the limit.",
      {
        limit: parsed.data.limit,
        observed_steps: parsed.data.observed_steps,
      },
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

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  const targets = allowedTransitions[from] as readonly RunStatus[];
  if (!targets.includes(to)) {
    throw new DomainInvariantError(
      DomainInvariantErrorCode.invalidRunTransition,
      `Run cannot transition from ${from} to ${to}.`,
      { from, to },
    );
  }
}

export class RunState {
  readonly #run: Run;
  readonly #verdict: JudgeVerdict | null;
  readonly #stopReason: StopReason | null;

  private constructor(
    run: Run,
    verdict: JudgeVerdict | null,
    stopReason: StopReason | null,
  ) {
    this.#run = run;
    this.#verdict = verdict;
    this.#stopReason = stopReason;
  }

  static create(value: unknown): RunState {
    const run = parseRun(value);

    if (run.status !== "queued") {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidRun,
        "A new Run must start in queued status.",
        { status: run.status },
      );
    }
    if (run.started_at !== null || run.completed_at !== null) {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidRun,
        "A queued Run cannot have lifecycle timestamps.",
      );
    }
    if (run.mode !== run.config_snapshot.mode) {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidRun,
        "Run mode must match its immutable config snapshot.",
      );
    }
    if (run.mode === "judge" && run.finding_id === null) {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidRun,
        "A Judge Run requires a finding_id.",
      );
    }

    return new RunState(run, null, null);
  }

  get run(): Run {
    return structuredClone(this.#run);
  }

  get verdict(): JudgeVerdict | null {
    return structuredClone(this.#verdict);
  }

  get stopReason(): StopReason | null {
    return structuredClone(this.#stopReason);
  }

  start(startedAt: unknown): RunState {
    assertRunTransition(this.#run.status, "running");
    const timestamp = parseTimestamp(startedAt);
    assertNotBefore(timestamp, this.#run.created_at, "started_at");
    return this.withStatus("running", {
      started_at: timestamp,
      completed_at: null,
    });
  }

  waitForTool(): RunState {
    assertRunTransition(this.#run.status, "waiting_tool");
    return this.withStatus("waiting_tool");
  }

  startVerification(): RunState {
    assertRunTransition(this.#run.status, "verifying");
    return this.withStatus("verifying");
  }

  resume(): RunState {
    assertRunTransition(this.#run.status, "running");
    return this.withStatus("running");
  }

  complete(verdict: unknown, completedAt: unknown): RunState {
    assertRunTransition(this.#run.status, "completed");
    const parsedVerdict = JudgeVerdictSchema.safeParse(verdict);
    if (!parsedVerdict.success) {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidVerdict,
        "A Run can complete only with a valid structured Judge verdict.",
        { issue_count: parsedVerdict.error.issues.length },
      );
    }

    const timestamp = this.parseCompletionTimestamp(completedAt);
    const run = this.runWithStatus("completed", { completed_at: timestamp });
    return new RunState(run, parsedVerdict.data, null);
  }

  fail(reason: unknown, completedAt: unknown): RunState {
    assertRunTransition(this.#run.status, "failed");
    const stopReason = parseStopReason(reason);
    if (stopReason.kind === "cancellation") {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidStopReason,
        "Cancellation must use the cancelled Run status.",
      );
    }

    const timestamp = this.parseCompletionTimestamp(completedAt);
    const run = this.runWithStatus("failed", { completed_at: timestamp });
    return new RunState(run, null, stopReason);
  }

  cancel(reason: unknown, completedAt: unknown): RunState {
    assertRunTransition(this.#run.status, "cancelled");
    const stopReason = parseStopReason(reason);
    if (stopReason.kind !== "cancellation") {
      throw new DomainInvariantError(
        DomainInvariantErrorCode.invalidStopReason,
        "A cancelled Run requires a cancellation stop reason.",
      );
    }

    const timestamp = this.parseCompletionTimestamp(completedAt);
    const run = this.runWithStatus("cancelled", { completed_at: timestamp });
    return new RunState(run, null, stopReason);
  }

  retry(): RunState {
    assertRunTransition(this.#run.status, "queued");
    const run = this.runWithStatus("queued", {
      started_at: null,
      completed_at: null,
    });
    return new RunState(run, null, null);
  }

  private withStatus(
    status: RunStatus,
    changes: Partial<Pick<Run, "started_at" | "completed_at">> = {},
  ): RunState {
    return new RunState(this.runWithStatus(status, changes), null, null);
  }

  private runWithStatus(
    status: RunStatus,
    changes: Partial<Pick<Run, "started_at" | "completed_at">> = {},
  ): Run {
    return parseRun({
      ...this.#run,
      ...changes,
      status,
    });
  }

  private parseCompletionTimestamp(value: unknown): string {
    const timestamp = parseTimestamp(value);
    const boundary = this.#run.started_at ?? this.#run.created_at;
    assertNotBefore(timestamp, boundary, "completed_at");
    return timestamp;
  }
}
