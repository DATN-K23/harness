import type { SourceSnapshotPort, ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, isDeniedSourceFile, comparePaths, globToRegExp } from "../../source/source-snapshot"

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
    return failure('Invalid arguments for glob: pattern must be a non-empty string. Expected {"pattern": string, for example "**/*.sol"}.')

  const checkedPattern = checkSnapshotPath(pattern)
  if (checkedPattern.kind === "denied" || isDeniedSourceFile(checkedPattern.path, ctx.deniedPrefixes))
    return failure("Access denied: glob pattern is outside the allowed source snapshot.")

  const matcher = globToRegExp(checkedPattern.path)
  let visiblePaths: string[] = []
  if (ctx.snapshot && ctx.snapshotId) {
    visiblePaths = await ctx.snapshot.listFiles({ snapshotId: ctx.snapshotId }, signal)
  } else if (ctx.files) {
    visiblePaths = [...ctx.files.keys()]
  }

  const paths = visiblePaths
    .filter((filePath) => checkSnapshotPath(filePath).kind === "ok")
    .filter((filePath) => !isDeniedSourceFile(filePath, ctx.deniedPrefixes))
    .filter((filePath) => matcher.test(filePath))
    .toSorted(comparePaths)
  if (paths.length === 0) return { content: 'No files match "' + checkedPattern.path + '".', isError: false }

  const maxMatches = ctx.maxMatches ?? DEFAULT_MAX_GLOB_MATCHES
  let isTruncated = false
  let selectedPaths = paths
  if (selectedPaths.length > maxMatches) {
    selectedPaths = selectedPaths.slice(0, maxMatches)
    isTruncated = true
  }

  let content = selectedPaths.join("\n")
  if (isTruncated) {
    content += "\n[Output truncated. Showing first " + maxMatches + " matches of " + paths.length + ".]"
  }

  return { content, isError: false, ...(isTruncated ? { isTruncated: true } : {}) }
}
