import { z } from "zod";
import { WorkspaceError, WorkspaceErrorCode } from "@audit-harness/application";
import type {
  JsonObject,
  ToolError,
  ToolResult,
} from "@audit-harness/contracts";
import type { ExecutableTool, ToolContext } from "./types.js";
import { createToolError } from "./errors.js";

export const ReadFileInputSchema = z.strictObject({
  path: z.string().trim().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
});

export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

const readFileInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: {
      type: "string",
      minLength: 1,
      description: "Relative path inside the supplied source workspace.",
    },
    start_line: {
      type: "integer",
      minimum: 1,
      description: "Optional first line, using one-based inclusive indexing.",
    },
    end_line: {
      type: "integer",
      minimum: 1,
      description: "Optional last line, using one-based inclusive indexing.",
    },
  },
  required: ["path"],
} as const satisfies JsonObject;

function safeRequestedPath(input: ReadFileInput): string {
  return input.path.replace(/[\r\n\t]/gu, " ");
}

function lineRangeError(
  input: ReadFileInput,
  code: "INVALID_LINE_RANGE" | "LINE_RANGE_OUT_OF_BOUNDS",
  message: string,
): never {
  const path = safeRequestedPath(input);
  throw createToolError({
    category: "invalid_input",
    retryable: true,
    code,
    message,
    model_message:
      `${code}: requested lines for "${path}" are invalid. ` +
      "Use positive one-based line numbers, ensure start_line is not greater than end_line, and keep the range inside the file.",
    details: {
      path,
      start_line: input.start_line ?? null,
      end_line: input.end_line ?? null,
    },
  });
}

function workspaceToolError(
  input: ReadFileInput,
  error: WorkspaceError,
): ToolError {
  const requestedPath = safeRequestedPath(input);
  const details = { path: requestedPath };
  switch (error.code) {
    case WorkspaceErrorCode.fileNotFound:
      return {
        category: "invalid_input",
        retryable: true,
        code: "FILE_NOT_FOUND",
        message: `Requested workspace file "${requestedPath}" does not exist.`,
        model_message:
          `FILE_NOT_FOUND: "${requestedPath}" does not exist in the source workspace. ` +
          "Check the path and call read_file with a valid relative path.",
        details,
      };
    case WorkspaceErrorCode.notAFile:
      return {
        category: "invalid_input",
        retryable: true,
        code: "NOT_A_FILE",
        message: `Workspace path "${requestedPath}" is not a file.`,
        model_message:
          `NOT_A_FILE: "${requestedPath}" is not a readable file. ` +
          "Call read_file with a relative path that identifies a source file.",
        details,
      };
    case WorkspaceErrorCode.invalidPath:
    case WorkspaceErrorCode.pathOutsideWorkspace:
    case WorkspaceErrorCode.symlinkOutsideWorkspace:
      return {
        category: "permission_denied",
        retryable: false,
        code: "WORKSPACE_PATH_DENIED",
        message: `Workspace policy denied "${requestedPath}".`,
        model_message:
          `WORKSPACE_PATH_DENIED: "${requestedPath}" is outside the permitted source workspace boundary. ` +
          "Use a normal relative source path; this request cannot be retried unchanged.",
        details,
      };
    case WorkspaceErrorCode.cancelled:
      return {
        category: "cancelled",
        retryable: false,
        code: "TOOL_CANCELLED",
        message: "Workspace read was cancelled.",
        model_message:
          "TOOL_CANCELLED: read_file was cancelled. Stop this tool call.",
        details,
      };
    case WorkspaceErrorCode.readFailed:
    case WorkspaceErrorCode.invalidRoot:
      return {
        category: "execution_failed",
        retryable: false,
        code: "WORKSPACE_READ_FAILED",
        message: `Workspace could not read "${requestedPath}".`,
        model_message:
          `WORKSPACE_READ_FAILED: "${requestedPath}" could not be read because the workspace is unavailable. ` +
          "Do not attempt to bypass the workspace boundary.",
        details,
      };
  }
}

function sourceLines(content: string): string[] {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

async function executeReadFile(
  input: ReadFileInput,
  context: ToolContext,
): Promise<ToolResult> {
  if (
    input.start_line !== undefined &&
    input.end_line !== undefined &&
    input.start_line > input.end_line
  ) {
    lineRangeError(
      input,
      "INVALID_LINE_RANGE",
      "start_line cannot be greater than end_line.",
    );
  }

  let file;
  try {
    file = await context.workspace.readFile(input.path, context.signal);
  } catch (error: unknown) {
    if (error instanceof WorkspaceError) {
      throw createToolError(workspaceToolError(input, error));
    }
    throw error;
  }

  const lines = sourceLines(file.content);
  if (lines.length === 0) {
    if (input.start_line !== undefined || input.end_line !== undefined) {
      lineRangeError(
        input,
        "LINE_RANGE_OUT_OF_BOUNDS",
        "An empty file has no selectable lines.",
      );
    }
    return {
      title: `${file.path} (empty file)`,
      model_output: "",
      artifact_refs: [],
      metadata: {
        path: file.path,
        requested_start_line: null,
        requested_end_line: null,
        actual_start_line: null,
        actual_end_line: null,
        total_lines: 0,
      },
    };
  }

  const startLine = input.start_line ?? 1;
  const endLine = input.end_line ?? lines.length;
  if (startLine > lines.length || endLine > lines.length) {
    lineRangeError(
      input,
      "LINE_RANGE_OUT_OF_BOUNDS",
      `Requested range exceeds the file's ${lines.length} lines.`,
    );
  }

  const selected = lines.slice(startLine - 1, endLine);
  const modelOutput = selected
    .map((line, index) => `${String(startLine + index)}: ${line}`)
    .join("\n");
  return {
    title: `${file.path} (lines ${startLine}-${endLine})`,
    model_output: modelOutput,
    artifact_refs: [],
    metadata: {
      path: file.path,
      requested_start_line: input.start_line ?? null,
      requested_end_line: input.end_line ?? null,
      actual_start_line: startLine,
      actual_end_line: endLine,
      total_lines: lines.length,
    },
  };
}

export const ReadFileTool: ExecutableTool<ReadFileInput> = {
  definition: {
    id: "read_file",
    version: "1.0.0",
    description:
      "Read all or an inclusive one-based line range from a relative source workspace file.",
    capability: "read_workspace",
    input_schema: readFileInputJsonSchema,
  },
  input_schema: ReadFileInputSchema,
  execute: executeReadFile,
};
