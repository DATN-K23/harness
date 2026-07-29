import { fileURLToPath } from "node:url";
import { FilesystemSourceWorkspace } from "../../packages/adapters/src/index.js";
import type { ToolExecutionError } from "../../packages/tools-skills/src/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createReadFileRegistry,
  createToolRequest,
} from "../helpers/tool-registry.js";

const sourceRoot = fileURLToPath(
  new URL("../fixtures/slice1/source/", import.meta.url),
);
let workspace: FilesystemSourceWorkspace;

beforeAll(async () => {
  workspace = await FilesystemSourceWorkspace.create(sourceRoot);
});

function expectedToolError(code: string): (error: unknown) => boolean {
  return (error: unknown) => {
    expect((error as ToolExecutionError).error.code).toBe(code);
    return true;
  };
}

describe("read_file v0", () => {
  it("reads an entire file with one-based line numbers", async () => {
    const registry = createReadFileRegistry();

    const result = await registry.execute(
      createToolRequest(workspace, { path: "contracts/Vault.sol" }),
    );

    expect(result.title).toBe("contracts/Vault.sol (lines 1-38)");
    expect(result.model_output).toContain("1: // SPDX-License-Identifier: MIT");
    expect(result.model_output).toContain("38: }");
    expect(result.metadata).toEqual({
      path: "contracts/Vault.sol",
      requested_start_line: null,
      requested_end_line: null,
      actual_start_line: 1,
      actual_end_line: 38,
      total_lines: 38,
    });
    expect(result.artifact_refs).toEqual([]);
  });

  it("reads an inclusive line range", async () => {
    const registry = createReadFileRegistry();

    const result = await registry.execute(
      createToolRequest(workspace, {
        path: "contracts/Vault.sol",
        start_line: 24,
        end_line: 32,
      }),
    );

    expect(result.title).toBe("contracts/Vault.sol (lines 24-32)");
    expect(result.model_output.split("\n")).toHaveLength(9);
    expect(result.model_output).toContain(
      '28:         (bool success, ) = msg.sender.call{value: amount}("");',
    );
    expect(result.model_output).toContain(
      "31:         balances[msg.sender] = 0;",
    );
    expect(result.metadata).toMatchObject({
      requested_start_line: 24,
      requested_end_line: 32,
      actual_start_line: 24,
      actual_end_line: 32,
    });
  });

  it.each([
    [1, "1: // SPDX-License-Identifier: MIT"],
    [38, "38: }"],
  ])("reads boundary line %i", async (line, expected) => {
    const registry = createReadFileRegistry();

    const result = await registry.execute(
      createToolRequest(workspace, {
        path: "contracts/Vault.sol",
        start_line: line,
        end_line: line,
      }),
    );

    expect(result.model_output).toBe(expected);
  });

  it("rejects start_line greater than end_line", async () => {
    const registry = createReadFileRegistry();

    await expect(
      registry.execute(
        createToolRequest(workspace, {
          path: "contracts/Vault.sol",
          start_line: 10,
          end_line: 5,
        }),
      ),
    ).rejects.toSatisfy(expectedToolError("INVALID_LINE_RANGE"));
  });

  it("rejects a range outside the file", async () => {
    const registry = createReadFileRegistry();

    await expect(
      registry.execute(
        createToolRequest(workspace, {
          path: "contracts/Vault.sol",
          start_line: 39,
        }),
      ),
    ).rejects.toSatisfy(expectedToolError("LINE_RANGE_OUT_OF_BOUNDS"));
  });

  it("returns a corrective error when the file does not exist", async () => {
    const registry = createReadFileRegistry();

    await expect(
      registry.execute(
        createToolRequest(workspace, { path: "contracts/Vualt.sol" }),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      const toolError = (error as ToolExecutionError).error;
      expect(toolError).toMatchObject({
        category: "invalid_input",
        retryable: true,
        code: "FILE_NOT_FOUND",
      });
      expect(toolError.model_message).toContain(
        '"contracts/Vualt.sol" does not exist',
      );
      expect(toolError.model_message).toContain("valid relative path");
      return true;
    });
  });
});
