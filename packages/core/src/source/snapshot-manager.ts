import * as fs from "node:fs/promises"
import * as path from "node:path"
import { digestOf } from "../util/digest"
import { createIdGenerator, systemIdSources } from "../util/id"
import { parseManifest, serializeManifest, type SnapshotFileEntry, type SnapshotManifest } from "./manifest"
import { checkSnapshotPath, isDeniedSourceFile, splitLines } from "./source-snapshot"

export interface IngestRepositoryOptions {
  sourceDir: string
  storageDir: string
  snapshotId?: string
  extraDeniedPrefixes?: readonly string[]
}

export interface IngestResult {
  snapshotId: string
  snapshotDir: string
  manifest: SnapshotManifest
}

const defaultIdGen = createIdGenerator(systemIdSources)

export class SnapshotManager {
  /**
   * Recursively walks source directory, filters prohibited files, copies allowed files
   * to storageDir/<snapshotId>, computes file digests and tree digest, and writes manifest.json.
   */
  static async ingestRepository(options: IngestRepositoryOptions): Promise<IngestResult> {
    const { sourceDir, storageDir, extraDeniedPrefixes = [] } = options
    const resolvedSource = path.resolve(sourceDir)

    // Check sourceDir existence
    const stat = await fs.stat(resolvedSource).catch(() => null)
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Source repository directory does not exist or is not a directory: "${sourceDir}"`)
    }

    const snapshotId = options.snapshotId ?? defaultIdGen.next("snap_")
    const targetDir = path.join(path.resolve(storageDir), snapshotId)
    const stagingDir = path.join(path.resolve(storageDir), `.tmp-${snapshotId}`)

    // Clean any prior staging dir
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    await fs.mkdir(stagingDir, { recursive: true })

    const files: Record<string, SnapshotFileEntry> = {}

    try {
      await SnapshotManager.copyFilesRecursive({
        currentDir: resolvedSource,
        baseSourceDir: resolvedSource,
        stagingDir,
        files,
        extraDeniedPrefixes,
      })

      // Compute aggregate tree digest
      // Sorted path:digest list
      const lines = Object.keys(files)
        .sort()
        .map((p) => `${p}:${files[p]!.digest}`)
        .join("\n")

      const treeDigest = digestOf(lines)

      const manifest: SnapshotManifest = {
        snapshotId,
        createdAt: new Date().toISOString(),
        treeDigest,
        files,
      }

      // Write manifest.json inside stagingDir
      const manifestPath = path.join(stagingDir, "manifest.json")
      await fs.writeFile(manifestPath, serializeManifest(manifest), "utf8")

      // Atomically move stagingDir to targetDir
      await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {})
      await fs.rename(stagingDir, targetDir)

      return {
        snapshotId,
        snapshotDir: targetDir,
        manifest,
      }
    } catch (error) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  /**
   * Loads and validates the manifest of an existing snapshot.
   */
  static async loadSnapshotManifest(storageDir: string, snapshotId: string): Promise<SnapshotManifest> {
    const manifestPath = path.join(path.resolve(storageDir), snapshotId, "manifest.json")
    const content = await fs.readFile(manifestPath, "utf8").catch(() => null)
    if (!content) {
      throw new Error(`Snapshot not found: "${snapshotId}" (checked "${manifestPath}")`)
    }

    try {
      const manifest = parseManifest(content)
      return manifest
    } catch (err) {
      throw new Error(`Corrupted snapshot manifest for "${snapshotId}": ${(err as Error).message}`)
    }
  }

  /**
   * Deletes a snapshot from storage directory.
   */
  static async deleteSnapshot(storageDir: string, snapshotId: string): Promise<void> {
    const snapshotDir = path.join(path.resolve(storageDir), snapshotId)
    await fs.rm(snapshotDir, { recursive: true, force: true }).catch(() => {})
  }

  private static async copyFilesRecursive(params: {
    currentDir: string
    baseSourceDir: string
    stagingDir: string
    files: Record<string, SnapshotFileEntry>
    extraDeniedPrefixes: readonly string[]
  }): Promise<void> {
    const entries = await fs.readdir(params.currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(params.currentDir, entry.name)
      const relPath = path.relative(params.baseSourceDir, fullPath).replaceAll("\\", "/")

      // Prevent traversal / absolute / symlink escapes
      const checked = checkSnapshotPath(relPath)
      if (checked.kind === "denied") continue

      if (isDeniedSourceFile(relPath, params.extraDeniedPrefixes)) {
        continue
      }

      if (entry.isSymbolicLink()) {
        // Resolve real path to verify it does not escape baseSourceDir
        const realTarget = await fs.realpath(fullPath).catch(() => null)
        if (!realTarget) continue
        const relToSource = path.relative(params.baseSourceDir, realTarget)
        if (relToSource.startsWith("..") || path.isAbsolute(relToSource)) {
          // Symlink escapes source root -> denied
          continue
        }
      }

      if (entry.isDirectory()) {
        await SnapshotManager.copyFilesRecursive({
          ...params,
          currentDir: fullPath,
        })
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const content = await fs.readFile(fullPath, "utf8")
        const digest = digestOf(content)
        const lineCount = splitLines(content).length
        const byteSize = Buffer.byteLength(content, "utf8")

        const destPath = path.join(params.stagingDir, relPath)
        await fs.mkdir(path.dirname(destPath), { recursive: true })
        await fs.writeFile(destPath, content, "utf8")

        params.files[relPath] = {
          digest,
          lineCount,
          byteSize,
        }
      }
    }
  }
}
