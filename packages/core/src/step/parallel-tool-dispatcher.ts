import type {
  ClockPort,
  ModelToolCall,
  StaleReason,
  ToolDefinition,
  ToolExecutionResult,
  ToolRegistryPort,
} from "@harness/protocol"
import { isAbsoluteLooking, normalizeBlockedInput, type EventSink } from "../runner/event-sink"

export const ToolFailureKinds = [
  "unknown_tool",
  "invalid_arguments",
  "denied_path",
  "thrown",
  "malformed_result",
  "tool_error",
] as const

export type ToolFailureKind = (typeof ToolFailureKinds)[number]

export const SecurityRuleIds = {
  absolutePath: "snapshot.absolute_path",
  pathTraversal: "snapshot.path_traversal",
  pathDenied: "snapshot.path_denied",
} as const

/** Raw outcome of one call, before any security filtering or shaping (that is the step's job). */
export interface DispatchedCall {
  callIndex: number
  callId: string
  toolName: string
  arguments: Record<string, unknown>
  result: ToolExecutionResult
  durationMs: number
  /** Set when `result` was produced or rewritten by the dispatcher's normalization of a failure. */
  failure?: ToolFailureKind
}

export type SettleResult = { kind: "continue" } | { kind: "stale"; reason: StaleReason }

export interface DispatchInput {
  calls: readonly ModelToolCall[]
  signal?: AbortSignal
  /**
   * Awaited once per call, in `callIndex` order, after the dispatcher persisted that call's own failure events and
   * before the next call is settled. The step persists `tool.completed` here (it owns filtering, shaping and the item
   * id), so every call's events stay in index order whichever call finished first.
   */
  onResult?: (call: DispatchedCall) => Promise<SettleResult>
}

export type DispatchOutcome =
  /** Every call ran and was settled. */
  | { kind: "dispatched"; calls: DispatchedCall[] }
  /** A write was refused (claim lost, state changed); the caller stops. `calls` holds what was settled before. */
  | { kind: "stale"; reason: StaleReason; calls: DispatchedCall[] }

export interface ToolDispatcherOptions {
  registry: ToolRegistryPort
  sink: EventSink
  clock: ClockPort
  /** Off runs the same calls one at a time in index order with identical events. */
  enableParallelToolDispatch: boolean
}

const PathArgumentKeys = ["path", "filePath", "file", "directory", "dir"] as const
const MaxArgumentsChars = 400
const MaxThrownChars = 300
const MaxEventMessageChars = 2000

