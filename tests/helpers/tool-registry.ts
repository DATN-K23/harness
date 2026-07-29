import type {
  ToolExecutionRequest,
  Workspace,
} from "../../packages/application/src/index.js";
import type { JsonObject } from "../../packages/contracts/src/index.js";
import {
  ReadFileTool,
  ToolRegistry,
} from "../../packages/tools-skills/src/index.js";

export function createReadFileRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(ReadFileTool);
  return registry;
}

export function createToolRequest(
  workspace: Workspace,
  input: JsonObject,
  toolId = "read_file",
): ToolExecutionRequest {
  return {
    run_id: "run_001",
    turn_id: "turn_001",
    tool_call_id: "tool_call_001",
    tool_id: toolId,
    input,
    workspace,
    signal: new AbortController().signal,
  };
}
