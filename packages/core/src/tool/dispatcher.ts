// Adapted from OpenCode packages/core/src/tool/dispatcher.ts @ 3f393d78bf (MIT License). See NOTICE.
import { ToolFailureKinds as ProtocolToolFailureKinds } from "@harness/protocol"
import type {
  ClockPort,
  ModelToolCall,
  StaleReason,
  ToolDefinition,
  ToolExecutionResult,
  ToolFailureKind as ProtocolToolFailureKind,
  ToolRegistryPort,
} from "@harness/protocol"
import { isAbsoluteLooking, normalizeBlockedInput, type EventSink } from "../runner/event-sink"

export const ToolFailureKinds = ProtocolToolFailureKinds

export type ToolFailureKind = ProtocolToolFailureKind

export const SecurityRuleIds = {
  absolutePath: "snapshot.absolute_path",
  pathTraversal: "snapshot.path_traversal",
  pathDenied: "snapshot.path_denied",
} as const

/**
 * Raw outcome of one call, before any security filtering or shaping (that is the step's job). `result.content` may
 * echo secrets or host paths from a tool or an error; only the step may persist or publish it, after the filter.
 */
export interface DispatchedCall {
  callIndex: number
  callId: string
  toolName: string
  arguments: Record<string, unknown>
  result: ToolExecutionResult
  durationMs: number
  /** Set for every `isError` result: why the call failed. Absent for a successful call. */
  failureKind?: ToolFailureKind
}

export type SettleResult = { kind: "continue" } | { kind: "stale"; reason: StaleReason }

