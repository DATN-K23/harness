// Adapted from OpenCode packages/core/src/tool/registry.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { SleepPort, SourceSnapshotPort, ToolCall, ToolDefinition, ToolExecutionResult, ToolRegistryPort } from "@harness/protocol"
import { InvalidSnapshotIdError, SnapshotIntegrityError } from "../source/snapshot-errors"
import { checkSnapshotPath, DEFAULT_DENIED_PREFIXES, normalizeFiles } from "../source/source-snapshot"
import {
  DEFAULT_MAX_GLOB_MATCHES,
  DEFAULT_MAX_LIST_ENTRIES,
  DEFAULT_MAX_READ_BYTES,
  DEFAULT_MAX_READ_LINES,
  DEFAULT_MAX_GREP_LINE_CHARS,
  DEFAULT_MAX_GREP_MATCHES,
  DEFAULT_MAX_GREP_SCAN_BYTES,
  DEFAULT_GREP_TIMEOUT_MS,
} from "./handlers"
import { toolDefinitions } from "./definitions"
import { handleGlob, handleGrep, handleListDir, handleReadFile } from "./handlers"

export interface ToolRegistryOptions {
  /** Read-only fixture or snapshot-relative files map. */
  files?: Readonly<Record<string, string>>
  /** Backed by SourceSnapshotPort (e.g. DiskSourceSnapshot or InMemorySnapshot). */
  snapshot?: SourceSnapshotPort
  /** Identifier of the target snapshot when using SourceSnapshotPort. */
  snapshotId?: string
  /** Paths under these prefixes are refused as outside the allowed snapshot. */
  deniedPrefixes?: readonly string[]
  /** Optional sleep port for simulated delay. */
  sleep?: SleepPort
  /** Optional secret strings to redact from tool output before returning. */
  secrets?: readonly string[]
  /** Maximum lines returned by read_file. */
  maxReadLines?: number
  /** Maximum UTF-8 bytes returned by read_file. */
  maxReadBytes?: number
  /** Maximum matches returned by grep. */
  maxGrepMatches?: number
  /** Maximum entries returned by list_dir. */
  maxListEntries?: number
  /** Maximum matches returned by glob. */
  maxGlobMatches?: number
  /** Hard wall-clock limit for grep worker execution. */
  grepTimeoutMs?: number
  /** Maximum source bytes scanned by grep. */
  maxGrepScanBytes?: number
  /** Maximum source characters returned for each grep match. */
  maxGrepLineChars?: number
}

export interface EffectiveToolLimits {
  readFile: { maxLines: number; maxBytes: number }
  grep: { timeoutMs: number; maxScanBytes: number; maxLineChars: number; maxMatches: number }
  glob: { maxMatches: number }
  listDir: { maxEntries: number }
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })
const internalToolError = "Tool execution failed (internal error). Retry or use a different path."

export class ToolRegistry implements ToolRegistryPort {
  readonly calls: ToolCall[] = []
  readonly snapshotId: string | undefined
  private readonly files?: ReadonlyMap<string, string>
  private readonly snapshot?: SourceSnapshotPort
  private readonly deniedPrefixes: readonly string[]
  private readonly sleep: SleepPort | undefined
  private readonly secrets: readonly string[]
  private readonly options: ToolRegistryOptions
  private readonly injectedFailures = new Map<string, { message: string; remaining: number }>()
  private readonly injectedThrows = new Map<string, { error: unknown; remaining: number }>()
  private readonly delays = new Map<string, number>()

  constructor(options: ToolRegistryOptions) {
    this.options = options
    this.files = options.files !== undefined ? normalizeFiles(options.files) : undefined
    this.snapshot = options.snapshot
    this.snapshotId = options.snapshotId
    this.deniedPrefixes = [...new Set([...DEFAULT_DENIED_PREFIXES, ...(options.deniedPrefixes ?? [])])]
    this.sleep = options.sleep
    this.secrets = options.secrets ?? []
  }

  /** The next calls to toolName resolve as an error result with message. */
  failTool(toolName: string, message: string, times = 1) {
    this.injectedFailures.set(toolName, { message, remaining: times })
  }

  /** The next calls to toolName throw internally to exercise catch-all normalization. */
  throwOn(toolName: string, error: unknown, times = 1) {
    this.injectedThrows.set(toolName, { error, remaining: times })
  }

  /** Every call to toolName first sleeps ms through the injected sleep. */
  delayTool(toolName: string, ms: number) {
    if (this.sleep === undefined) throw new Error("delayTool needs a sleep port on the registry")
    this.delays.set(toolName, ms)
  }

  definitions(): readonly ToolDefinition[] {
    return toolDefinitions
  }