const bounded = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}...` : text)

const describeArguments = (args: Record<string, unknown>) => bounded(JSON.stringify(args) ?? "{}", MaxArgumentsChars)

const describeThrown = (value: unknown) => {
  const text = (() => {
    if (value instanceof Error) return `${value.name}: ${value.message}`
    if (typeof value === "string") return value
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      return "a value that cannot be displayed"
    }
  })()
  return bounded(text, MaxThrownChars)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const matchesType = (type: unknown, value: unknown) => {
  if (type === "string") return typeof value === "string"
  if (type === "integer") return typeof value === "number" && Number.isInteger(value)
  if (type === "number") return typeof value === "number" && Number.isFinite(value)
  if (type === "boolean") return typeof value === "boolean"
  if (type === "array") return Array.isArray(value)
  if (type === "object") return isRecord(value)
  if (type === "null") return value === null
  return true
}

/** Checks the JSON Schema subset tool definitions use: required keys, property types, `additionalProperties: false`. */
const argumentProblem = (definition: ToolDefinition, args: Record<string, unknown>) => {
  const { properties, required, additionalProperties } = definition.parameters
  const known = isRecord(properties) ? properties : {}
  const missing = (Array.isArray(required) ? required : []).filter(
    (key): key is string => typeof key === "string" && args[key] === undefined,
  )
  if (missing.length > 0)
    return `missing required ${missing.length === 1 ? "argument" : "arguments"} ${missing.map((key) => `"${key}"`).join(", ")}`
  const wrongType = Object.entries(args).find(([key, value]) => {
    const property = known[key]
    return isRecord(property) && !matchesType(property.type, value)
  })
  if (wrongType !== undefined) {
    const property = known[wrongType[0]]
    const expected = isRecord(property) ? String(property.type) : "a different type"
    return `argument "${wrongType[0]}" must be of type ${expected}`
  }
  if (additionalProperties === false) {
    const extra = Object.keys(args).filter((key) => !(key in known))
    if (extra.length > 0)
      return `unexpected ${extra.length === 1 ? "argument" : "arguments"} ${extra.map((key) => `"${key}"`).join(", ")}`
  }
  return undefined
}

const usageOf = (definition: ToolDefinition) => {
  const { properties, required } = definition.parameters
  const entries = isRecord(properties) ? Object.entries(properties) : []
  const requiredKeys = Array.isArray(required) ? required : []
  if (entries.length === 0) return "no arguments"
  return entries
    .map(
      ([key, property]) =>
        `${key} (${isRecord(property) ? String(property.type) : "any"}${requiredKeys.includes(key) ? ", required" : ""})`,
    )
    .join(", ")
}

/** The first path-like argument the model supplied, as `{key, value}`. */
const pathArgument = (args: Record<string, unknown>) => {
  const key = PathArgumentKeys.find((candidate) => typeof args[candidate] === "string")
  return key === undefined ? undefined : { key, value: String(args[key]) }
}

const pathViolation = (args: Record<string, unknown>) => {
  const path = pathArgument(args)
  if (path === undefined) return undefined
  if (isAbsoluteLooking(path.value))
    return { key: path.key, input: path.value, ruleId: SecurityRuleIds.absolutePath, reason: "an absolute host path" }
  const segments = path.value.replaceAll("\\", "/").split("/")
  if (segments.includes(".."))
    return {
      key: path.key,
      input: path.value,
      ruleId: SecurityRuleIds.pathTraversal,
      reason: "a path that leaves the snapshot",
    }
  return undefined
}

const deniedMessage = (toolName: string, key: string, input: string, reason: string) =>
  `Access denied for ${toolName}: ${key} "${normalizeBlockedInput(input)}" is ${reason}, which is outside the allowed source snapshot. Use a path relative to the snapshot root, for example one listed by list_dir.`

const failureOf = (message: string) => ({ content: message, isError: true }) satisfies ToolExecutionResult

const looksDenied = (content: string) => /^\s*access denied\b/i.test(content)

type Prepared =
  | { kind: "run"; call: IndexedCall }
  | { kind: "refused"; call: IndexedCall; failure: ToolFailureKind; result: ToolExecutionResult; block?: BlockedInput }

interface BlockedInput {
  ruleId: string
  input: string
}

interface IndexedCall {
  callIndex: number
  callId: string
  toolName: string
  arguments: Record<string, unknown>
}

type Executed =
  | { kind: "result"; result: ToolExecutionResult; durationMs: number }
  | { kind: "thrown"; error: unknown; durationMs: number }

/**
 * Runs the tool calls of one model response deterministically. Call indexes follow response order; every
 * `tool.requested` is persisted in that order before anything executes; calls run under `Promise.allSettled` (or one
 * by one when parallel dispatch is off); results are settled in `callIndex` order whichever finished first. A thrown
 * value, a rejection, an unknown tool, invalid arguments, a denied path or an error result becomes a
 * `ToolExecutionResult` with `isError: true` that says what happened, the relevant argument values and what to do
 * next. Tool execution never throws; only event-store infrastructure faults propagate.
 */
export class ParallelToolDispatcher {
  constructor(private readonly options: ToolDispatcherOptions) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const { sink } = this.options
    const calls: IndexedCall[] = input.calls.map((call, callIndex) => ({
      callIndex,
      callId: call.id,
      toolName: call.name,
      arguments: call.arguments,
    }))

    for (const call of calls) {
      const requested = await sink.append("tool.requested", {
        callIndex: call.callIndex,
        callId: call.callId,
        toolName: call.toolName,
        arguments: call.arguments,
      })
      if (requested.kind === "stale") return { kind: "stale", reason: requested.reason, calls: [] }
    }

    const definitions = this.options.registry.definitions()
    const prepared = calls.map((call) => this.prepare(call, definitions))
    const settled: DispatchedCall[] = []

    if (!this.options.enableParallelToolDispatch) {
      for (const item of prepared) {
        const stale = await this.settle(item, await this.execute(item, input.signal), settled, input.onResult)
        if (stale !== undefined) return { kind: "stale", reason: stale, calls: settled }
      }
      return { kind: "dispatched", calls: settled }
    }

    const outcomes = await Promise.allSettled(prepared.map((item) => this.execute(item, input.signal)))
    for (const [index, item] of prepared.entries()) {
      const outcome = outcomes[index]
      const executed: Executed | undefined =
        outcome.status === "fulfilled" ? outcome.value : { kind: "thrown", error: outcome.reason, durationMs: 0 }
      const stale = await this.settle(item, executed, settled, input.onResult)
      if (stale !== undefined) return { kind: "stale", reason: stale, calls: settled }
    }
    return { kind: "dispatched", calls: settled }
  }

  private prepare(call: IndexedCall, definitions: readonly ToolDefinition[]): Prepared {
    const refuse = (failure: ToolFailureKind, message: string, block?: BlockedInput): Prepared => ({
      kind: "refused",
      call,
      failure,
      result: failureOf(message),
      block,
    })
    const definition = definitions.find((candidate) => candidate.name === call.toolName)
    if (definition === undefined)
      return refuse(
        "unknown_tool",
        `Tool "${call.toolName}" does not exist. Arguments: ${describeArguments(call.arguments)}. Available tools: ${definitions.map((tool) => tool.name).join(", ")}. Call one of the available tools instead.`,
      )
    const problem = argumentProblem(definition, call.arguments)
    if (problem !== undefined)
      return refuse(
        "invalid_arguments",
        `Invalid arguments for ${call.toolName}: ${problem}. Arguments: ${describeArguments(call.arguments)}. Expected: ${usageOf(definition)}. Correct the arguments and call ${call.toolName} again.`,
      )
    const violation = pathViolation(call.arguments)
    if (violation !== undefined)
      return refuse("denied_path", deniedMessage(call.toolName, violation.key, violation.input, violation.reason), {
        ruleId: violation.ruleId,
        input: violation.input,
      })
    return { kind: "run", call }
  }

  private async execute(item: Prepared, signal?: AbortSignal): Promise<Executed> {
    if (item.kind === "refused") return { kind: "result", result: item.result, durationMs: 0 }
    const { clock, registry, sink } = this.options
    const start = clock.nowMs()
    try {
      const result = await registry.execute(
        { runId: sink.runId, callId: item.call.callId, toolName: item.call.toolName, arguments: item.call.arguments },
        signal,
      )
      return { kind: "result", result, durationMs: Math.max(0, clock.nowMs() - start) }
    } catch (error) {
      return { kind: "thrown", error, durationMs: Math.max(0, clock.nowMs() - start) }
    }
  }

  private normalize(item: Prepared, executed: Executed) {
    const { call } = item
    if (item.kind === "refused") return { result: item.result, failure: item.failure, block: item.block }
    if (executed.kind === "thrown")
      return {
        failure: "thrown" as const,
        result: failureOf(
          `Tool "${call.toolName}" failed with an unexpected error: ${describeThrown(executed.error)}. Arguments: ${describeArguments(call.arguments)}. The tool did not complete; retry with corrected arguments or use a different tool.`,
        ),
      }
    const { result } = executed
    if (!isRecord(result) || typeof result.content !== "string" || typeof result.isError !== "boolean")
      return {
        failure: "malformed_result" as const,
        result: failureOf(
          `Tool "${call.toolName}" returned a result the harness could not read. Arguments: ${describeArguments(call.arguments)}. Retry the call or use a different tool.`,
        ),
      }
    if (!result.isError) return { result, failure: undefined }
    if (looksDenied(result.content)) {
      const path = pathArgument(call.arguments)
      const input = path?.value ?? ""
      return {
        failure: "denied_path" as const,
        result: failureOf(deniedMessage(call.toolName, path?.key ?? "path", input, "not permitted")),
        block: { ruleId: SecurityRuleIds.pathDenied, input },
      }
    }
    const content =
      result.content.trim() === ""
        ? `Tool "${call.toolName}" reported an error without details. Arguments: ${describeArguments(call.arguments)}. Retry with different arguments or use another tool.`
        : result.content
    return { failure: "tool_error" as const, result: { ...result, content } }
  }

  /** Persists the call's failure events, then lets the step persist its own. Returns a stale reason to stop. */
  private async settle(
    item: Prepared,
    executed: Executed,
    settled: DispatchedCall[],
    onResult: DispatchInput["onResult"],
  ): Promise<StaleReason | undefined> {
    const { sink } = this.options
    const { call } = item
    const normalized = this.normalize(item, executed)
    const dispatched: DispatchedCall = {
      ...call,
      result: normalized.result,
      durationMs: executed.durationMs,
      ...(normalized.failure === undefined ? {} : { failure: normalized.failure }),
    }

    if (normalized.block !== undefined) {
      const blocked = await sink.append("security.blocked", {
        ruleId: normalized.block.ruleId,
        input: normalized.block.input,
        toolName: call.toolName,
        callId: call.callId,
      })
      if (blocked.kind === "stale") return blocked.reason
    }
    if (normalized.failure !== undefined) {
      const failed = await sink.append("tool.failed", {
        callIndex: call.callIndex,
        callId: call.callId,
        toolName: call.toolName,
        durationMs: executed.durationMs,
        message: bounded(normalized.result.content, MaxEventMessageChars),
      })
      if (failed.kind === "stale") return failed.reason
    }
    settled.push(dispatched)
    const hook = await onResult?.(dispatched)
    return hook?.kind === "stale" ? hook.reason : undefined
  }
}
