import type { DemoEvent } from "../stores/replay.store.js";

export const DEFAULT_DEMO_FIXTURE: DemoEvent[] = [
  { type: "run:status_changed", payload: { status: "RUNNING" }, delayMs: 500 },
  {
    type: "step:thought",
    payload: {
      stepIndex: 1,
      thought: "Analyzing Vault.sol reentrancy vectors...",
    },
    delayMs: 1000,
  },
  {
    type: "step:tool_call",
    payload: {
      stepIndex: 1,
      toolName: "read_file",
      isError: false,
      durationMs: 45,
    },
    delayMs: 1200,
  },
  {
    type: "step:thought",
    payload: {
      stepIndex: 2,
      thought: "Found state update after external transfer — CEI violation.",
    },
    delayMs: 1000,
  },
  {
    type: "run:verdict",
    payload: { status: "VALID", severity: "HIGH", confidenceScore: 0.95 },
    delayMs: 1500,
  },
  { type: "run:completed", payload: { totalDurationMs: 5200 }, delayMs: 500 },
];
