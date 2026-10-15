// Adapted from OpenCode packages/core/src/source/in-memory-snapshot.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { SnapshotReadResult, SourceSnapshotPort } from "@harness/protocol"
import { checkSnapshotPath, comparePaths, normalizeFiles, splitLines } from "./source-snapshot"

export interface InMemorySnapshotOptions {
  snapshotId: string
  /** Snapshot-relative path to file content. */
  files: Readonly<Record<string, string>>
  /** Paths under these prefixes behave as if they did not exist. */
  deniedPrefixes?: readonly string[]
}

export interface SnapshotReadRecord {
  snapshotId: string
  path: string
  startLine: number
  endLine: number
}

/**
 * Read-only by construction: the only members are `readLines` and `listFiles`. An absolute path, a `..` segment, a
 * denied prefix, a missing file and a wrong snapshot id all resolve as `not_found`, so a refusal reveals nothing about
 * what exists outside the allowed tree. Line numbers are 1-based and inclusive; a span must lie fully inside the file.
 */
export class InMemorySnapshot implements SourceSnapshotPort {
  readonly reads: SnapshotReadRecord[] = []
  private readonly snapshotId: string
  private readonly files: ReadonlyMap<string, string>
  private readonly deniedPrefixes: readonly string[]

  constructor(options: InMemorySnapshotOptions) {
    this.snapshotId = options.snapshotId
    this.files = normalizeFiles(options.files)
    this.deniedPrefixes = options.deniedPrefixes ?? []
  }

  async readLines(
    input: { snapshotId: string; path: string; startLine: number; endLine: number },
    signal?: AbortSignal,
  ): Promise<SnapshotReadResult> {
    signal?.throwIfAborted()
    this.reads.push({ ...input })
    if (input.snapshotId !== this.snapshotId) return { kind: "not_found" }
    const checked = checkSnapshotPath(input.path, this.deniedPrefixes)
    if (checked.kind === "denied") return { kind: "not_found" }
    const content = this.files.get(checked.path)
    if (content === undefined) return { kind: "not_found" }

    const lines = splitLines(content)
    const { startLine, endLine } = input
    const inside =
      Number.isInteger(startLine) &&
      Number.isInteger(endLine) &&
      startLine >= 1 &&
      endLine >= startLine &&
      endLine <= lines.length
    if (!inside) return { kind: "out_of_range", lineCount: lines.length }
    return { kind: "ok", lines: lines.slice(startLine - 1, endLine) }
  }

  async listFiles(input: { snapshotId: string; directory?: string }, signal?: AbortSignal): Promise<string[]> {
    signal?.throwIfAborted()
    if (input.snapshotId !== this.snapshotId) return []
    const directory = checkSnapshotPath(input.directory ?? "", this.deniedPrefixes)
    if (directory.kind === "denied") return []
    const prefix = directory.path === "" ? "" : `${directory.path}/`
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix) && checkSnapshotPath(path, this.deniedPrefixes).kind === "ok")
      .toSorted(comparePaths)
  }
}
