// Adapted from OpenCode packages/core/src/tool/definitions.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ToolDefinition } from "@harness/protocol"

export const ReadFileDefinition: ToolDefinition = {
  name: "read_file",
  description: "Read a file from the source snapshot, optionally a 1-based inclusive line range.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, startLine: { type: "integer" }, endLine: { type: "integer" } },
    required: ["path"],
  },
}

export const GrepDefinition: ToolDefinition = {
  name: "grep",
  description: "Search every snapshot file for a regular expression; returns path:line: text.",
  parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
}

export const GlobDefinition: ToolDefinition = {
  name: "glob",
  description: "List snapshot files matching a glob pattern such as **/*.sol.",
  parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
}

export const ListDirDefinition: ToolDefinition = {
  name: "list_dir",
  description: "List the entries directly inside a snapshot directory (the root when no path is given).",
  parameters: { type: "object", properties: { path: { type: "string" } } },
}

export const toolDefinitions: readonly ToolDefinition[] = [
  ReadFileDefinition,
  GrepDefinition,
  GlobDefinition,
  ListDirDefinition,
]
