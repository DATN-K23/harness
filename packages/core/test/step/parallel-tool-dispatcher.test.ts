import { describe, expect, test } from "bun:test"
import {
  AbsolutePathRedactedPlaceholder,
  type ModelToolCall,
  type RunStorePort,
  type ToolCall,
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolRegistryPort,
  type TrajectoryEvent,
} from "@harness/protocol"
import { EventBus } from "../../src/runner/event-bus"
import { EventSink } from "../../src/runner/event-sink"
import {
  ParallelToolDispatcher,
  SecurityRuleIds,
  type DispatchedCall,
  type DispatchOutcome,
} from "../../src/step/parallel-tool-dispatcher"
import { FakeClock, SeededRandom } from "../../src/testing/deterministic"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { InMemoryToolRegistry } from "../../src/testing/in-memory-tool-registry"
import { createIdGenerator } from "../../src/util/id"

const files = {
  "src/Vault.sol": "contract Vault {\n  function withdraw() external {}\n}\n",
  "secrets/key.txt": "hunter2\n",
}

const harness = async (options: { leaseMs?: number } = {}) => {
  const clock = new FakeClock(Date.parse("2026-03-01T00:00:00.000Z"))
  const random = new SeededRandom(11)
  const store = new InMemoryRunStore({ clock, leaseMs: options.leaseMs ?? 1_000_000 })
  store.seedRun("run-1", "queued")
  const claimed = await store.claim({ runId: "run-1", workerId: "worker-a" })
  if (claimed.kind !== "claimed") throw new Error("expected a claim")
  const bus = new EventBus()
  const published: TrajectoryEvent[] = []
  bus.subscribe((event) => published.push(event))
  const sink = new EventSink({
    store,
    claim: claimed.claim,
    expectedStateVersion: claimed.stateVersion,
    ids: createIdGenerator({ clock: () => clock.nowMs(), random: (size) => random.bytes(size) }),
    clock,
    bus,
  })
  return { clock, store, sink, published, claim: claimed.claim }
}

const events = (store: RunStorePort) => store.loadEvents({ runId: "run-1" })

const call = (id: string, name: string, args: Record<string, unknown> = {}): ModelToolCall => ({
  id,
  name,
  arguments: args,
})

const echoDefinition: ToolDefinition = {
  name: "echo",
  description: "echo",
  parameters: {
    type: "object",
    properties: { text: { type: "string" }, times: { type: "integer" } },
    required: ["text"],
    additionalProperties: false,
  },
}

type Handler = (call: ToolCall) => Promise<ToolExecutionResult>

/** Registry whose handlers the test controls; records when each call started. */
class ControlledRegistry implements ToolRegistryPort {
  readonly started: string[] = []
  readonly startedEventCounts: number[] = []

  constructor(
    private readonly handlers: Record<string, Handler>,
    private readonly store?: RunStorePort,
  ) {}

  definitions(): readonly ToolDefinition[] {
    return [echoDefinition, ...Object.keys(this.handlers).map((name) => ({ ...echoDefinition, name }))].filter(
      (definition, index, all) => all.findIndex((other) => other.name === definition.name) === index,
    )
  }

  execute(toolCall: ToolCall) {
    this.started.push(toolCall.callId)
    void this.store?.loadEvents({ runId: toolCall.runId }).then((stored) => this.startedEventCounts.push(stored.length))
    const handler = this.handlers[toolCall.toolName]
    if (handler === undefined) return Promise.resolve({ content: "no handler", isError: true })
    return handler(toolCall)
  }
}

const ok = (content: string): ToolExecutionResult => ({ content, isError: false })

