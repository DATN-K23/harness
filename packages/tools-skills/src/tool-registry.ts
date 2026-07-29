import {
  ToolDefinitionSchema,
  ToolResultSchema,
  type ToolDefinition,
  type ToolError,
  type ToolResult,
} from "@audit-harness/contracts";
import type {
  ToolExecutionRequest,
  ToolExecutor,
  ToolResolver,
} from "@audit-harness/application";
import type { ExecutableTool } from "./types.js";
import {
  RegistryError,
  RegistryErrorCode,
  ToolExecutionError,
  createToolError,
} from "./errors.js";

function issuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "input";
  }
  return path.map((segment) => String(segment)).join(".");
}

function invalidInputError(
  toolId: string,
  issues: readonly { readonly path: PropertyKey[]; readonly message: string }[],
): ToolExecutionError {
  const first = issues[0];
  const location = issuePath(first?.path ?? []);
  const reason = first?.message ?? "Input does not match the tool schema.";
  return createToolError({
    category: "invalid_input",
    retryable: true,
    code: "INVALID_TOOL_INPUT",
    message: `Input for tool "${toolId}" failed schema validation.`,
    model_message:
      `INVALID_TOOL_INPUT: input "${location}" for "${toolId}" is invalid (${reason}). ` +
      "Correct the input to match the visible tool schema and try again.",
    details: {
      tool_id: toolId,
      issue_count: issues.length,
      first_issue_path: location,
    },
  });
}

function internalToolError(toolId: string): ToolExecutionError {
  return createToolError({
    category: "internal",
    retryable: false,
    code: "TOOL_INTERNAL_ERROR",
    message: `Tool "${toolId}" failed unexpectedly.`,
    model_message:
      `TOOL_INTERNAL_ERROR: "${toolId}" could not complete because of an internal error. ` +
      "Stop using this tool call; do not attempt to bypass the failure.",
    details: { tool_id: toolId },
  });
}

export class ToolRegistry implements ToolResolver, ToolExecutor {
  readonly #tools = new Map<string, ExecutableTool<unknown>>();

  register<Input>(tool: ExecutableTool<Input>): void {
    const parsed = ToolDefinitionSchema.safeParse(tool.definition);
    if (!parsed.success) {
      throw new RegistryError(
        RegistryErrorCode.invalidDefinition,
        "Tool definition does not satisfy the frozen contract.",
      );
    }
    if (this.#tools.has(parsed.data.id)) {
      throw new RegistryError(
        RegistryErrorCode.duplicateToolId,
        `Tool ID "${parsed.data.id}" is already registered.`,
      );
    }
    this.#tools.set(parsed.data.id, tool);
  }

  resolve(toolId: string): ToolDefinition | null {
    const tool = this.#tools.get(toolId);
    return tool === undefined ? null : structuredClone(tool.definition);
  }

  async execute(request: ToolExecutionRequest): Promise<ToolResult> {
    const tool = this.#tools.get(request.tool_id);
    if (tool === undefined) {
      throw createToolError({
        category: "invalid_input",
        retryable: true,
        code: "UNKNOWN_TOOL",
        message: `Tool "${request.tool_id}" is not registered.`,
        model_message:
          `UNKNOWN_TOOL: "${request.tool_id}" is not available. ` +
          "Choose a tool ID from the visible tool definitions.",
        details: { tool_id: request.tool_id },
      });
    }

    const parsed = tool.input_schema.safeParse(request.input);
    if (!parsed.success) {
      throw invalidInputError(request.tool_id, parsed.error.issues);
    }

    try {
      const result = await tool.execute(parsed.data, {
        run_id: request.run_id,
        turn_id: request.turn_id,
        tool_call_id: request.tool_call_id,
        workspace: request.workspace,
        signal: request.signal,
      });
      return ToolResultSchema.parse(result);
    } catch (error: unknown) {
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      throw internalToolError(request.tool_id);
    }
  }
}

export function toolErrorFrom(error: unknown): ToolError {
  if (error instanceof ToolExecutionError) {
    return structuredClone(error.error);
  }
  return internalToolError("unknown").error;
}
