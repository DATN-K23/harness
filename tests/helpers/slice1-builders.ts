import type {
  RunEvent,
  RunEventType,
} from "../../packages/contracts/src/index.js";
import { RunState } from "../../packages/domain/src/index.js";

export const testTimestamp = "2026-07-29T01:00:00.000Z";
const hash = `sha256:${"0".repeat(64)}`;

export function createConfigSnapshot() {
  return {
    schema_version: 1 as const,
    mode: "judge" as const,
    model: {
      provider: "fake",
      model: "slice1-scripted",
    },
    prompt_manifest: {
      schema_version: 1 as const,
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
    created_at: testTimestamp,
  };
}

export function createQueuedRunState(runId = "run_001"): RunState {
  return RunState.create({
    schema_version: 1,
    run_id: runId,
    parent_run_id: null,
    finding_id: "finding_001",
    mode: "judge",
    status: "queued",
    config_snapshot: createConfigSnapshot(),
    created_at: testTimestamp,
    started_at: null,
    completed_at: null,
  });
}

export function createRunEvent(
  sequence: number,
  overrides: Partial<
    Pick<RunEvent, "event_id" | "run_id" | "occurred_at">
  > = {},
): Extract<RunEvent, { type: "run_started" }> {
  return {
    event_id: overrides.event_id ?? `event_${sequence.toString()}`,
    run_id: overrides.run_id ?? "run_001",
    sequence,
    occurred_at: overrides.occurred_at ?? testTimestamp,
    schema_version: 1,
    type: "run_started",
    payload: {
      status: "running",
    },
  };
}

export function eventTypes(events: readonly RunEvent[]): RunEventType[] {
  return events.map((event) => event.type);
}
