import * as fs from "node:fs/promises"
import { SnapshotManager } from "@harness/core"
import type { SnapshotManifest } from "@harness/core"
import { redactSecrets } from "../redaction"

export async function executeSnapshotListCommand(options: {
  storageDir: string
  secrets?: readonly string[]
}): Promise<{ exitCode: number; output: string }> {
  try {
    const entries = await readSnapshotEntries(options.storageDir)
    const manifests: SnapshotManifest[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".tmp-")) continue
      try {
        manifests.push(await SnapshotManager.loadSnapshotManifest(options.storageDir, entry.name))
      } catch {
        // Ignore unrelated directories and incomplete snapshots.
      }
    }
    manifests.sort((left, right) => left.snapshotId.localeCompare(right.snapshotId))
    if (manifests.length === 0) return { exitCode: 0, output: "No snapshots found." }
    return {
      exitCode: 0,
      output: redactSecrets(manifests.map((manifest) => [
        `Snapshot ID: ${manifest.snapshotId}`,
        `Files: ${Object.keys(manifest.files).length}`,
        `Tree digest: ${manifest.treeDigest}`,
        `Ingestion policy version: ${manifest.ingestionPolicyVersion ?? "-"}`,
        `Created at: ${manifest.createdAt}`,
      ].join("\n")).join("\n\n"), options.secrets),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list snapshots."
    return { exitCode: 1, output: `Error: ${redactSecrets(message, options.secrets)}` }
  }
}


async function readSnapshotEntries(storageDir: string) {
  try {
    return await fs.readdir(storageDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}
