export interface ToolCall {
  id: string;
  runId: string;
  stepIndex: number;
  toolName: string;
  argumentsJson: string;
  resultJson: string;
  isError: boolean;
  durationMs: number;
  tokensUsed: number;
  timestamp: string | Date;
}
