import { create } from "zustand";

export interface DemoEvent {
  type: string;
  payload: Record<string, any>;
  delayMs?: number;
}

interface ReplayStore {
  events: DemoEvent[];
  currentStep: number;
  isPlaying: boolean;
  playbackSpeed: number; // 0.5 | 1 | 2 | 5 | 10

  setEvents: (events: DemoEvent[]) => void;
  setPlaying: (isPlaying: boolean) => void;
  setSpeed: (speed: number) => void;
  /** Dừng play và nhảy đến step (dùng cho reset button) */
  jumpToStep: (step: number) => void;
  /** NW5 Fix: Scrub đến step không dừng play (dùng cho slider) */
  seekToStep: (step: number) => void;
  tickStep: () => void;
}

export const useReplayStore = create<ReplayStore>((set) => ({
  events: [],
  currentStep: 0,
  isPlaying: false,
  playbackSpeed: 1,

  setEvents: (events) => set({ events, currentStep: 0, isPlaying: false }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setSpeed: (playbackSpeed) => set({ playbackSpeed }),
  // Dừng play và nhảy đến step (reset button)
  jumpToStep: (step) => set({ currentStep: step, isPlaying: false }),
  // NW5 Fix: Seekto không đụng isPlaying (slider scrub khi đang play)
  seekToStep: (step) => set({ currentStep: step }),
  tickStep: () =>
    set((state) => {
      const nextStep = state.currentStep + 1;
      const isStillPlaying = nextStep < state.events.length;
      return {
        currentStep: Math.min(nextStep, Math.max(0, state.events.length - 1)),
        isPlaying: isStillPlaying,
      };
    }),
}));
