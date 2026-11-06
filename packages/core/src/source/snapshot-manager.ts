import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { digestOf } from "../util/digest"
import {
  parseManifest,
  serializeManifest,
  type SnapshotFileEntry,
  type SnapshotManifest,
  type SnapshotSkippedEntry,
  type SnapshotWarningEntry,
} from "./manifest"
import { checkSnapshotPath, isDeniedSourceFile, splitLines } from "./source-snapshot"
import { SnapshotExistsError, SnapshotInUseError } from "./snapshot-errors"
import { resolveSnapshotDir } from "./snapshot-path"

export interface IngestRepositoryOptions {
  sourceDir: string
  storageDir: string
  snapshotId?: string
  extraDeniedPrefixes?: readonly string[]
  includeRoots?: readonly string[]
  maxFileBytes?: number
  maxFiles?: number
  maxTotalBytes?: number
}
export interface IngestResult {
  snapshotId: string
  snapshotDir: string
  manifest: SnapshotManifest
}
export interface DeleteSnapshotOptions {
  isInUse: (snapshotId: string) => Promise<boolean>
}

const DefaultMaxFileBytes = 1024 * 1024
const DefaultMaxFiles = 20_000
const DefaultMaxTotalBytes = 200 * 1024 * 1024
const reportLikeFragments = ["finding", "report", "judg", "adjudic", "ground", "label", "score"]

interface IngestState {
  files: Record<string, SnapshotFileEntry>
  skipped: SnapshotSkippedEntry[]
  warnings: SnapshotWarningEntry[]
  fileCount: number
  totalBytes: number
}

