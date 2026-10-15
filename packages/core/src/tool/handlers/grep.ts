// Adapted from OpenCode packages/core/src/tool/handlers/grep.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, comparePaths, splitLines } from "../../source/source-snapshot"

export interface GrepContext {
  files: ReadonlyMap<string, string>
  deniedPrefixes: readonly string[]
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })

export function handleGrep(
  args: Record<string, unknown>,
  ctx: GrepContext,
): ToolExecutionResult {
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

  const visiblePaths = [...ctx.files.keys()]
    .filter((path) => checkSnapshotPath(path, ctx.deniedPrefixes).kind === "ok")
    .toSorted(comparePaths)

  const matches = visiblePaths.flatMap((path) =>
    splitLines(ctx.files.get(path) ?? "").flatMap((line, index) =>
      matcher.test(line) ? [`${path}:${index + 1}: ${line}`] : [],
    ),
  )
  return { content: matches.length === 0 ? `No matches for "${pattern}".` : matches.join("\n"), isError: false }
}
