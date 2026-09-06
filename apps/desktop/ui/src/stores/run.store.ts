import { create } from "zustand";
import type {
  RunSchema as Run,
  ToolCallSchema,
} from "../generated/api/index.js";

export type ThoughtEvent = {
  id?: string;
  runId?: string;
  stepIndex: number;
  thought?: string;
  content?: string;
};

type ToolCall = ToolCallSchema;
interface ModelEvent {
  id: string;
  stepIndex: number;
  eventType: string;
  content: string;
  runId?: string;
}

export type SseStatus = "connecting" | "connected" | "reconnecting" | "offline";

export interface RunState {
  currentRun: Run | null;
  sseStatus: SseStatus;

  // Trace Data
  toolCalls: ToolCall[];
  thoughts: ThoughtEvent[];
  modelEvents: ModelEvent[];

  // Actions
  setRun: (run: Run | null) => void;
  setRunStatus: (status: string) => void;
  setSseStatus: (status: SseStatus) => void;
  appendToolCall: (tc: ToolCall) => void;
  appendThought: (thought: ThoughtEvent) => void;
  appendModelEvent: (event: ModelEvent) => void;
  reset: () => void;
}

export const useRunStore = create<RunState>((set) => ({
  currentRun: null,
  sseStatus: "offline",
  toolCalls: [],
  thoughts: [],
  modelEvents: [],

  setRun: (run) => set({ currentRun: run }),

  setRunStatus: (status) =>
    set((state) => ({
      currentRun: state.currentRun
        ? { ...state.currentRun, status: status }
        : null,
    })),

  setSseStatus: (sseStatus) => set({ sseStatus }),

  appendToolCall: (tc) =>
    set((state) => {
      // Deduplicate by ID
      if (state.toolCalls.some((existing) => existing.id === tc.id)) {
        return state;
      }
      return { toolCalls: [...state.toolCalls, tc] };
    }),

  appendThought: (thought) =>
    set((state) => {
      const exists = state.modelEvents.some(
        (e) =>
          (thought.id && e.id === thought.id) ||
          (e.stepIndex === thought.stepIndex && e.eventType === "THOUGHT"),
      );
      if (exists) return state;

      const newEvent: ModelEvent = {
        id: thought.id || `thought_${thought.stepIndex}`,
        stepIndex: thought.stepIndex,
        eventType: "THOUGHT",
        content: thought.thought || thought.content || "",
      };
      if (thought.runId) {
        newEvent.runId = thought.runId;
      }
      return { modelEvents: [...state.modelEvents, newEvent] };
    }),

  appendModelEvent: (event) =>
    set((state) => ({ modelEvents: [...state.modelEvents, event] })),

  reset: () =>
    set({
      currentRun: null,
      toolCalls: [],
      thoughts: [],
      modelEvents: [],
      sseStatus: "offline",
    }),
}));
