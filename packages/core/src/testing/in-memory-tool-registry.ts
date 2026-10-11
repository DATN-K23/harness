import type { SleepPort, ToolCall, ToolDefinition, ToolExecutionResult, ToolRegistryPort } from "@harness/protocol"
import { checkSnapshotPath, comparePaths, globToRegExp, normalizeFiles, splitLines } from "./snapshot-files"

const definitions: readonly ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a file from the source snapshot, optionally a 1-based inclusive line range.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, startLine: { type: "integer" }, endLine: { type: "integer" } },
      required: ["path"],
    },
  },
  {
    name: "grep",
    description: "Search every snapshot file for a regular expression; returns path:line: text.",
    parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  },
  {
    name: "glob",
    description: "List snapshot files matching a glob pattern such as **/*.sol.",
    parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  },
  {
    name: "list_dir",
    description: "List the entries directly inside a snapshot directory (the root when no path is given).",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  },
]

export interface InMemoryToolRegistryOptions {
  /** Read-only fixture: snapshot-relative path to file content. */
  files: Readonly<Record<string, string>>
  /** Paths under these prefixes are refused as outside the allowed snapshot. */
  deniedPrefixes?: readonly string[]
  /** Needed only for `delayTool`; a FakeSleep with a clock turns the delay into simulated time. */
  sleep?: SleepPort
}

const failure = (content: string): ToolExecutionResult => ({ content, isError: true })

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value)

/**
 * Read-only tools (`read_file`, `grep`, `glob`, `list_dir`) over an in-memory file map. Failures resolve as
 * `isError` results like the real registry; `throwOn` makes `execute` reject so the caller's normalization of thrown
 * values can be tested. Failures, throws and delays are injected per tool name.
 */
export class InMemoryToolRegistry implements ToolRegistryPort {
  readonly calls: ToolCall[] = []
  private readonly files: ReadonlyMap<string, string>
  private readonly deniedPrefixes: readonly string[]
  private readonly sleep: SleepPort | undefined
  private readonly injectedFailures = new Map<string, { message: string; remaining: number }>()
  private readonly injectedThrows = new Map<string, { error: unknown; remaining: number }>()
  private readonly delays = new Map<string, number>()

  constructor(options: InMemoryToolRegistryOptions) {
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
    if (this.sleep === undefined) throw new Error("delayTool needs a sleep in the registry options")
    this.delays.set(toolName, ms)
  }

  definitions() {
    return definitions
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

    switch (call.toolName) {
      case "read_file":
        return this.readFile(call.arguments)
      case "grep":
        return this.grep(call.arguments)
      case "glob":
        return this.glob(call.arguments)
      case "list_dir":
        return this.listDir(call.arguments)
      default:
        return failure(
          `Unknown tool "${call.toolName}". Available tools: ${definitions.map((tool) => tool.name).join(", ")}. Call one of these.`,
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

  private invalid(toolName: string, problem: string, args: Record<string, unknown>, usage: string) {
    return failure(
      `Invalid arguments for ${toolName}: ${problem} (received ${JSON.stringify(args)}). Expected ${usage}.`,
    )
  }

  private resolve(path: string) {
    const checked = checkSnapshotPath(path, this.deniedPrefixes)
    if (checked.kind === "ok") return checked
    return failure(
      `Access denied: "${path}" is outside the allowed source snapshot (${checked.reason}). Use a relative path inside the snapshot, for example one listed by list_dir.`,
    )
  }

  private readFile(args: Record<string, unknown>): ToolExecutionResult {
    const usage = '{"path": string, "startLine"?: integer >= 1, "endLine"?: integer >= startLine}'
    const { path, startLine, endLine } = args
    if (typeof path !== "string" || path === "")
      return this.invalid("read_file", "path must be a non-empty string", args, usage)
    if (startLine !== undefined && (!isInteger(startLine) || startLine < 1))
      return this.invalid("read_file", "startLine must be an integer >= 1", args, usage)
    if (endLine !== undefined && (!isInteger(endLine) || endLine < 1))
      return this.invalid("read_file", "endLine must be an integer >= 1", args, usage)
    if (isInteger(startLine) && isInteger(endLine) && endLine < startLine)
      return this.invalid("read_file", "endLine must not be before startLine", args, usage)

    const resolved = this.resolve(path)
    if ("isError" in resolved) return resolved
    const content = this.files.get(resolved.path)
    if (content === undefined)
      return failure(`File not found: "${path}". Use list_dir or glob to find the correct path.`)

    const lines = splitLines(content)
    if (lines.length === 0) return { content: "", isError: false, filePath: resolved.path }
    const first = startLine ?? 1
    const last = Math.min(endLine ?? lines.length, lines.length)
    if (first > lines.length)
      return failure(
        `Line range ${first}-${endLine ?? first} is outside "${path}", which has ${lines.length} lines. Request lines 1-${lines.length}.`,
      )
    return {
      content: lines.slice(first - 1, last).join("\n"),
      isError: false,
      filePath: resolved.path,
      lineRange: [first, last],
    }
  }

  private grep(args: Record<string, unknown>): ToolExecutionResult {
    const usage = '{"pattern": string (regular expression)}'
    const { pattern } = args
    if (typeof pattern !== "string" || pattern === "")
      return this.invalid("grep", "pattern must be a non-empty string", args, usage)
    const matcher = this.compile(pattern)
    if (matcher === undefined)
      return failure(
        `Invalid regular expression "${pattern}" for grep. Escape special characters or simplify the pattern.`,
      )

    const matches = this.visiblePaths().flatMap((path) =>
      splitLines(this.files.get(path) ?? "").flatMap((line, index) =>
        matcher.test(line) ? [`${path}:${index + 1}: ${line}`] : [],
      ),
    )
    return { content: matches.length === 0 ? `No matches for "${pattern}".` : matches.join("\n"), isError: false }
  }

  private glob(args: Record<string, unknown>): ToolExecutionResult {
    const { pattern } = args
    if (typeof pattern !== "string" || pattern === "")
      return this.invalid(
        "glob",
        "pattern must be a non-empty string",
        args,
        '{"pattern": string, for example "**/*.sol"}',
      )
    const matcher = globToRegExp(pattern)
    const paths = this.visiblePaths().filter((path) => matcher.test(path))
    return { content: paths.length === 0 ? `No files match "${pattern}".` : paths.join("\n"), isError: false }
  }

  private listDir(args: Record<string, unknown>): ToolExecutionResult {
    const { path = "" } = args
    if (typeof path !== "string") return this.invalid("list_dir", "path must be a string", args, '{"path"?: string}')
    const resolved = this.resolve(path)
    if ("isError" in resolved) return resolved
    const prefix = resolved.path === "" ? "" : `${resolved.path}/`
    const entries = [
      ...new Set(
        this.visiblePaths()
          .filter((candidate) => candidate.startsWith(prefix))
          .map((candidate) => candidate.slice(prefix.length))
          .map((rest) => (rest.includes("/") ? `${rest.split("/")[0]}/` : rest)),
      ),
    ]
    if (entries.length === 0)
      return failure(`Directory not found: "${path}". Use list_dir with no path to see the root.`)
    return { content: entries.join("\n"), isError: false }
  }

  private visiblePaths() {
    return [...this.files.keys()]
      .filter((path) => checkSnapshotPath(path, this.deniedPrefixes).kind === "ok")
      .toSorted(comparePaths)
  }

  private compile(pattern: string) {
    try {
      return new RegExp(pattern)
    } catch {
      return undefined
    }
  }
}
