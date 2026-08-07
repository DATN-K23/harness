import { create } from "zustand";
import type { Run, ToolCall, ModelEvent } from "@audit-harness/contracts";
import type { ThoughtEvent, ToolCallEvent } from "@audit-harness/sdk";

export type SseStatus = "connecting" | "connected" | "reconnecting" | "offline";

interface RunState {
  currentRun: Run | null;
  toolCalls: ToolCall[];
  modelEvents: ModelEvent[];
  sseStatus: SseStatus;

  setRun: (run: Run | null) => void;
  setSseStatus: (status: SseStatus) => void;
  appendToolCall: (tc: ToolCall | ToolCallEvent) => void;
  appendThought: (thought: ThoughtEvent) => void;
  reset: () => void;
}

export const useRunStore = create<RunState>((set) => ({
  currentRun: null,
  toolCalls: [],
  modelEvents: [],
  sseStatus: "offline",

  setRun: (run) => set({ currentRun: run }),
  setSseStatus: (sseStatus) => set({ sseStatus }),

  appendToolCall: (tc) =>
    set((state) => {
      const formatted: ToolCall = {
        id: (tc as ToolCall).id || `tc_${tc.stepIndex}_${Date.now()}`,
        runId: tc.runId,
        stepIndex: tc.stepIndex,
        toolName: tc.toolName,
        argumentsJson:
          (tc as ToolCall).argumentsJson ||
          JSON.stringify((tc as ToolCallEvent).arguments || {}),
        resultJson:
          (tc as ToolCall).resultJson || (tc as ToolCallEvent).result || "",
        isError: tc.isError,
        durationMs: tc.durationMs,
        tokensUsed: tc.tokensUsed,
        timestamp: (tc as ToolCall).timestamp || new Date().toISOString(),
      };

      // De-duplicate by id or stepIndex+toolName
      const exists = state.toolCalls.some(
        (existing) => existing.id === formatted.id,
      );
      if (exists) return state;

      return { toolCalls: [...state.toolCalls, formatted] };
    }),

  appendThought: (thought) =>
    set((state) => {
      const formatted: ModelEvent = {
        id: `me_${thought.stepIndex}_${Date.now()}`,
        runId: thought.runId,
        stepIndex: thought.stepIndex,
        eventType: "THOUGHT",
        content: thought.thought,
        tokensUsed: thought.tokensUsed,
        timestamp: new Date().toISOString(),
      };
      return { modelEvents: [...state.modelEvents, formatted] };
    }),

  reset: () =>
    set({
      currentRun: null,
      toolCalls: [],
      modelEvents: [],
      sseStatus: "offline",
    }),
}));
