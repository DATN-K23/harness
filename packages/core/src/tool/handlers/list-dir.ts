// Adapted from OpenCode packages/core/src/tool/handlers/list-dir.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, comparePaths } from "../../source/source-snapshot"

export interface ListDirContext {
  files: ReadonlyMap<string, string>
  deniedPrefixes: readonly string[]
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })

export function handleListDir(
  args: Record<string, unknown>,
  ctx: ListDirContext,
): ToolExecutionResult {
  const { path = "" } = args
  if (typeof path !== "string")
    return failure(`Invalid arguments for list_dir: path must be a string (received ${JSON.stringify(args)}). Expected {"path"?: string}.`)

  const checked = checkSnapshotPath(path, ctx.deniedPrefixes)
  if (checked.kind === "denied")
    return failure(
      `Access denied: "${path}" is outside the allowed source snapshot (${checked.reason}). Use a relative path inside the snapshot, for example one listed by list_dir.`,
    )

  const prefix = checked.path === "" ? "" : `${checked.path}/`
  const visiblePaths = [...ctx.files.keys()]
    .filter((candidate) => checkSnapshotPath(candidate, ctx.deniedPrefixes).kind === "ok")
    .toSorted(comparePaths)

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
  return { content: entries.join("\n"), isError: false }
}