export class SnapshotManager {
  static async ingestRepository(options: IngestRepositoryOptions): Promise<IngestResult> {
    const { sourceDir, storageDir, extraDeniedPrefixes = [] } = options
    const resolvedSource = path.resolve(sourceDir)
    const storageRoot = path.resolve(storageDir)

    if (options.snapshotId !== undefined) resolveSnapshotDir(storageRoot, options.snapshotId)

    const includeRoots = normalizeIncludeRoots(options.includeRoots)
    const maxFileBytes = validateLimit("maxFileBytes", options.maxFileBytes ?? DefaultMaxFileBytes)
    const maxFiles = validateLimit("maxFiles", options.maxFiles ?? DefaultMaxFiles)
    const maxTotalBytes = validateLimit("maxTotalBytes", options.maxTotalBytes ?? DefaultMaxTotalBytes)

    const sourceStat = await fs.lstat(resolvedSource).catch(() => null)
    if (!sourceStat || !sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      throw new Error("Source repository directory does not exist or is not a directory")
    }

    await fs.mkdir(storageRoot, { recursive: true })
    const stagingDir = path.join(storageRoot, ".tmp-" + randomUUID())
    await fs.mkdir(stagingDir)
    const state: IngestState = { files: {}, skipped: [], warnings: [], fileCount: 0, totalBytes: 0 }

    try {
      await SnapshotManager.copyFilesRecursive({
        currentDir: resolvedSource,
        relativeDir: "",
        stagingDir,
        state,
        extraDeniedPrefixes,
        includeRoots,
        maxFileBytes,
        maxFiles,
        maxTotalBytes,
      })

      const treeLines = Object.keys(state.files)
        .sort()
        .map((filePath) => filePath + ":" + state.files[filePath]!.digest)
        .join("\n")
      const treeDigest = digestOf(treeLines)
      const snapshotId = options.snapshotId ?? "snap_" + treeDigest.slice("sha256:".length, "sha256:".length + 12)
      const targetDir = resolveSnapshotDir(storageRoot, snapshotId)
      const manifest: SnapshotManifest = {
        snapshotId,
        createdAt: new Date().toISOString(),
        treeDigest,
        ingestionPolicyVersion: "ingest-policy-v2",
        files: state.files,
        ...(state.skipped.length > 0 ? { skipped: state.skipped } : {}),
        ...(state.warnings.length > 0 ? { warnings: state.warnings } : {}),
      }

      await fs.writeFile(path.join(stagingDir, "manifest.json"), serializeManifest(manifest), "utf8")
      const existing = await SnapshotManager.findExistingSnapshot(targetDir, snapshotId)
      if (existing) {
        await fs.rm(stagingDir, { recursive: true, force: true })
        if (existing.treeDigest !== treeDigest) throw new SnapshotExistsError(snapshotId)
        return { snapshotId, snapshotDir: targetDir, manifest: existing }
      }

      try {
        await fs.rename(stagingDir, targetDir)
      } catch (error) {
        const raced = await SnapshotManager.findExistingSnapshot(targetDir, snapshotId)
        if (!raced) throw error
        await fs.rm(stagingDir, { recursive: true, force: true })
        if (raced.treeDigest !== treeDigest) throw new SnapshotExistsError(snapshotId)
        return { snapshotId, snapshotDir: targetDir, manifest: raced }
      }
      return { snapshotId, snapshotDir: targetDir, manifest }
    } catch (error) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  static async loadSnapshotManifest(storageDir: string, snapshotId: string): Promise<SnapshotManifest> {
    const snapshotDir = resolveSnapshotDir(storageDir, snapshotId)
    const manifestPath = path.join(snapshotDir, "manifest.json")
    const content = await fs.readFile(manifestPath, "utf8").catch(() => null)
    if (!content) throw new Error("Snapshot not found: \"" + snapshotId + "\"")
    try {
      return parseManifest(content)
    } catch (error) {
      throw new Error("Corrupted snapshot manifest for \"" + snapshotId + "\": " + (error as Error).message)
    }
  }

  static async deleteSnapshot(storageDir: string, snapshotId: string, options: DeleteSnapshotOptions): Promise<void> {
    const snapshotDir = resolveSnapshotDir(storageDir, snapshotId)
    if (await options.isInUse(snapshotId)) throw new SnapshotInUseError(snapshotId)
    await fs.rm(snapshotDir, { recursive: true, force: true }).catch(() => {})
  }

  static async cleanupStaging(storageDir: string): Promise<void> {
    const storageRoot = path.resolve(storageDir)
    const entries = await fs.readdir(storageRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    for (const entry of entries) {
      if (!entry.name.startsWith(".tmp-")) continue
      const stagingPath = path.join(storageRoot, entry.name)
      const stat = await fs.lstat(stagingPath).catch(() => null)
      if (stat?.isDirectory() && !stat.isSymbolicLink()) {
        await fs.rm(stagingPath, { recursive: true, force: true })
      }
    }
  }

  private static async findExistingSnapshot(snapshotDir: string, snapshotId: string): Promise<SnapshotManifest | null> {
    const stat = await fs.lstat(snapshotDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (!stat) return null
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SnapshotExistsError(snapshotId)

    try {
      const content = await fs.readFile(path.join(snapshotDir, "manifest.json"), "utf8")
      const manifest = parseManifest(content)
      if (manifest.snapshotId !== snapshotId) throw new SnapshotExistsError(snapshotId)
      return manifest
    } catch (error) {
      if (error instanceof SnapshotExistsError) throw error
      throw new SnapshotExistsError(snapshotId)
    }
  }

  private static async copyFilesRecursive(params: {
    currentDir: string
    relativeDir: string
    stagingDir: string
    state: IngestState
    extraDeniedPrefixes: readonly string[]
    includeRoots: readonly string[] | undefined
    maxFileBytes: number
    maxFiles: number
    maxTotalBytes: number
  }): Promise<void> {
    const entries = await fs.readdir(params.currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const sourcePath = path.join(params.currentDir, entry.name)
      const relativePath = params.relativeDir ? params.relativeDir + "/" + entry.name : entry.name
      const checked = checkSnapshotPath(relativePath)
      if (checked.kind === "denied") continue
      if (isDeniedSourceFile(checked.path, params.extraDeniedPrefixes)) {
        params.state.skipped.push({ path: checked.path, reason: "denied" })
        continue
      }

      const stat = await fs.lstat(sourcePath)
      if (stat.isSymbolicLink()) {
        params.state.skipped.push({ path: checked.path, reason: "symlink" })
        continue
      }
      if (!isIncludedPath(checked.path, params.includeRoots, stat.isDirectory())) {
        params.state.skipped.push({ path: checked.path, reason: "denied" })
        continue
      }

      if (stat.isDirectory()) {
        await SnapshotManager.copyFilesRecursive({
          ...params,
          currentDir: sourcePath,
          relativeDir: checked.path,
        })
        continue
      }
      if (!stat.isFile()) continue

      params.state.fileCount += 1
      if (params.state.fileCount > params.maxFiles) {
        throw new Error("Snapshot ingestion exceeded the maximum file count of " + params.maxFiles)
      }
      if (stat.size > params.maxFileBytes) {
        params.state.skipped.push({ path: checked.path, reason: "too_large" })
        continue
      }

      const bytes = await fs.readFile(sourcePath)
      if (bytes.byteLength > params.maxFileBytes) {
        params.state.skipped.push({ path: checked.path, reason: "too_large" })
        continue
      }
      const prefix = bytes.subarray(0, Math.min(bytes.byteLength, 8 * 1024))
      if (prefix.includes(0)) {
        params.state.skipped.push({ path: checked.path, reason: "binary" })
        continue
      }
      if (params.state.totalBytes + bytes.byteLength > params.maxTotalBytes) {
        throw new Error("Snapshot ingestion exceeded the maximum total size of " + params.maxTotalBytes + " bytes")
      }

      const content = bytes.toString("utf8")
      const digest = digestOf(content)
      const destination = path.join(params.stagingDir, checked.path)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, content, "utf8")
      params.state.files[checked.path] = {
        digest,
        lineCount: splitLines(content).length,
        byteSize: Buffer.byteLength(content, "utf8"),
      }
      params.state.totalBytes += bytes.byteLength

      const filename = path.posix.basename(checked.path).toLowerCase()
      if (reportLikeFragments.some((fragment) => filename.includes(fragment))) {
        params.state.warnings.push({ path: checked.path, reason: "report_like_name" })
      }
    }
  }
}

function normalizeIncludeRoots(includeRoots: readonly string[] | undefined): readonly string[] | undefined {
  if (includeRoots === undefined) return undefined
  return includeRoots.map((includeRoot) => {
    const checked = checkSnapshotPath(includeRoot)
    if (checked.kind === "denied") throw new Error("Include roots must be relative paths inside the repository")
    return checked.path
  })
}

function isIncludedPath(
  relativePath: string,
  includeRoots: readonly string[] | undefined,
  isDirectory: boolean,
): boolean {
  if (includeRoots === undefined) return true
  return includeRoots.some((root) => {
    if (root === "" || relativePath === root || relativePath.startsWith(root + "/")) return true
    return isDirectory && root.startsWith(relativePath + "/")
  })
}

function validateLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(name + " must be a non-negative safe integer")
  return value
}

export const cleanupStaging = (storageDir: string): Promise<void> => SnapshotManager.cleanupStaging(storageDir)