export interface DispatchInput {
  calls: readonly ModelToolCall[]
  callIndexOffset?: number
  signal?: AbortSignal
  /**
   * Awaited once per call, in `callIndex` order, after the dispatcher persisted that call's `security.blocked` (if any)
   * and before the next call is settled. The dispatcher itself persists only `tool.requested` and `security.blocked`:
   * the step persists `tool.completed` and `tool.failed` here, after running the security filter on `result.content`
   * (a stored event cannot be redacted later), so every call's events stay in index order whichever finished first.
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
const MaxArgumentsChars = 500
const MaxThrownChars = 300
export const NextStepMarker = "Suggested next step:"
const NoPathArgument = "<no path argument>"

const bounded = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}...` : text)

/** Argument values as bounded JSON for a model-visible error message. */
export const describeArguments = (args: Record<string, unknown>) => {
  try {
    return bounded(JSON.stringify(args) ?? "{}", MaxArgumentsChars)
  } catch {
    return "[arguments cannot be displayed]"
  }
}

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
  `Access denied for ${toolName}: ${key} "${normalizeBlockedInput(input)}" is ${reason}, which is outside the allowed source snapshot. ${NextStepMarker} use a path relative to the snapshot root, for example one listed by list_dir.`

const nextStepFor = (kind: ToolFailureKind, call: IndexedCall, availableTools: string) => {
  if (kind === "unknown_tool") return `list the available tools (${availableTools}) and call one of them.`
  if (pathArgument(call.arguments) !== undefined)
    return "verify the path with list_dir or glob, then call the tool again with a path that exists in the snapshot."
  return "adjust the arguments and retry, or use a different tool."
}

/** Every failed result states what happened (the content), the argument values and what to do next. */
const withContract = (result: ToolExecutionResult, kind: ToolFailureKind, call: IndexedCall, availableTools: string) =>
  result.content.includes(NextStepMarker)
    ? result
    : {
        ...result,
        content: `${result.content}\nArguments: ${describeArguments(call.arguments)}\n${NextStepMarker} ${nextStepFor(kind, call, availableTools)}`,
      }

const missingFile = /\b(?:not found|enoent|no such file)\b/i

const failureOf = (message: string) => ({ content: message, isError: true }) satisfies ToolExecutionResult

const looksDenied = (content: string) => /^\s*access denied\b/i.test(content)

type Prepared =
  | { kind: "run"; call: IndexedCall }
  | {
      kind: "refused"
      call: IndexedCall
      failureKind: ToolFailureKind
      result: ToolExecutionResult
      block?: BlockedInput
    }

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

interface Normalized {
  result: ToolExecutionResult
  failureKind?: ToolFailureKind
  block?: BlockedInput
}

type Executed =
  | { kind: "result"; result: ToolExecutionResult; durationMs: number }
  | { kind: "thrown"; error: unknown; durationMs: number }

/**
 * Runs the tool calls of one model response deterministically. Call indexes follow response order; every
 * `tool.requested` is persisted in that order before anything executes; calls run under `Promise.allSettled` (or one
 * by one when parallel dispatch is off); results are settled in `callIndex` order whichever finished first. A thrown
 * value, a rejection, an unknown tool, invalid arguments, a denied path or an error result becomes a
 * `ToolExecutionResult` with `isError: true` that says what happened, the argument values and a
 * `Suggested next step:`. The dispatcher persists only `tool.requested` and `security.blocked` (normalized input);
 * `tool.completed` and `tool.failed` are the step's, written from `onResult` after the security filter ran. Tool
 * execution never throws; only event-store infrastructure faults propagate.
 */
export class ParallelToolDispatcher {
  constructor(private readonly options: ToolDispatcherOptions) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const { sink } = this.options
    const calls: IndexedCall[] = input.calls.map((call, index) => ({
      callIndex: (input.callIndexOffset ?? 0) + index,
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
    const availableTools = definitions.map((tool) => tool.name).join(", ")
    const prepared = calls.map((call) => this.prepare(call, definitions))
    const settled: DispatchedCall[] = []

    if (!this.options.enableParallelToolDispatch) {
      for (const item of prepared) {
        const stale = await this.settle(
          item,
          await this.execute(item, input.signal),
          settled,
          availableTools,
          input.onResult,
        )
        if (stale !== undefined) return { kind: "stale", reason: stale, calls: settled }
      }
      return { kind: "dispatched", calls: settled }
    }

    const outcomes = await Promise.allSettled(prepared.map((item) => this.execute(item, input.signal)))
    for (const [index, item] of prepared.entries()) {
      const outcome = outcomes[index]
      const executed: Executed | undefined =
        outcome.status === "fulfilled" ? outcome.value : { kind: "thrown", error: outcome.reason, durationMs: 0 }
      const stale = await this.settle(item, executed, settled, availableTools, input.onResult)
      if (stale !== undefined) return { kind: "stale", reason: stale, calls: settled }
    }
    return { kind: "dispatched", calls: settled }
  }

  private prepare(call: IndexedCall, definitions: readonly ToolDefinition[]): Prepared {
    const refuse = (failureKind: ToolFailureKind, message: string, block?: BlockedInput): Prepared => ({
      kind: "refused",
      call,
      failureKind,
      result: failureOf(message),
      block,
    })
    const definition = definitions.find((candidate) => candidate.name === call.toolName)
    if (definition === undefined) return refuse("unknown_tool", `Tool "${call.toolName}" does not exist.`)
    const problem = argumentProblem(definition, call.arguments)
    if (problem !== undefined)
      return refuse(
        "invalid_arguments",
        `Invalid arguments for ${call.toolName}: ${problem}. Expected: ${usageOf(definition)}.`,
      )
    const violation = pathViolation(call.arguments)
    if (violation !== undefined)
      return refuse("denied", deniedMessage(call.toolName, violation.key, violation.input, violation.reason), {
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

  private normalize(item: Prepared, executed: Executed): Normalized {
    const { call } = item
    if (item.kind === "refused") return { result: item.result, failureKind: item.failureKind, block: item.block }
    if (executed.kind === "thrown")
      return {
        failureKind: "thrown",
        result: failureOf(
          `Tool "${call.toolName}" failed with an unexpected error: ${describeThrown(executed.error)}. The tool did not complete.`,
        ),
      }
    const { result } = executed
    if (!isRecord(result) || typeof result.content !== "string" || typeof result.isError !== "boolean")
      return {
        failureKind: "malformed",
        result: failureOf(`Tool "${call.toolName}" returned a result the harness could not read.`),
      }
    if (!result.isError) return { result }
    if (looksDenied(result.content)) {
      const path = pathArgument(call.arguments)
      const block = { ruleId: SecurityRuleIds.pathDenied, input: path?.value ?? NoPathArgument }
      if (path === undefined) return { failureKind: "denied", result, block }
      return {
        failureKind: "denied",
        result: failureOf(deniedMessage(call.toolName, path.key, path.value, "not permitted")),
        block,
      }
    }
    const content =
      result.content.trim() === "" ? `Tool "${call.toolName}" reported an error without details.` : result.content
    const failureKind =
      pathArgument(call.arguments) !== undefined && missingFile.test(content) ? "missing_file" : "tool_error"
    return { failureKind, result: { ...result, content } }
  }

  /** Persists the call's `security.blocked` (if any), then lets the step persist its own. Returns a stale reason to stop. */
  private async settle(
    item: Prepared,
    executed: Executed,
    settled: DispatchedCall[],
    availableTools: string,
    onResult: DispatchInput["onResult"],
  ): Promise<StaleReason | undefined> {
    const { sink } = this.options
    const { call } = item
    const normalized = this.normalize(item, executed)
    const dispatched: DispatchedCall = {
      ...call,
      result:
        normalized.failureKind === undefined
          ? normalized.result
          : withContract(normalized.result, normalized.failureKind, call, availableTools),
      durationMs: executed.durationMs,
      ...(normalized.failureKind === undefined ? {} : { failureKind: normalized.failureKind }),
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
    settled.push(dispatched)
    const hook = await onResult?.(dispatched)
    return hook?.kind === "stale" ? hook.reason : undefined
  }
}
