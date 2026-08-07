import type {
  RunStatus,
  VerdictStatus,
  SeverityLevel,
} from "@audit-harness/contracts";

export interface AuditHarnessClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface StreamConnectionOptions {
  fromStep?: number;
  maxRetryMs?: number;
}

export interface ThoughtEvent {
  runId: string;
  stepIndex: number;
  thought: string;
  tokensUsed: number;
}

export interface ToolCallEvent {
  runId: string;
  stepIndex: number;
  toolName: string;
  arguments?: Record<string, unknown>;
  result?: string;
  isError: boolean;
  durationMs: number;
  tokensUsed: number;
}

export interface StatusChangedEvent {
  runId: string;
  status: RunStatus;
  timestamp: string;
}

export interface VerdictEvent {
  runId: string;
  verdict: {
    status: VerdictStatus;
    severity: SeverityLevel;
    confidenceScore: number;
    explanation: string;
    pocResult?: string;
  };
}

export interface CompletedEvent {
  runId: string;
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUsd: number;
}

export interface RunStreamListener {
  onThought?: (data: ThoughtEvent) => void;
  onToolCall?: (data: ToolCallEvent) => void;
  onStatusChanged?: (data: StatusChangedEvent) => void;
  onVerdict?: (data: VerdictEvent) => void;
  onCompleted?: (data: CompletedEvent) => void;
  onError?: (error: unknown) => void;
}
