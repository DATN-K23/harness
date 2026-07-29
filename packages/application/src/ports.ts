import type {
  JsonObject,
  ModelEvent,
  ProviderRequest,
  RunEvent,
  RunId,
  ToolDefinition,
  ToolResult,
  ToolCallId,
  TurnId,
} from "@audit-harness/contracts";
import type { RunState } from "@audit-harness/domain";

export interface ModelProvider {
  stream(
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent>;
}

export interface WorkspaceFile {
  readonly path: string;
  readonly content: string;
}

export interface Workspace {
  readFile(relativePath: string, signal?: AbortSignal): Promise<WorkspaceFile>;
}

export interface RunRepository {
  save(run: RunState): Promise<void>;
  findById(runId: RunId): Promise<RunState | null>;
}

export interface RunEventSink {
  append(event: RunEvent): Promise<void>;
}

export interface EventStore extends RunEventSink {
  listByRunId(runId: RunId): Promise<readonly RunEvent[]>;
}

export interface Clock {
  now(): string;
}

export type IdKind =
  "run" | "turn" | "message" | "tool_call" | "event" | "provider_attempt";

export interface IdGenerator {
  next(kind: IdKind): string;
}

export interface ToolResolver {
  resolve(toolId: string): ToolDefinition | null;
}

export interface ToolExecutionRequest {
  readonly run_id: RunId;
  readonly turn_id: TurnId;
  readonly tool_call_id: ToolCallId;
  readonly tool_id: string;
  readonly input: JsonObject;
  readonly workspace: Workspace;
  readonly signal: AbortSignal;
}

export interface ToolExecutor {
  execute(request: ToolExecutionRequest): Promise<ToolResult>;
}
