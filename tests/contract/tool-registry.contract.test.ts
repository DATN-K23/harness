import type {
  ToolExecutionRequest,
  Workspace,
} from "../../packages/application/src/index.js";
import {
  ReadFileInputSchema,
  ReadFileTool,
  RegistryErrorCode,
  ToolExecutionError,
  ToolRegistry,
} from "../../packages/tools-skills/src/index.js";
import { describe, expect, it } from "vitest";

const workspace: Workspace = {
  readFile: () =>
    Promise.resolve({ path: "contracts/Vault.sol", content: "line\n" }),
};

function request(
  toolId: string,
  input: ToolExecutionRequest["input"],
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

describe("ToolRegistry contract", () => {
  it("registers and resolves a frozen public tool definition", () => {
    const registry = new ToolRegistry();
    registry.register(ReadFileTool);

    expect(registry.resolve("read_file")).toEqual(ReadFileTool.definition);
    expect(registry.resolve("unknown")).toBeNull();

    const first = registry.resolve("read_file");
    if (first === null) {
      throw new Error("read_file must be registered.");
    }
    first.description = "mutated by caller";
    expect(registry.resolve("read_file")?.description).toBe(
      ReadFileTool.definition.description,
    );
  });

  it("rejects a duplicate tool ID even when versions differ", () => {
    const registry = new ToolRegistry();
    registry.register(ReadFileTool);

    expect(() =>
      registry.register({
        ...ReadFileTool,
        definition: {
          ...ReadFileTool.definition,
          version: "2.0.0",
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: RegistryErrorCode.duplicateToolId,
      }) as Error,
    );
  });

  it("rejects an invalid public definition at registration", () => {
    const registry = new ToolRegistry();

    expect(() =>
      registry.register({
        definition: {
          ...ReadFileTool.definition,
          version: "v1",
        },
        input_schema: ReadFileInputSchema,
        execute: () =>
          Promise.resolve({
            title: "unused",
            model_output: "",
            artifact_refs: [],
            metadata: {},
          }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: RegistryErrorCode.invalidDefinition,
      }) as Error,
    );
  });

  it("returns a model-readable error for unknown tools", async () => {
    const registry = new ToolRegistry();

    await expect(
      registry.execute(request("missing_tool", {})),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ToolExecutionError);
      const toolError = (error as ToolExecutionError).error;
      expect(toolError).toMatchObject({
        category: "invalid_input",
        retryable: true,
        code: "UNKNOWN_TOOL",
      });
      expect(toolError.model_message).toContain(
        "Choose a tool ID from the visible tool definitions.",
      );
      return true;
    });
  });

  it("validates input with Zod before executing the tool", async () => {
    const registry = new ToolRegistry();
    registry.register(ReadFileTool);

    await expect(
      registry.execute(
        request("read_file", {
          path: "contracts/Vault.sol",
          start_line: "one",
        }),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      const toolError = (error as ToolExecutionError).error;
      expect(toolError).toMatchObject({
        category: "invalid_input",
        retryable: true,
        code: "INVALID_TOOL_INPUT",
      });
      expect(toolError.model_message).toContain("start_line");
      return true;
    });
  });
});
