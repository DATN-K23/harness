// Adapted from OpenCode packages/core/src/tool/registry.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { SleepPort, ToolCall, ToolDefinition, ToolExecutionResult, ToolRegistryPort } from "@harness/protocol"
import { normalizeFiles } from "../source/source-snapshot"
import { toolDefinitions } from "./definitions"
import { handleGlob, handleGrep, handleListDir, handleReadFile } from "./handlers"

export interface ToolRegistryOptions {
  /** Read-only fixture or snapshot-relative files map. */
  files: Readonly<Record<string, string>>
  /** Paths under these prefixes are refused as outside the allowed snapshot. */
  deniedPrefixes?: readonly string[]
  /** Optional sleep port for simulated delay. */
  sleep?: SleepPort
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })

export class ToolRegistry implements ToolRegistryPort {
  readonly calls: ToolCall[] = []
  private readonly files: ReadonlyMap<string, string>
  private readonly deniedPrefixes: readonly string[]
  private readonly sleep: SleepPort | undefined
  private readonly injectedFailures = new Map<string, { message: string; remaining: number }>()
  private readonly injectedThrows = new Map<string, { error: unknown; remaining: number }>()
  private readonly delays = new Map<string, number>()

  constructor(options: ToolRegistryOptions) {
    this.files = normalizeFiles(options.files)
    this.deniedPrefixes = options.deniedPrefixes ?? []
    this.sleep = options.sleep
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
    if (failed !== undefined) return failure(failed.message)

    const ctx = { files: this.files, deniedPrefixes: this.deniedPrefixes }

    switch (call.toolName) {
      case "read_file":
        return handleReadFile(call.arguments, ctx)
      case "grep":
        return handleGrep(call.arguments, ctx)
      case "glob":
        return handleGlob(call.arguments, ctx)
      case "list_dir":
        return handleListDir(call.arguments, ctx)
      default:
        return failure(
          `Unknown tool "${call.toolName}". Available tools: ${toolDefinitions.map((tool) => tool.name).join(", ")}. Call one of these.`,
        )
    }
  }

  private take<Entry extends { remaining: number }>(injected: Map<string, Entry>, toolName: string) {
    const entry = injected.get(toolName)
    if (entry === undefined) return undefined
    entry.remaining -= 1
    if (entry.remaining <= 0) injected.delete(toolName)
    return entry
  }
}
