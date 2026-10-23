import type { SourceSnapshotPort, ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, isDeniedSourceFile, comparePaths } from "../../source/source-snapshot"

export const DEFAULT_MAX_LIST_ENTRIES = 500

export interface ListDirContext {
  files?: ReadonlyMap<string, string>
  snapshot?: SourceSnapshotPort
  snapshotId?: string
  deniedPrefixes: readonly string[]
  maxEntries?: number
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })

export async function handleListDir(
  args: Record<string, unknown>,
  ctx: ListDirContext,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const { path: requestedPath = "" } = args
  if (typeof requestedPath !== "string")
    return failure('Invalid arguments for list_dir: path must be a string. Expected {"path"?: string}.')

  const checked = checkSnapshotPath(requestedPath)
  if (checked.kind === "denied" || isDeniedSourceFile(checked.path, ctx.deniedPrefixes))
    return failure("Access denied: requested path is outside the allowed source snapshot. Use a relative path listed by list_dir.")

  let visiblePaths: string[] = []
  if (ctx.snapshot && ctx.snapshotId) {
    visiblePaths = await ctx.snapshot.listFiles({ snapshotId: ctx.snapshotId, directory: checked.path }, signal)
  } else if (ctx.files) {
    visiblePaths = [...ctx.files.keys()]
  }

  visiblePaths = visiblePaths
    .filter((candidate) => checkSnapshotPath(candidate).kind === "ok")
    .filter((candidate) => !isDeniedSourceFile(candidate, ctx.deniedPrefixes))
    .toSorted(comparePaths)

  const prefix = checked.path === "" ? "" : checked.path + "/"
  const entries = [
    ...new Set(
      visiblePaths
        .filter((candidate) => candidate.startsWith(prefix))
        .map((candidate) => candidate.slice(prefix.length))
        .map((rest) => (rest.includes("/") ? rest.split("/")[0] + "/" : rest)),
    ),
  ]

  if (entries.length === 0)
    return failure('Directory not found: "' + checked.path + '". Use list_dir with no path to see the root.')

  const maxEntries = ctx.maxEntries ?? DEFAULT_MAX_LIST_ENTRIES
  let isTruncated = false
  let selectedEntries = entries
  if (selectedEntries.length > maxEntries) {
    selectedEntries = selectedEntries.slice(0, maxEntries)
    isTruncated = true
  }

  let content = selectedEntries.join("\n")
  if (isTruncated) {
    content += "\n[Output truncated. Showing first " + maxEntries + " entries of " + entries.length + ".]"
  }

  return { content, isError: false, ...(isTruncated ? { isTruncated: true } : {}) }
}
