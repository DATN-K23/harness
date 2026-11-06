import * as fs from "node:fs/promises"
import * as path from "node:path"
import { SnapshotManager } from "@harness/core"
import type { SnapshotManifest } from "@harness/core"
import { redactSecrets } from "../redaction"

export interface RepoAddCommandOptions {
  sourceDir?: string
  storageDir: string
  includeRoots?: string[]
  snapshotId?: string
  secrets?: readonly string[]
}

export async function executeRepoAddCommand(options: RepoAddCommandOptions): Promise<{
  exitCode: number
  output: string
}> {
  if (!options.sourceDir?.trim()) {
    return { exitCode: 1, output: "Error: repo add requires <path>." }
  }
  try {
    if (await isStorageInsideSource(options.sourceDir, options.storageDir)) {
      return {
        exitCode: 1,
        output: "Error: snapshot storage must be outside the source repository.",
      }
    }
    const { manifest } = await SnapshotManager.ingestRepository({
      sourceDir: options.sourceDir,
      storageDir: options.storageDir,
      ...(options.snapshotId ? { snapshotId: options.snapshotId } : {}),
      ...(options.includeRoots !== undefined ? { includeRoots: options.includeRoots } : {}),
    })
    const skippedCounts = countSkipped(manifest)
    return {
      exitCode: 0,
      output: redactSecrets([
        `Snapshot ID: ${manifest.snapshotId}`,
        `Files: ${Object.keys(manifest.files).length}`,
        `Skipped: ${Object.entries(skippedCounts).map(([reason, count]) => `${reason}=${count}`).join(", ")}`,
      ].join("\n"), options.secrets),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repository ingestion failed."
    return { exitCode: 1, output: `Error: ${redactSecrets(message, options.secrets)}` }
  }
}

function countSkipped(manifest: SnapshotManifest): Record<string, number> {
  const counts: Record<string, number> = { denied: 0, symlink: 0, too_large: 0, binary: 0 }
  for (const skipped of manifest.skipped ?? []) counts[skipped.reason] += 1
  return counts
}

async function isStorageInsideSource(sourceDir: string, storageDir: string): Promise<boolean> {
  const sourceRoot = await fs.realpath(sourceDir).catch(() => path.resolve(sourceDir))
  const storagePath = path.resolve(storageDir)
  let existingPath = storagePath
  const missingSegments: string[] = []
  while (true) {
    try {
      const existingRealPath = await fs.realpath(existingPath)
      const storageRoot = path.resolve(existingRealPath, ...missingSegments)
      const relativePath = path.relative(sourceRoot, storageRoot)
      return relativePath === "" || (
        relativePath !== ".." &&
        !relativePath.startsWith(".." + path.sep) &&
        !path.isAbsolute(relativePath)
      )
    } catch {
      const parentPath = path.dirname(existingPath)
      if (parentPath === existingPath) return false
      missingSegments.unshift(path.basename(existingPath))
      existingPath = parentPath
    }
  }
}
