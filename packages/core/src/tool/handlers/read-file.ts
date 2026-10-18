// Adapted from OpenCode packages/core/src/tool/handlers/read-file.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { SourceSnapshotPort, ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, splitLines } from "../../source/source-snapshot"

export const DEFAULT_MAX_READ_LINES = 2000
export const DEFAULT_MAX_READ_BYTES = 100 * 1024 // 100 KB

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

  const maxLinesAllowed = ctx.maxLines ?? DEFAULT_MAX_READ_LINES
  const maxBytesAllowed = ctx.maxBytes ?? DEFAULT_MAX_READ_BYTES

  // If using SourceSnapshotPort
  if (ctx.snapshot && ctx.snapshotId) {
    const sLine = startLine ?? 1
    // Probe line 1 to get totalLineCount when out of range or not found
    const probe = await ctx.snapshot.readLines(
      {
        snapshotId: ctx.snapshotId,
        path: checked.path,
        startLine: 1,
        endLine: 999999999,
      },
      signal,
    )
    if (probe.kind === "not_found") {
      return failure(`File not found: "${path}". Use list_dir or glob to find the correct path.`)
    }
    const totalLines = probe.kind === "ok" ? probe.lines.length : probe.lineCount

    if (totalLines === 0) {
      return { content: "", isError: false, filePath: checked.path }
    }

    if (sLine > totalLines) {
      return failure(
        `Line range ${sLine}-${endLine ?? sLine} is outside "${path}", which has ${totalLines} lines. Request lines 1-${totalLines}.`,
      )
    }

    const requestedEnd = endLine ?? totalLines
    const clampedEnd = Math.min(requestedEnd, totalLines)
    const boundedLast = Math.min(clampedEnd, sLine + maxLinesAllowed - 1)
    const isTruncated = (ctx.maxLines !== undefined && clampedEnd > boundedLast)

    const res = probe.kind === "ok"
      ? { kind: "ok" as const, lines: probe.lines.slice(sLine - 1, boundedLast) }
      : await ctx.snapshot.readLines(
          {
            snapshotId: ctx.snapshotId,
            path: checked.path,
            startLine: sLine,
            endLine: boundedLast,
          },
          signal,
        )

    if (res.kind !== "ok") {
      return failure(`Could not read lines from "${path}".`)
    }

    let joined = res.lines.join("\n")
    let byteTruncated = false

    if (Buffer.byteLength(joined, "utf8") > maxBytesAllowed) {
      let currentBytes = 0
      const keptLines: string[] = []
      for (const line of res.lines) {
        const lineBytes = Buffer.byteLength(line, "utf8") + 1
        if (currentBytes + lineBytes > maxBytesAllowed) {
          byteTruncated = true
          break
        }
        keptLines.push(line)
        currentBytes += lineBytes
      }
      joined = keptLines.join("\n")
    }

    if (isTruncated || byteTruncated) {
      joined += `\n[Output truncated. File has more lines or exceeds size limit. Specify a narrower line range.]`
    }

    return {
      content: joined,
      isError: false,
      filePath: checked.path,
      lineRange: [sLine, boundedLast],
      ...(isTruncated || byteTruncated ? { isTruncated: true } : {}),
    }
  }

  // Fallback to in-memory files map
  const content = ctx.files?.get(checked.path)
  if (content === undefined)
    return failure(`File not found: "${path}". Use list_dir or glob to find the correct path.`)

  const lines = splitLines(content)
  if (lines.length === 0) return { content: "", isError: false, filePath: checked.path }
  const first = startLine ?? 1
  if (first > lines.length)
    return failure(
      `Line range ${first}-${endLine ?? first} is outside "${path}", which has ${lines.length} lines. Request lines 1-${lines.length}.`,
    )

  // Clamp endLine to lines.length per existing contract
  const clampedEnd = Math.min(endLine ?? lines.length, lines.length)
  const boundedLast = Math.min(clampedEnd, first + maxLinesAllowed - 1)
  let isTruncated = (ctx.maxLines !== undefined && clampedEnd > boundedLast)

  let slicedLines = lines.slice(first - 1, boundedLast)
  let joined = slicedLines.join("\n")

  if (Buffer.byteLength(joined, "utf8") > maxBytesAllowed) {
    let currentBytes = 0
    const keptLines: string[] = []
    for (const line of slicedLines) {
      const lineBytes = Buffer.byteLength(line, "utf8") + 1
      if (currentBytes + lineBytes > maxBytesAllowed) {
        isTruncated = true
        break
      }
      keptLines.push(line)
      currentBytes += lineBytes
    }
    joined = keptLines.join("\n")
  }

  if (isTruncated) {
    joined += `\n[Output truncated. File has more lines or exceeds size limit. Specify a narrower line range.]`
  }

  return {
    content: joined,
    isError: false,
    filePath: checked.path,
    lineRange: [first, boundedLast],
    ...(isTruncated ? { isTruncated: true } : {}),
  }
}