const deferred = () => {
  let resolve: (value: ToolExecutionResult) => void = () => undefined
  const promise = new Promise<ToolExecutionResult>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const eventSummary = (stored: TrajectoryEvent[]) => stored.map((event) => `${event.type}`)

const completedHook = (sink: EventSink) => async (dispatched: DispatchedCall) => {
  if (dispatched.result.isError) return { kind: "continue" as const }
  const appended = await sink.append("tool.completed", {
    callIndex: dispatched.callIndex,
    callId: dispatched.callId,
    toolName: dispatched.toolName,
    durationMs: dispatched.durationMs,
    isTruncated: false,
    itemId: `item-${dispatched.callIndex}`,
  })
  return appended.kind === "stale" ? appended : { kind: "continue" as const }
}

const dispatched = (outcome: DispatchOutcome) => {
  if (outcome.kind !== "dispatched") throw new Error(`expected dispatched, got ${outcome.kind}`)
  return outcome.calls
}

describe("deterministic ordering", () => {
  const slowFirst = (store: RunStorePort) => {
    const gates = [deferred(), deferred(), deferred()]
    const registry = new ControlledRegistry(
      {
        echo: (toolCall) => gates[Number(toolCall.callId.slice(-1))].promise,
      },
      store,
    )
    return { gates, registry }
  }

  test("out-of-order completion still yields results and events in call order 0, 1, 2", async () => {
    const { store, sink, clock } = await harness()
    const { gates, registry } = slowFirst(store)
    const dispatcher = new ParallelToolDispatcher({ registry, sink, clock, enableParallelToolDispatch: true })

    const pending = dispatcher.dispatch({
      calls: [
        call("c-0", "echo", { text: "a" }),
        call("c-1", "echo", { text: "b" }),
        call("c-2", "echo", { text: "c" }),
      ],
      onResult: completedHook(sink),
    })
    await Bun.sleep(0)
    expect(registry.started).toEqual(["c-0", "c-1", "c-2"])
    gates[2].resolve(ok("third finished first"))
    await Bun.sleep(0)
    gates[0].resolve(ok("first"))
    gates[1].resolve(ok("second"))

    const calls = dispatched(await pending)
    expect(calls.map((entry) => entry.callIndex)).toEqual([0, 1, 2])
    expect(calls.map((entry) => entry.result.content)).toEqual(["first", "second", "third finished first"])
    const stored = await events(store)
    expect(eventSummary(stored)).toEqual([
      "tool.requested",
      "tool.requested",
      "tool.requested",
      "tool.completed",
      "tool.completed",
      "tool.completed",
    ])
    expect(stored.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(stored.slice(0, 3).map((event) => event.payload.callIndex)).toEqual([0, 1, 2])
    expect(stored.slice(3).map((event) => event.payload.callIndex)).toEqual([0, 1, 2])
  })

  test("every tool.requested is persisted before the first tool executes", async () => {
    const { store, sink, clock } = await harness()
    const registry = new ControlledRegistry({ echo: async () => ok("done") }, store)
    const dispatcher = new ParallelToolDispatcher({ registry, sink, clock, enableParallelToolDispatch: true })
    await dispatcher.dispatch({
      calls: [call("c-0", "echo", { text: "a" }), call("c-1", "echo", { text: "b" })],
    })
    await Bun.sleep(0)
    expect(registry.startedEventCounts).toEqual([2, 2])
  })

  test("with parallel dispatch on all calls are in flight together", async () => {
    const { store, sink, clock } = await harness()
    const { gates, registry } = slowFirst(store)
    const dispatcher = new ParallelToolDispatcher({ registry, sink, clock, enableParallelToolDispatch: true })
    const pending = dispatcher.dispatch({
      calls: [
        call("c-0", "echo", { text: "a" }),
        call("c-1", "echo", { text: "b" }),
        call("c-2", "echo", { text: "c" }),
      ],
    })
    await Bun.sleep(0)
    expect(registry.started).toEqual(["c-0", "c-1", "c-2"])
    gates.forEach((gate) => gate.resolve(ok("x")))
    await pending
  })

  test("with parallel dispatch off the next call starts only after the previous one finished, in index order", async () => {
    const { store, sink, clock } = await harness()
    const { gates, registry } = slowFirst(store)
    const dispatcher = new ParallelToolDispatcher({ registry, sink, clock, enableParallelToolDispatch: false })
    const pending = dispatcher.dispatch({
      calls: [
        call("c-0", "echo", { text: "a" }),
        call("c-1", "echo", { text: "b" }),
        call("c-2", "echo", { text: "c" }),
      ],
      onResult: completedHook(sink),
    })
    await Bun.sleep(0)
    expect(registry.started).toEqual(["c-0"])
    gates[0].resolve(ok("first"))
    await Bun.sleep(0)
    expect(registry.started).toEqual(["c-0", "c-1"])
    gates[1].resolve(ok("second"))
    await Bun.sleep(0)
    expect(registry.started).toEqual(["c-0", "c-1", "c-2"])
    gates[2].resolve(ok("third"))
    expect(dispatched(await pending).map((entry) => entry.result.content)).toEqual(["first", "second", "third"])
    expect(eventSummary(await events(store))).toEqual([
      "tool.requested",
      "tool.requested",
      "tool.requested",
      "tool.completed",
      "tool.completed",
      "tool.completed",
    ])
  })

  test("a failing call between successes keeps all of its events in its own index slot", async () => {
    const { store, sink, clock } = await harness()
    const registry = new ControlledRegistry({
      echo: async (toolCall) => (toolCall.callId === "c-1" ? { content: "disk on fire", isError: true } : ok("fine")),
    })
    const dispatcher = new ParallelToolDispatcher({ registry, sink, clock, enableParallelToolDispatch: true })
    await dispatcher.dispatch({
      calls: [
        call("c-0", "echo", { text: "a" }),
        call("c-1", "echo", { text: "b" }),
        call("c-2", "echo", { text: "c" }),
      ],
      onResult: completedHook(sink),
    })
    const stored = await events(store)
    expect(stored.slice(3).map((event) => [event.type, event.payload.callIndex])).toEqual([
      ["tool.completed", 0],
      ["tool.failed", 1],
      ["tool.completed", 2],
    ])
  })

  test("no calls dispatches nothing", async () => {
    const { store, sink, clock } = await harness()
    const dispatcher = new ParallelToolDispatcher({
      registry: new InMemoryToolRegistry({ files }),
      sink,
      clock,
      enableParallelToolDispatch: true,
    })
    expect(await dispatcher.dispatch({ calls: [] })).toEqual({ kind: "dispatched", calls: [] })
    expect(await events(store)).toEqual([])
  })
})

describe("parallel and sequential agree", () => {
  const script: ModelToolCall[] = [
    call("c-0", "read_file", { path: "src/Vault.sol" }),
    call("c-1", "read_file", { path: "src/Missing.sol" }),
    call("c-2", "grep", { pattern: "withdraw" }),
    call("c-3", "no_such_tool", { x: 1 }),
    call("c-4", "read_file", { path: "../outside.txt" }),
    call("c-5", "read_file", { path: "secrets/key.txt" }),
    call("c-6", "glob", { pattern: "**/*.sol" }),
    call("c-7", "boom", {}),
    call("c-8", "read_file", { path: 12 }),
  ]

  const runScript = async (enableParallelToolDispatch: boolean) => {
    const { store, sink, clock, published } = await harness()
    const inner = new InMemoryToolRegistry({ files, deniedPrefixes: ["secrets"] })
    const registry: ToolRegistryPort = {
      definitions: () => [
        ...inner.definitions(),
        { name: "boom", description: "always throws", parameters: { type: "object" } },
      ],
      execute: async (toolCall) => {
        if (toolCall.toolName === "boom") throw new RangeError("boom exploded")
        return inner.execute(toolCall)
      },
    }
    const dispatcher = new ParallelToolDispatcher({ registry, sink, clock, enableParallelToolDispatch })
    const outcome = await dispatcher.dispatch({ calls: script, onResult: completedHook(sink) })
    return { calls: dispatched(outcome), stored: await events(store), published }
  }

  test("event payload digests, types, sequences and results are identical with the flag on and off", async () => {
    const parallel = await runScript(true)
    const sequential = await runScript(false)
    expect(parallel.stored.map((event) => event.payloadDigest)).toEqual(
      sequential.stored.map((event) => event.payloadDigest),
    )
    expect(parallel.stored.map((event) => [event.sequence, event.type])).toEqual(
      sequential.stored.map((event) => [event.sequence, event.type]),
    )
    expect(parallel.calls).toEqual(sequential.calls)
    expect(parallel.stored.length).toBeGreaterThan(script.length)
  })

  test("the script produces the expected event types in index order", async () => {
    const { stored, calls } = await runScript(true)
    expect(stored.slice(0, 9).every((event) => event.type === "tool.requested")).toBe(true)
    expect(calls.map((entry) => entry.failure)).toEqual([
      undefined,
      "tool_error",
      undefined,
      "unknown_tool",
      "denied_path",
      "denied_path",
      undefined,
      "thrown",
      "invalid_arguments",
    ])
    expect(stored.slice(9).map((event) => [event.type, event.payload.callIndex ?? event.payload.callId])).toEqual([
      ["tool.completed", 0],
      ["tool.failed", 1],
      ["tool.completed", 2],
      ["tool.failed", 3],
      ["security.blocked", "c-4"],
      ["tool.failed", 4],
      ["security.blocked", "c-5"],
      ["tool.failed", 5],
      ["tool.completed", 6],
      ["tool.failed", 7],
      ["tool.failed", 8],
    ])
  })

  test("the live bus saw the same events in sequence order", async () => {
    const { stored, published } = await runScript(true)
    expect(published).toEqual(stored)
  })
})

describe("tool failure becomes model-visible data", () => {
  const run = async (toolCall: ModelToolCall, registry?: ToolRegistryPort, parallel = true) => {
    const context = await harness()
    const dispatcher = new ParallelToolDispatcher({
      registry: registry ?? new InMemoryToolRegistry({ files, deniedPrefixes: ["secrets"] }),
      sink: context.sink,
      clock: context.clock,
      enableParallelToolDispatch: parallel,
    })
    const outcome = await dispatcher.dispatch({ calls: [toolCall] })
    const [only] = dispatched(outcome)
    return { entry: only, stored: await events(context.store) }
  }

  test("missing file names the path and says how to find it, and persists tool.failed", async () => {
    const { entry, stored } = await run(call("c-0", "read_file", { path: "src/Nope.sol" }))
    expect(entry.result.isError).toBe(true)
    expect(entry.failure).toBe("tool_error")
    expect(entry.result.content).toContain("src/Nope.sol")
    expect(entry.result.content).toMatch(/not found/i)
    expect(entry.result.content).toMatch(/list_dir|glob/)
    expect(eventSummary(stored)).toEqual(["tool.requested", "tool.failed"])
    expect(stored[1].payload).toMatchObject({ callIndex: 0, callId: "c-0", toolName: "read_file", durationMs: 0 })
    expect(stored[1].payload.message).toBe(entry.result.content)
  })

  test("unknown tool: says what happened, the arguments and what to call instead", async () => {
    const { entry, stored } = await run(call("c-0", "delete_everything", { path: "src" }))
    expect(entry.failure).toBe("unknown_tool")
    expect(entry.result.isError).toBe(true)
    expect(entry.result.content).toContain('Tool "delete_everything" does not exist')
    expect(entry.result.content).toContain('{"path":"src"}')
    expect(entry.result.content).toContain("read_file, grep, glob, list_dir")
    expect(entry.result.content).toMatch(/instead/)
    expect(eventSummary(stored)).toEqual(["tool.requested", "tool.failed"])
  })

  test("the registry is not called for an unknown tool", async () => {
    const registry = new InMemoryToolRegistry({ files })
    await run(call("c-0", "nope"), registry)
    expect(registry.calls).toEqual([])
  })

  test.each([
    ["a missing required argument", {}, 'missing required argument "path"'],
    ["a wrong argument type", { path: 42 }, 'argument "path" must be of type string'],
    ["a wrong integer type", { path: "src/Vault.sol", startLine: "1" }, 'argument "startLine" must be of type integer'],
  ])("invalid arguments (%s) state the problem, the values and the expected shape", async (_label, args, problem) => {
    const registry = new InMemoryToolRegistry({ files })
    const { entry, stored } = await run(call("c-0", "read_file", args), registry)
    expect(entry.failure).toBe("invalid_arguments")
    expect(entry.result.content).toContain(problem)
    expect(entry.result.content).toContain(JSON.stringify(args))
    expect(entry.result.content).toContain("path (string, required)")
    expect(entry.result.content).toMatch(/call read_file again/)
    expect(registry.calls).toEqual([])
    expect(eventSummary(stored)).toEqual(["tool.requested", "tool.failed"])
  })

  test("additionalProperties false rejects unexpected arguments", async () => {
    const registry = new ControlledRegistry({ echo: async () => ok("never") })
    const { entry } = await run(call("c-0", "echo", { text: "a", extra: true }), registry)
    expect(entry.failure).toBe("invalid_arguments")
    expect(entry.result.content).toContain('unexpected argument "extra"')
    expect(registry.started).toEqual([])
  })

  test.each([
    ["/etc/passwd", SecurityRuleIds.absolutePath],
    ["  /etc/passwd  ", SecurityRuleIds.absolutePath],
    ["C:\\Users\\victim\\key.pem", SecurityRuleIds.absolutePath],
    ["\\\\server\\share\\key", SecurityRuleIds.absolutePath],
    ["file:///etc/shadow", SecurityRuleIds.absolutePath],
  ])("absolute path %j is refused with a redacted security.blocked event", async (path, ruleId) => {
    const registry = new InMemoryToolRegistry({ files })
    const { entry, stored } = await run(call("c-0", "read_file", { path }), registry)
    expect(entry.failure).toBe("denied_path")
    expect(registry.calls).toEqual([])
    expect(eventSummary(stored)).toEqual(["tool.requested", "security.blocked", "tool.failed"])
    expect(stored[1].payload).toEqual({
      ruleId,
      input: AbsolutePathRedactedPlaceholder,
      toolName: "read_file",
      callId: "c-0",
    })
    expect(entry.result.content).toContain(AbsolutePathRedactedPlaceholder)
    expect(entry.result.content).not.toMatch(/etc|victim|server|shadow/)
    expect(JSON.stringify(stored.slice(1))).not.toMatch(/etc|victim|shadow|server/)
  })

  test("traversal is refused before execution; the recorded input is the trimmed relative attempt", async () => {
    const registry = new InMemoryToolRegistry({ files })
    const { entry, stored } = await run(call("c-0", "list_dir", { path: "  ../../outside  " }), registry)
    expect(entry.failure).toBe("denied_path")
    expect(registry.calls).toEqual([])
    expect(stored[1].payload).toEqual({
      ruleId: SecurityRuleIds.pathTraversal,
      input: "../../outside",
      toolName: "list_dir",
      callId: "c-0",
    })
    expect(entry.result.content).toContain("Access denied")
    expect(entry.result.content).toMatch(/relative to the snapshot root/)
  })

  test("a path the registry refuses (denied prefix) is recorded as security.blocked and the model gets a bounded refusal", async () => {
    const registry = new InMemoryToolRegistry({ files, deniedPrefixes: ["secrets"] })
    const { entry, stored } = await run(call("c-0", "read_file", { path: "secrets/key.txt" }), registry)
    expect(registry.calls).toHaveLength(1)
    expect(entry.failure).toBe("denied_path")
    expect(entry.result.isError).toBe(true)
    expect(entry.result.content).toContain("secrets/key.txt")
    expect(entry.result.content).not.toContain("hunter2")
    expect(eventSummary(stored)).toEqual(["tool.requested", "security.blocked", "tool.failed"])
    expect(stored[1].payload).toEqual({
      ruleId: SecurityRuleIds.pathDenied,
      input: "secrets/key.txt",
      toolName: "read_file",
      callId: "c-0",
    })
    expect(stored[1].payload.ruleId).toBeTruthy()
  })

  test("a registry refusal that echoes a host path is rewritten so no host path survives", async () => {
    const registry = new ControlledRegistry({
      echo: async () => ({ content: "Access denied: C:\\host\\secret.txt", isError: true }),
    })
    const { entry, stored } = await run(call("c-0", "echo", { text: "x" }), registry)
    expect(entry.failure).toBe("denied_path")
    expect(JSON.stringify([entry, stored])).not.toContain("host")
  })

  test("a thrown Error becomes an error result naming the error, the arguments and a next step", async () => {
    const registry = new InMemoryToolRegistry({ files })
    registry.throwOn("read_file", new TypeError("adapter exploded"))
    const { entry, stored } = await run(call("c-0", "read_file", { path: "src/Vault.sol" }), registry)
    expect(entry.failure).toBe("thrown")
    expect(entry.result.isError).toBe(true)
    expect(entry.result.content).toContain("TypeError: adapter exploded")
    expect(entry.result.content).toContain('{"path":"src/Vault.sol"}')
    expect(entry.result.content).toMatch(/retry with corrected arguments or use a different tool/)
    expect(entry.result.content).not.toContain("at ")
    expect(eventSummary(stored)).toEqual(["tool.requested", "tool.failed"])
  })

  test.each([
    ["a string", "plain string failure", "plain string failure"],
    ["a plain object", { code: 7 }, '{"code":7}'],
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["a number", 42, "42"],
  ])("a thrown %s is described without crashing", async (_label, thrown, shown) => {
    const registry = new ControlledRegistry({
      echo: () => {
        throw thrown
      },
    })
    const { entry } = await run(call("c-0", "echo", { text: "x" }), registry)
    expect(entry.failure).toBe("thrown")
    expect(entry.result.content).toContain(shown)
  })

  test("a thrown value that cannot be displayed still becomes a result", async () => {
    const hostile = {
      toJSON: () => {
        throw new Error("no json")
      },
      toString: () => {
        throw new Error("no string")
      },
    }
    const registry = new ControlledRegistry({
      echo: () => {
        throw hostile
      },
    })
    const { entry } = await run(call("c-0", "echo", { text: "x" }), registry)
    expect(entry.failure).toBe("thrown")
    expect(entry.result.content).toContain("a value that cannot be displayed")
  })

  test("a rejected promise is handled the same way, with parallel dispatch on or off", async () => {
    const registry = () => new ControlledRegistry({ echo: () => Promise.reject(new Error("socket hang up")) })
    const on = await run(call("c-0", "echo", { text: "x" }), registry(), true)
    const off = await run(call("c-0", "echo", { text: "x" }), registry(), false)
    expect(on.entry.failure).toBe("thrown")
    expect(on.entry.result.content).toContain("Error: socket hang up")
    expect(off.entry).toEqual(on.entry)
  })

  test("a very long thrown message and long arguments stay bounded", async () => {
    const registry = new ControlledRegistry({
      echo: () => {
        throw new Error("x".repeat(5_000))
      },
    })
    const { entry } = await run(call("c-0", "echo", { text: "y".repeat(5_000) }), registry)
    expect(entry.result.content.length).toBeLessThan(1_200)
  })

  test("a malformed registry result becomes an error result", async () => {
    const registry = new ControlledRegistry({
      // @ts-expect-error a misbehaving adapter returns no content
      echo: async () => ({ isError: false }),
    })
    const { entry } = await run(call("c-0", "echo", { text: "x" }), registry)
    expect(entry.failure).toBe("malformed_result")
    expect(entry.result.isError).toBe(true)
    expect(entry.result.content).toContain('{"text":"x"}')
  })

  test("an error result with no content still says something useful", async () => {
    const registry = new ControlledRegistry({ echo: async () => ({ content: "  ", isError: true }) })
    const { entry } = await run(call("c-0", "echo", { text: "x" }), registry)
    expect(entry.failure).toBe("tool_error")
    expect(entry.result.content).toContain("reported an error without details")
    expect(entry.result.content).toContain('{"text":"x"}')
  })

  test("a failure alone does not stop dispatch: later calls still run", async () => {
    const context = await harness()
    const registry = new InMemoryToolRegistry({ files })
    registry.throwOn("read_file", new Error("first fails"))
    const dispatcher = new ParallelToolDispatcher({
      registry,
      sink: context.sink,
      clock: context.clock,
      enableParallelToolDispatch: true,
    })
    const outcome = await dispatcher.dispatch({
      calls: [call("c-0", "read_file", { path: "src/Vault.sol" }), call("c-1", "glob", { pattern: "**/*.sol" })],
    })
    const calls = dispatched(outcome)
    expect(calls.map((entry) => entry.result.isError)).toEqual([true, false])
  })

  test("successful content is returned raw: no filtering or shaping happens in the dispatcher", async () => {
    const secret = "sk-live-abcdefghijklmnopqrstuvwxyz012345"
    const long = Array.from({ length: 500 }, (_, index) => `line ${index} ${secret}`).join("\n")
    const registry = new ControlledRegistry({ echo: async () => ok(long) })
    const { entry } = await run(call("c-0", "echo", { text: "x" }), registry)
    expect(entry.failure).toBeUndefined()
    expect(entry.result).toEqual({ content: long, isError: false })
  })
})

describe("durations", () => {
  test("durationMs is measured with the injected clock", async () => {
    const { store, sink, clock } = await harness()
    const registry = new ControlledRegistry({
      echo: async () => {
        clock.advance(40)
        return ok("done")
      },
    })
    const dispatcher = new ParallelToolDispatcher({ registry, sink, clock, enableParallelToolDispatch: false })
    const outcome = await dispatcher.dispatch({
      calls: [call("c-0", "echo", { text: "x" })],
      onResult: completedHook(sink),
    })
    expect(dispatched(outcome)[0].durationMs).toBe(40)
    expect((await events(store))[1].payload.durationMs).toBe(40)
  })
})

describe("stale writes", () => {
  test("a stale tool.requested stops dispatch before any tool executes", async () => {
    const { store, sink, clock } = await harness({ leaseMs: 1_000 })
    clock.advance(1_001)
    await store.claim({ runId: "run-1", workerId: "worker-b" })
    const registry = new InMemoryToolRegistry({ files })
    const dispatcher = new ParallelToolDispatcher({ registry, sink, clock, enableParallelToolDispatch: true })
    const outcome = await dispatcher.dispatch({ calls: [call("c-0", "read_file", { path: "src/Vault.sol" })] })
    expect(outcome).toEqual({ kind: "stale", reason: "claim_lost", calls: [] })
    expect(registry.calls).toEqual([])
    expect(await events(store)).toEqual([])
  })

  test("a stale result from the step's hook stops settling and reports what was settled", async () => {
    const { store, sink, clock } = await harness()
    const registry = new InMemoryToolRegistry({ files })
    const dispatcher = new ParallelToolDispatcher({ registry, sink, clock, enableParallelToolDispatch: true })
    const outcome = await dispatcher.dispatch({
      calls: [call("c-0", "glob", { pattern: "**/*.sol" }), call("c-1", "glob", { pattern: "**/*.txt" })],
      onResult: async () => ({ kind: "stale", reason: "state_changed" }),
    })
    expect(outcome.kind).toBe("stale")
    expect(outcome.kind === "stale" && outcome.calls.map((entry) => entry.callIndex)).toEqual([0])
    expect(eventSummary(await events(store))).toEqual(["tool.requested", "tool.requested"])
  })
})
