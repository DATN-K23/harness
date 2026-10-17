// Adapted from OpenCode packages/core/src/tool/registry.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { SleepPort, SourceSnapshotPort, ToolCall, ToolDefinition, ToolExecutionResult, ToolRegistryPort } from "@harness/protocol"
import { normalizeFiles } from "../source/source-snapshot"
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
  /** Optional limits */
  maxReadLines?: number
  /** Max bytes for read_file */
  maxReadBytes?: number
  /** Max matches for grep */
  maxGrepMatches?: number
  /** Max entries for list_dir */
  maxListEntries?: number
  /** Max matches for glob */
  maxGlobMatches?: number
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })

export class ToolRegistry implements ToolRegistryPort {
  readonly calls: ToolCall[] = []
  private readonly files?: ReadonlyMap<string, string>
  private readonly snapshot?: SourceSnapshotPort
  private readonly snapshotId?: string
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
    this.deniedPrefixes = options.deniedPrefixes ?? []
    this.sleep = options.sleep
    this.secrets = options.secrets ?? []
  }

  /** The next `times` calls to `toolName` resolve as an error result with `message`. */
  failTool(toolName: string, message: string, times = 1) {
    this.injectedFailures.set(toolName, { message, remaining: times })
  }

  /** The next `times` calls to `toolName` reject with `error` (any value, as a real adapter bug might throw). */
  throwOn(toolName: string, error: unknown, times = 1) {
    this.injectedThrows.set(toolName, { error, remaining: times })
  }

  /** Every call to `toolName` first sleeps `ms` through the injected sleep. */
  delayTool(toolName: string, ms: number) {
    if (this.sleep === undefined) throw new Error("delayTool needs a sleep port on the registry")
    this.delays.set(toolName, ms)
  }

  definitions(): readonly ToolDefinition[] {
    return toolDefinitions
  }

  async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult> {
    this.calls.push(structuredClone(call))
    const delay = this.delays.get(call.toolName)
    if (delay !== undefined) await this.sleep?.sleep(delay, signal)
    if (signal?.aborted)
      return failure(`Tool ${call.toolName} was aborted before it finished. Retry the call if it is still needed.`)

    const thrown = this.take(this.injectedThrows, call.toolName)
    if (thrown !== undefined) throw thrown.error
    const failed = this.take(this.injectedFailures, call.toolName)
    if (failed !== undefined) return this.redactResult(failure(failed.message))

    const ctx = {
      files: this.files,
      snapshot: this.snapshot,
      snapshotId: this.snapshotId,
      deniedPrefixes: this.deniedPrefixes,
      maxLines: this.options.maxReadLines,
      maxBytes: this.options.maxReadBytes,
      maxMatches: this.options.maxGrepMatches ?? this.options.maxGlobMatches,
      maxEntries: this.options.maxListEntries,
    }

    try {
      let res: ToolExecutionResult
      switch (call.toolName) {
        case "read_file":
          res = await handleReadFile(call.arguments, ctx, signal)
          break
        case "grep":
          res = await handleGrep(call.arguments, ctx, signal)
          break
        case "glob":
          res = await handleGlob(call.arguments, ctx, signal)
          break
        case "list_dir":
          res = await handleListDir(call.arguments, ctx, signal)
          break
        default:
          res = failure(
            `Unknown tool "${call.toolName}". Available tools: ${toolDefinitions.map((tool) => tool.name).join(", ")}. Call one of these.`,
          )
          break
      }
      return this.redactResult(res)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return this.redactResult(failure(`Tool execution failed unexpectedly: ${message}`))
    }
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
