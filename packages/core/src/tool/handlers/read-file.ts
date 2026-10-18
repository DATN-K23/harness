// Adapted from OpenCode packages/core/src/tool/handlers/read-file.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { SourceSnapshotPort, ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, isDeniedSourceFile, splitLines } from "../../source/source-snapshot"

export const DEFAULT_MAX_READ_LINES = 2000
export const DEFAULT_MAX_READ_BYTES = 100 * 1024 // 100 KB
export const READ_TRUNCATION_MARKER = "[Output truncated. File has more lines or exceeds size limit. Specify a narrower line range.]"

export interface ReadFileContext {
  files?: ReadonlyMap<string, string>
  snapshot?: SourceSnapshotPort
  snapshotId?: string
  deniedPrefixes: readonly string[]
  maxLines?: number
  maxBytes?: number
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value)

export async function handleReadFile(
  args: Record<string, unknown>,
  ctx: ReadFileContext,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const usage = '{"path": string, "startLine"?: integer >= 1, "endLine"?: integer >= startLine}'
  const { path: requestedPath, startLine, endLine } = args
  if (typeof requestedPath !== "string" || requestedPath === "")
    return failure("Invalid arguments for read_file: path must be a non-empty string. Expected " + usage + ".")
  if (startLine !== undefined && (!isInteger(startLine) || startLine < 1))
    return failure("Invalid arguments for read_file: startLine must be an integer >= 1. Expected " + usage + ".")
  if (endLine !== undefined && (!isInteger(endLine) || endLine < 1))
    return failure("Invalid arguments for read_file: endLine must be an integer >= 1. Expected " + usage + ".")
  if (isInteger(startLine) && isInteger(endLine) && endLine < startLine)
    return failure("Invalid arguments for read_file: endLine must not be before startLine. Expected " + usage + ".")

  const checked = checkSnapshotPath(requestedPath)
  if (checked.kind === "denied" || isDeniedSourceFile(checked.path, ctx.deniedPrefixes))
    return failure("Access denied: requested path is outside the allowed source snapshot. Use a relative path listed by list_dir.")

  const maxLinesAllowed = ctx.maxLines ?? DEFAULT_MAX_READ_LINES
  const maxBytesAllowed = ctx.maxBytes ?? DEFAULT_MAX_READ_BYTES
  let lines: string[] = []

  if (ctx.snapshot && ctx.snapshotId) {
    const probe = await ctx.snapshot.readLines(
      { snapshotId: ctx.snapshotId, path: checked.path, startLine: 1, endLine: 999999999 },
      signal,
    )
    if (probe.kind === "not_found") {
      return failure('File not found: "' + checked.path + '". Use list_dir or glob to find the correct path.')
    }
    if (probe.kind === "ok") {
      lines = probe.lines
    } else if (probe.lineCount === 0) {
      lines = []
    } else {
      const readAll = await ctx.snapshot.readLines(
        { snapshotId: ctx.snapshotId, path: checked.path, startLine: 1, endLine: probe.lineCount },
        signal,
      )
      if (readAll.kind === "not_found") {
        return failure('File not found: "' + checked.path + '". Use list_dir or glob to find the correct path.')
      }
      if (readAll.kind !== "ok") return failure("Could not read lines from the source snapshot.")
      lines = readAll.lines
    }
  } else {
    const fileContent = ctx.files?.get(checked.path)
    if (fileContent === undefined) {
      return failure('File not found: "' + checked.path + '". Use list_dir or glob to find the correct path.')
    }
    lines = splitLines(fileContent)
  }

  if (lines.length === 0) return { content: "", isError: false, filePath: checked.path }

  const first = (startLine as number | undefined) ?? 1
  if (first > lines.length) {
    return failure(
      "Line range " + first + "-" + ((endLine as number | undefined) ?? first) + ' is outside "' + checked.path +
        '", which has ' + lines.length + " lines. Request lines 1-" + lines.length + ".",
    )
  }

  const clampedEnd = Math.min((endLine as number | undefined) ?? lines.length, lines.length)
  const boundedLast = Math.min(clampedEnd, first + maxLinesAllowed - 1)
  const selectedLines = lines.slice(first - 1, boundedLast)
  const lineTruncated = clampedEnd > boundedLast
  const byteBounded = keepWithinByteLimit(selectedLines, maxBytesAllowed)
  const isTruncated = lineTruncated || byteBounded.truncated
  let content = byteBounded.lines.join("\n")
  if (isTruncated) content += (content === "" ? "" : "\n") + READ_TRUNCATION_MARKER

  const lineRange: [number, number] | undefined =
    byteBounded.lines.length > 0 ? [first, first + byteBounded.lines.length - 1] : undefined

  return {
    content,
    isError: false,
    filePath: checked.path,
    ...(lineRange ? { lineRange } : {}),
    ...(isTruncated ? { isTruncated: true } : {}),
  }
}

function keepWithinByteLimit(lines: readonly string[], maxBytes: number): { lines: string[]; truncated: boolean } {
  const kept: string[] = []
  let byteCount = 0

  for (const line of lines) {
    const separatorBytes = kept.length > 0 ? 1 : 0
    const lineBytes = Buffer.byteLength(line, "utf8")
    if (byteCount + separatorBytes + lineBytes > maxBytes) return { lines: kept, truncated: true }
    kept.push(line)
    byteCount += separatorBytes + lineBytes
  }

  return { lines: kept, truncated: false }
}
