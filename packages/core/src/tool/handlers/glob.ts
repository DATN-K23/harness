// Adapted from OpenCode packages/core/src/tool/handlers/glob.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, comparePaths, globToRegExp } from "../../source/source-snapshot"

export interface GlobContext {
  files: ReadonlyMap<string, string>
  deniedPrefixes: readonly string[]
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })

export function handleGlob(
  args: Record<string, unknown>,
  ctx: GlobContext,
): ToolExecutionResult {
  const { pattern } = args
  if (typeof pattern !== "string" || pattern === "")
    return failure(`Invalid arguments for glob: pattern must be a non-empty string (received ${JSON.stringify(args)}). Expected {"pattern": string, for example "**/*.sol"}.`)

  const matcher = globToRegExp(pattern)
  const visiblePaths = [...ctx.files.keys()]
    .filter((path) => checkSnapshotPath(path, ctx.deniedPrefixes).kind === "ok")
    .toSorted(comparePaths)

  const paths = visiblePaths.filter((path) => matcher.test(path))
  return { content: paths.length === 0 ? `No files match "${pattern}".` : paths.join("\n"), isError: false }
}
