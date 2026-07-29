import type { ToolDefinition, ToolResult } from "@audit-harness/contracts";
import type { Workspace } from "@audit-harness/application";
import type { z } from "zod";

export interface ToolContext {
  readonly run_id: string;
  readonly turn_id: string;
  readonly tool_call_id: string;
  readonly workspace: Workspace;
  readonly signal: AbortSignal;
}

export interface ExecutableTool<Input = unknown> {
  readonly definition: ToolDefinition;
  readonly input_schema: z.ZodType<Input>;
  execute(input: Input, context: ToolContext): Promise<ToolResult>;
}
