// Adapted from OpenCode packages/core/src/tool/handlers/grep.ts @ 3f393d78bf (MIT License). See NOTICE.
import { Worker } from "node:worker_threads"
import type { SourceSnapshotPort, ToolExecutionResult } from "@harness/protocol"
import { checkSnapshotPath, isDeniedSourceFile, comparePaths, splitLines } from "../../source/source-snapshot"

export const DEFAULT_MAX_GREP_MATCHES = 100
export const DEFAULT_GREP_TIMEOUT_MS = 2000
export const DEFAULT_MAX_GREP_SCAN_BYTES = 50 * 1024 * 1024
export const DEFAULT_MAX_GREP_LINE_CHARS = 500

export interface GrepContext {
  files?: ReadonlyMap<string, string>
  snapshot?: SourceSnapshotPort
  snapshotId?: string
  deniedPrefixes: readonly string[]
  maxMatches?: number
  timeoutMs?: number
  maxScanBytes?: number
  maxLineChars?: number
}

interface GrepScanFile {
  path: string
  lines: string[]
}

interface GrepMatch {
  path: string
  lineNumber: number
  line: string
}

interface GrepWorkerResponse {
  matches: GrepMatch[]
  truncated: boolean
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })

export async function handleGrep(
  args: Record<string, unknown>,
  ctx: GrepContext,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const { pattern } = args
  if (typeof pattern !== "string" || pattern === "")
    return failure('Invalid arguments for grep: pattern must be a non-empty string. Expected {"pattern": string (regular expression)}.')

  try {
    new RegExp(pattern)
  } catch {
    return failure("Invalid regular expression for grep. Escape special characters or simplify the pattern.")
  }

  const maxMatches = ctx.maxMatches ?? DEFAULT_MAX_GREP_MATCHES
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_GREP_TIMEOUT_MS
  const maxScanBytes = ctx.maxScanBytes ?? DEFAULT_MAX_GREP_SCAN_BYTES
  const maxLineChars = ctx.maxLineChars ?? DEFAULT_MAX_GREP_LINE_CHARS
  const files = await getAuthorizedFiles(ctx, signal)
  const bounded = capScanFiles(files, maxScanBytes)
  const workerResult = await runGrepWorker(pattern, bounded.files, maxMatches, timeoutMs, signal)

  if (workerResult.kind === "timeout") {
    return failure(
      "grep timed out after " + timeoutMs + " ms; use a more specific pattern or path.",
    )
  }

  const matches: string[] = []
  let lineTruncated = false
  for (const match of workerResult.result.matches) {
    const displayed = truncateMatchedLine(match.line, maxLineChars)
    if (displayed.truncated) lineTruncated = true
    matches.push(match.path + ":" + match.lineNumber + ": " + displayed.line)
  }

  const isTruncated = bounded.truncated || workerResult.result.truncated || lineTruncated
  if (matches.length === 0 && !isTruncated) {
    const safePattern = /^[A-Za-z0-9_.-]+$/.test(pattern)
    return {
      content: safePattern ? 'No matches for "' + pattern + '".' : "No matches for the requested pattern.",
      isError: false,
    }
  }

  let content = matches.join("\n")
  if (isTruncated) {
    const marker = workerResult.result.truncated
      ? "[Output truncated. Showing first " + maxMatches + " matches. Use a more specific pattern.]"
      : "[Output truncated. Search limits reached. Use a more specific pattern.]"
    content += (content === "" ? "" : "\n") + marker
  }

  return { content, isError: false, ...(isTruncated ? { isTruncated: true } : {}) }
}

async function getAuthorizedFiles(ctx: GrepContext, signal?: AbortSignal): Promise<GrepScanFile[]> {
  const result: GrepScanFile[] = []
  if (ctx.snapshot && ctx.snapshotId) {
    const listedPaths = await ctx.snapshot.listFiles({ snapshotId: ctx.snapshotId }, signal)
    const visiblePaths = listedPaths
      .filter((filePath) => checkSnapshotPath(filePath).kind === "ok")
      .filter((filePath) => !isDeniedSourceFile(filePath, ctx.deniedPrefixes))
      .toSorted(comparePaths)

    for (const filePath of visiblePaths) {
      signal?.throwIfAborted()
      const read = await ctx.snapshot.readLines(
        { snapshotId: ctx.snapshotId, path: filePath, startLine: 1, endLine: 999999999 },
        signal,
      )
      if (read.kind === "not_found") continue
      if (read.kind === "ok") {
        result.push({ path: filePath, lines: read.lines })
      } else if (read.lineCount > 0) {
        const readAll = await ctx.snapshot.readLines(
          { snapshotId: ctx.snapshotId, path: filePath, startLine: 1, endLine: read.lineCount },
          signal,
        )
        if (readAll.kind === "ok") result.push({ path: filePath, lines: readAll.lines })
      }
    }
    return result
  }

  if (!ctx.files) return result
  const visiblePaths = [...ctx.files.keys()]
    .filter((filePath) => checkSnapshotPath(filePath).kind === "ok")
    .filter((filePath) => !isDeniedSourceFile(filePath, ctx.deniedPrefixes))
    .toSorted(comparePaths)

  for (const filePath of visiblePaths) {
    result.push({ path: filePath, lines: splitLines(ctx.files.get(filePath) ?? "") })
  }
  return result
}

function capScanFiles(
  files: readonly GrepScanFile[],
  maxScanBytes: number,
): { files: GrepScanFile[]; truncated: boolean } {
  const bounded: GrepScanFile[] = []
  let scannedBytes = 0

  for (const file of files) {
    const lines: string[] = []
    for (let index = 0; index < file.lines.length; index++) {
      const line = file.lines[index]!
      const lineBytes = Buffer.byteLength(line, "utf8") + 1
      if (scannedBytes + lineBytes > maxScanBytes) {
        if (lines.length > 0) bounded.push({ path: file.path, lines })
        return { files: bounded, truncated: true }
      }
      lines.push(line)
      scannedBytes += lineBytes
    }
    if (lines.length > 0) bounded.push({ path: file.path, lines })
  }

  return { files: bounded, truncated: false }
}

async function runGrepWorker(
  pattern: string,
  files: GrepScanFile[],
  maxMatches: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ kind: "timeout" } | { kind: "result"; result: GrepWorkerResponse }> {
  signal?.throwIfAborted()
  const worker = new Worker(new URL("./grep-worker.ts", import.meta.url))
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined

  try {
    const outcome = await new Promise<
      | { kind: "timeout" }
      | { kind: "result"; result: GrepWorkerResponse }
    >((resolve, reject) => {
      timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
      abortHandler = () => reject(signal?.reason ?? new Error("Grep aborted"))
      signal?.addEventListener("abort", abortHandler, { once: true })
      worker.once("message", (result: GrepWorkerResponse) => resolve({ kind: "result", result }))
      worker.once("error", reject)
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error("Grep worker exited unexpectedly"))
      })
      worker.postMessage({ pattern, files, maxMatches })
    })
    return outcome
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (abortHandler) signal?.removeEventListener("abort", abortHandler)
    await worker.terminate()
  }
}
function truncateMatchedLine(line: string, maxChars: number): { line: string; truncated: boolean } {
  const characters = Array.from(line)
  if (characters.length <= maxChars) return { line, truncated: false }
  if (maxChars <= 0) return { line: "", truncated: true }

  const marker = maxChars >= 12 ? "... [cut]" : "...".slice(0, maxChars)
  const prefixLength = Math.max(0, maxChars - marker.length)
  return { line: characters.slice(0, prefixLength).join("") + marker, truncated: true }
}
