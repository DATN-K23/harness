// Adapted from OpenCode packages/core/src/tool/handlers/grep.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { SourceSnapshotPort, ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, comparePaths, splitLines } from "../../source/source-snapshot"

export const DEFAULT_MAX_GREP_MATCHES = 100

export interface GrepContext {
  files?: ReadonlyMap<string, string>
  snapshot?: SourceSnapshotPort
  snapshotId?: string
  deniedPrefixes: readonly string[]
  maxMatches?: number
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })

export async function handleGrep(
  args: Record<string, unknown>,
  ctx: GrepContext,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const usage = '{"pattern": string (regular expression)}'
  const { pattern } = args
  if (typeof pattern !== "string" || pattern === "")
    return failure(`Invalid arguments for grep: pattern must be a non-empty string (received ${JSON.stringify(args)}). Expected ${usage}.`)

  let matcher: RegExp
  try {
    matcher = new RegExp(pattern)
  } catch {
    return failure(
      `Invalid regular expression "${pattern}" for grep. Escape special characters or simplify the pattern.`,
    )
  }

  const maxMatches = ctx.maxMatches ?? DEFAULT_MAX_GREP_MATCHES
  const matches: string[] = []
  let isTruncated = false

  if (ctx.snapshot && ctx.snapshotId) {
    const visiblePaths = await ctx.snapshot.listFiles({ snapshotId: ctx.snapshotId }, signal)
    for (const filePath of visiblePaths) {
      if (matches.length >= maxMatches) {
        isTruncated = true
        break
      }
      signal?.throwIfAborted()

      const fullCheck = await ctx.snapshot.readLines(
        { snapshotId: ctx.snapshotId, path: filePath, startLine: 1, endLine: 999999999 },
        signal,
      )
      if (fullCheck.kind === "not_found") continue
      let lines: string[] = []
      if (fullCheck.kind === "ok") {
        lines = fullCheck.lines
      } else if (fullCheck.kind === "out_of_range" && fullCheck.lineCount > 0) {
        const readAll = await ctx.snapshot.readLines(
          { snapshotId: ctx.snapshotId, path: filePath, startLine: 1, endLine: fullCheck.lineCount },
          signal,
        )
        if (readAll.kind === "ok") {
          lines = readAll.lines
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (matcher.test(line)) {
          matches.push(`${filePath}:${i + 1}: ${line}`)
          if (matches.length >= maxMatches) {
            isTruncated = true
            break
          }
        }
      }
    }
  } else if (ctx.files) {
    const visiblePaths = [...ctx.files.keys()]
      .filter((path) => checkSnapshotPath(path, ctx.deniedPrefixes).kind === "ok")
      .toSorted(comparePaths)

    for (const path of visiblePaths) {
      if (matches.length >= maxMatches) {
        isTruncated = true
        break
      }
      const lines = splitLines(ctx.files.get(path) ?? "")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (matcher.test(line)) {
          matches.push(`${path}:${i + 1}: ${line}`)
          if (matches.length >= maxMatches) {
            isTruncated = true
            break
          }
        }
      }
    }
  }

  if (matches.length === 0) {
    return { content: `No matches for "${pattern}".`, isError: false }
  }

  let content = matches.join("\n")
  if (isTruncated) {
    content += `\n[Output truncated. Showing first ${maxMatches} matches. Use a more specific pattern.]`
  }

  return { content, isError: false, ...(isTruncated ? { isTruncated: true } : {}) }
}
