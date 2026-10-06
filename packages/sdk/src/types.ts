import type {
  RunStatus,
  Verdict,
  PaginationMeta,
} from "@audit-harness/contracts";

export type {
  VerdictValidity,
  VerdictStatus,
  SeverityLevel,
} from "@audit-harness/contracts";

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

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
  id?: string;
  runId?: string;
  stepIndex: number;
  thought?: string;
  content?: string;
  tokensUsed?: number;
}

export interface ToolCallEvent {
  id?: string;
  runId?: string;
  stepIndex: number;
  toolName?: string;
  tool_name?: string;
  arguments?: Record<string, unknown>;
  arguments_json?: string;
  result?: string;
  result_json?: string;
  isError?: boolean;
  is_error?: boolean;
  durationMs?: number;
  duration_ms?: number;
  tokensUsed?: number;
  tokens_used?: number;
}

export interface StatusChangedEvent {
  runId?: string;
  status: RunStatus;
  timestamp?: string;
}

export interface VerdictEvent extends Partial<Verdict> {
  runId?: string;
  verdict?: Verdict;
  [key: string]: unknown;
}

export interface CompletedEvent {
  runId: string;
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUsd: number;
}

export interface RunStreamListener {
  /** Gọi khi SSE connection mở thành công (HTTP 200) */
  onopen?: () => void;
  onThought?: (data: ThoughtEvent) => void;
  onToolCall?: (data: ToolCallEvent) => void;
  onStatusChanged?: (data: StatusChangedEvent) => void;
  onVerdict?: (data: VerdictEvent) => void;
  onCompleted?: (data: CompletedEvent) => void;
  onError?: (error: unknown) => void;
}
