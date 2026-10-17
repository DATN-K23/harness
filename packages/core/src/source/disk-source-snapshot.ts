import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { SnapshotReadResult, SourceSnapshotPort } from "@harness/protocol"
import { parseManifest, type SnapshotManifest } from "./manifest"
import { checkSnapshotPath, comparePaths, splitLines } from "./source-snapshot"

export interface DiskSourceSnapshotOptions {
  storageDir: string
  snapshotId: string
  deniedPrefixes?: readonly string[]
  manifest?: SnapshotManifest
}

/**
 * Implements SourceSnapshotPort backed by an immutable disk directory created by SnapshotManager.
 */
export class DiskSourceSnapshot implements SourceSnapshotPort {
  readonly snapshotId: string
  private readonly snapshotDir: string
  private readonly deniedPrefixes: readonly string[]
  private manifest: SnapshotManifest | null = null

  constructor(options: DiskSourceSnapshotOptions) {
    this.snapshotId = options.snapshotId
    this.snapshotDir = path.join(path.resolve(options.storageDir), options.snapshotId)
    this.deniedPrefixes = options.deniedPrefixes ?? []
    if (options.manifest) {
      this.manifest = options.manifest
    }
  }

  private async ensureManifest(): Promise<SnapshotManifest> {
    if (this.manifest) return this.manifest
    const manifestPath = path.join(this.snapshotDir, "manifest.json")
    const content = await fs.readFile(manifestPath, "utf8").catch(() => null)
    if (!content) {
      throw new Error(`Snapshot not found: "${this.snapshotId}" (checked "${manifestPath}")`)
    }
    this.manifest = parseManifest(content)
    return this.manifest
  }

  async readLines(
    input: { snapshotId: string; path: string; startLine: number; endLine: number },
    signal?: AbortSignal,
  ): Promise<SnapshotReadResult> {
    signal?.throwIfAborted()

    if (input.snapshotId !== this.snapshotId) {
      return { kind: "not_found" }
    }

    const checked = checkSnapshotPath(input.path, this.deniedPrefixes)
    if (checked.kind === "denied") {
      return { kind: "not_found" }
    }

    const manifest = await this.ensureManifest()
    const fileEntry = manifest.files[checked.path]
    if (!fileEntry) {
      return { kind: "not_found" }
    }

    const { startLine, endLine } = input
    const lineCount = fileEntry.lineCount

    if (startLine < 1 || startLine > lineCount || endLine < startLine) {
      return { kind: "out_of_range", lineCount }
    }

    const filePath = path.join(this.snapshotDir, checked.path)
    const content = await fs.readFile(filePath, "utf8").catch(() => null)
    if (content === null) {
      return { kind: "not_found" }
    }

    signal?.throwIfAborted()

    const lines = splitLines(content)
    const sliceEnd = Math.min(endLine, lines.length)
    return {
      kind: "ok",
      lines: lines.slice(startLine - 1, sliceEnd),
    }
  }

  async listFiles(input: { snapshotId: string; directory?: string }, signal?: AbortSignal): Promise<string[]> {
    signal?.throwIfAborted()

    if (input.snapshotId !== this.snapshotId) {
      return []
    }

    const manifest = await this.ensureManifest()
    let prefix = ""
    if (input.directory !== undefined && input.directory !== "") {
      const checked = checkSnapshotPath(input.directory, this.deniedPrefixes)
      if (checked.kind === "denied") return []
      prefix = checked.path.endsWith("/") ? checked.path : `${checked.path}/`
    }

    const visiblePaths = Object.keys(manifest.files).filter((filePath) => {
      if (checkSnapshotPath(filePath, this.deniedPrefixes).kind === "denied") return false
      return prefix === "" || filePath.startsWith(prefix)
    })

    return visiblePaths.toSorted(comparePaths)
  }
}
