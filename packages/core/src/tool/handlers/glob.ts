// Adapted from OpenCode packages/core/src/tool/handlers/glob.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { SourceSnapshotPort, ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, comparePaths, globToRegExp } from "../../source/source-snapshot"

export const DEFAULT_MAX_GLOB_MATCHES = 500

export interface GlobContext {
  files?: ReadonlyMap<string, string>
  snapshot?: SourceSnapshotPort
  snapshotId?: string
  deniedPrefixes: readonly string[]
  maxMatches?: number
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })

export async function handleGlob(
  args: Record<string, unknown>,
  ctx: GlobContext,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const { pattern } = args
  if (typeof pattern !== "string" || pattern === "")
    return failure(`Invalid arguments for glob: pattern must be a non-empty string (received ${JSON.stringify(args)}). Expected {"pattern": string, for example "**/*.sol"}.`)

  const matcher = globToRegExp(pattern)

  let visiblePaths: string[] = []
  if (ctx.snapshot && ctx.snapshotId) {
    visiblePaths = await ctx.snapshot.listFiles({ snapshotId: ctx.snapshotId }, signal)
  } else if (ctx.files) {
    visiblePaths = [...ctx.files.keys()]
      .filter((path) => checkSnapshotPath(path, ctx.deniedPrefixes).kind === "ok")
      .toSorted(comparePaths)
  }

  const paths = visiblePaths.filter((path) => matcher.test(path))
  if (paths.length === 0) return { content: `No files match "${pattern}".`, isError: false }

  const maxMatches = ctx.maxMatches ?? DEFAULT_MAX_GLOB_MATCHES
  let isTruncated = false
  let selectedPaths = paths
  if (selectedPaths.length > maxMatches) {
    selectedPaths = selectedPaths.slice(0, maxMatches)
    isTruncated = true
  }

  let content = selectedPaths.join("\n")
  if (isTruncated) {
    content += `\n[Output truncated. Showing first ${maxMatches} matches of ${paths.length}.]`
  }

  return { content, isError: false }
}
