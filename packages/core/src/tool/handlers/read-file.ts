// Adapted from OpenCode packages/core/src/tool/handlers/read-file.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, splitLines } from "../../source/source-snapshot"

export interface ReadFileContext {
  files: ReadonlyMap<string, string>
  deniedPrefixes: readonly string[]
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value)

export function handleReadFile(
  args: Record<string, unknown>,
  ctx: ReadFileContext,
): ToolExecutionResult {
  const usage = '{"path": string, "startLine"?: integer >= 1, "endLine"?: integer >= startLine}'
  const { path, startLine, endLine } = args
  if (typeof path !== "string" || path === "")
    return failure(`Invalid arguments for read_file: path must be a non-empty string (received ${JSON.stringify(args)}). Expected ${usage}.`)
  if (startLine !== undefined && (!isInteger(startLine) || startLine < 1))
    return failure(`Invalid arguments for read_file: startLine must be an integer >= 1 (received ${JSON.stringify(args)}). Expected ${usage}.`)
  if (endLine !== undefined && (!isInteger(endLine) || endLine < 1))
    return failure(`Invalid arguments for read_file: endLine must be an integer >= 1 (received ${JSON.stringify(args)}). Expected ${usage}.`)
  if (isInteger(startLine) && isInteger(endLine) && endLine < startLine)
    return failure(`Invalid arguments for read_file: endLine must not be before startLine (received ${JSON.stringify(args)}). Expected ${usage}.`)

  const checked = checkSnapshotPath(path, ctx.deniedPrefixes)
  if (checked.kind === "denied")
    return failure(
      `Access denied: "${path}" is outside the allowed source snapshot (${checked.reason}). Use a relative path inside the snapshot, for example one listed by list_dir.`,
    )

  const content = ctx.files.get(checked.path)
  if (content === undefined)
    return failure(`File not found: "${path}". Use list_dir or glob to find the correct path.`)

  const lines = splitLines(content)
  if (lines.length === 0) return { content: "", isError: false, filePath: checked.path }
  const first = startLine ?? 1
  const last = Math.min(endLine ?? lines.length, lines.length)
  if (first > lines.length)
    return failure(
      `Line range ${first}-${endLine ?? first} is outside "${path}", which has ${lines.length} lines. Request lines 1-${lines.length}.`,
    )
  return {
    content: lines.slice(first - 1, last).join("\n"),
    isError: false,
    filePath: checked.path,
    lineRange: [first, last],
  }
}