  limits(): EffectiveToolLimits {
    return {
      readFile: {
        maxLines: this.options.maxReadLines ?? DEFAULT_MAX_READ_LINES,
        maxBytes: this.options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
      },
      grep: {
        timeoutMs: this.options.grepTimeoutMs ?? DEFAULT_GREP_TIMEOUT_MS,
        maxScanBytes: this.options.maxGrepScanBytes ?? DEFAULT_MAX_GREP_SCAN_BYTES,
        maxLineChars: this.options.maxGrepLineChars ?? DEFAULT_MAX_GREP_LINE_CHARS,
        maxMatches: this.options.maxGrepMatches ?? DEFAULT_MAX_GREP_MATCHES,
      },
      glob: {
        maxMatches: this.options.maxGlobMatches ?? DEFAULT_MAX_GLOB_MATCHES,
      },
      listDir: {
        maxEntries: this.options.maxListEntries ?? DEFAULT_MAX_LIST_ENTRIES,
      },
    }
  }

  async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult> {
    this.calls.push(structuredClone(call))

    try {
      const delay = this.delays.get(call.toolName)
      if (delay !== undefined) await this.sleep?.sleep(delay, signal)
      if (signal?.aborted)
        return failure("Tool " + call.toolName + " was aborted before it finished. Retry the call if it is still needed.")

      const thrown = this.take(this.injectedThrows, call.toolName)
      if (thrown !== undefined) throw thrown.error
      const failed = this.take(this.injectedFailures, call.toolName)
      if (failed !== undefined) return this.redactResult(failure(failed.message))

      const limits = this.limits()
      const ctx = {
        files: this.files,
        snapshot: this.snapshot,
        snapshotId: this.snapshotId,
        deniedPrefixes: this.deniedPrefixes,
        maxLines: limits.readFile.maxLines,
        maxBytes: limits.readFile.maxBytes,
        maxGrepMatches: limits.grep.maxMatches,
        grepTimeoutMs: limits.grep.timeoutMs,
        maxGrepScanBytes: limits.grep.maxScanBytes,
        maxGrepLineChars: limits.grep.maxLineChars,
        maxGlobMatches: limits.glob.maxMatches,
        maxListEntries: limits.listDir.maxEntries,
      }

      let res: ToolExecutionResult
      switch (call.toolName) {
        case "read_file":
          res = await handleReadFile(call.arguments, ctx, signal)
          break
        case "grep":
          res = await handleGrep(
            call.arguments,
            {
              ...ctx,
              maxMatches: ctx.maxGrepMatches,
              timeoutMs: ctx.grepTimeoutMs,
              maxScanBytes: ctx.maxGrepScanBytes,
              maxLineChars: ctx.maxGrepLineChars,
            },
            signal,
          )
          break
        case "glob":
          res = await handleGlob(call.arguments, { ...ctx, maxMatches: ctx.maxGlobMatches }, signal)
          break
        case "list_dir":
          res = await handleListDir(call.arguments, { ...ctx, maxEntries: ctx.maxListEntries }, signal)
          break
        default:
          res = failure(
            'Unknown tool "' + call.toolName + '". Available tools: ' +
              toolDefinitions.map((tool) => tool.name).join(", ") + ". Call one of these.",
          )
          break
      }
      return this.redactResult(res)
    } catch (error: unknown) {
      return this.redactResult(failure(this.mapError(error)))
    }
  }

  private mapError(error: unknown): string {
    if (error instanceof InvalidSnapshotIdError) {
      const id = safeSnapshotId(error.snapshotId)
      return id === undefined ? "Invalid snapshot ID." : 'Invalid snapshot ID "' + id + '".'
    }
    if (error instanceof SnapshotIntegrityError) {
      if (error.relativePath === undefined) return "Snapshot integrity check failed."
      const checked = checkSnapshotPath(error.relativePath)
      return checked.kind === "ok"
        ? 'Snapshot integrity check failed for "' + checked.path + '".'
        : "Snapshot integrity check failed."
    }
    if (error instanceof Error && error.message.startsWith("Snapshot not found")) {
      const id = safeSnapshotId(this.snapshotId)
      return id === undefined ? "Snapshot not found." : 'Snapshot "' + id + '" not found.'
    }
    return internalToolError
  }

  private redactResult(result: ToolExecutionResult): ToolExecutionResult {
    if (this.secrets.length === 0) return result
    let content = result.content
    for (const secret of this.secrets) {
      if (secret && content.includes(secret)) {
        content = content.replaceAll(secret, "[REDACTED]")
      }
    }
    return { ...result, content }
  }

  private take<Entry extends { remaining: number }>(injected: Map<string, Entry>, toolName: string) {
    const entry = injected.get(toolName)
    if (entry === undefined) return undefined
    entry.remaining -= 1
    if (entry.remaining <= 0) injected.delete(toolName)
    return entry
  }
}

function safeSnapshotId(snapshotId: string | undefined): string | undefined {
  return snapshotId !== undefined && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(snapshotId) ? snapshotId : undefined
}
