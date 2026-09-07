import type { ModelEventType } from "./enums.js";

export interface ModelEvent {
  id: string;
  runId: string;
  stepIndex: number;
  eventType: ModelEventType;
  content: string;
  tokensUsed: number;
  timestamp: string | Date;
}
