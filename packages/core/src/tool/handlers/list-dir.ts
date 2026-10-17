// Adapted from OpenCode packages/core/src/tool/handlers/list-dir.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { SourceSnapshotPort, ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, comparePaths } from "../../source/source-snapshot"

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
  const { path = "" } = args
  if (typeof path !== "string")
    return failure(`Invalid arguments for list_dir: path must be a string (received ${JSON.stringify(args)}). Expected {"path"?: string}.`)

  const checked = checkSnapshotPath(path, ctx.deniedPrefixes)
  if (checked.kind === "denied")
    return failure(
      `Access denied: "${path}" is outside the allowed source snapshot (${checked.reason}). Use a relative path inside the snapshot, for example one listed by list_dir.`,
    )

  let visiblePaths: string[] = []
  if (ctx.snapshot && ctx.snapshotId) {
    visiblePaths = await ctx.snapshot.listFiles({ snapshotId: ctx.snapshotId, directory: checked.path }, signal)
  } else if (ctx.files) {
    visiblePaths = [...ctx.files.keys()]
      .filter((candidate) => checkSnapshotPath(candidate, ctx.deniedPrefixes).kind === "ok")
      .toSorted(comparePaths)
  }

  const prefix = checked.path === "" ? "" : `${checked.path}/`
  const entries = [
    ...new Set(
      visiblePaths
        .filter((candidate) => candidate.startsWith(prefix))
        .map((candidate) => candidate.slice(prefix.length))
        .map((rest) => (rest.includes("/") ? `${rest.split("/")[0]}/` : rest)),
    ),
  ]

  if (entries.length === 0)
    return failure(`Directory not found: "${path}". Use list_dir with no path to see the root.`)

  const maxEntries = ctx.maxEntries ?? DEFAULT_MAX_LIST_ENTRIES
  let isTruncated = false
  let selectedEntries = entries
  if (selectedEntries.length > maxEntries) {
    selectedEntries = selectedEntries.slice(0, maxEntries)
    isTruncated = true
  }

  let content = selectedEntries.join("\n")
  if (isTruncated) {
    content += `\n[Output truncated. Showing first ${maxEntries} entries of ${entries.length}.]`
  }

  return { content, isError: false }
}
