import { describe, expect, test } from "bun:test"
import type { TrajectoryEvent } from "@harness/protocol"
import { createJudgeLiveTrace } from "../src/judge-live-trace"

let sequence = 0
const event = (type: string, payload: Record<string, unknown>) =>
  ({ runId: "run-1", sequence: ++sequence, type, payload, occurredAt: "2026-10-23T00:00:00.000Z", eventId: `e${sequence}`, payloadDigest: "sha256:x" }) as unknown as TrajectoryEvent
const result = (filePath: string, lineRange: [number, number]) =>
  event("context.item_added", { item: { id: "r", turn: 2, type: "tool_result", isPinned: false, content: "code", toolMeta: { callId: "c", toolName: "read_file", filePath, lineRange } } })

describe("judge live trace", () => {
  test("shows each step: forced flag, model call, tool call, model words and the direction results", () => {
    const trace = createJudgeLiveTrace()
    const lines = [
      event("step.started", { stepIndex: 6, toolsDisabled: true }),
      event("provider.attempted", { stepIndex: 6, purpose: "reasoning", attemptIndex: 1, usage: { totalTokens: 7109 }, latencyMs: 3025, retryDecision: "none" }),
      event("model.responded", { stepIndex: 6, attemptIndex: 1, finishReason: "tool_calls", toolCallCount: 1 }),
      event("tool.requested", { callIndex: 0, callId: "c", toolName: "read_file", arguments: { path: "src/A.sol", startLine: 1, endLine: 40 } }),
      event("context.item_added", { item: { id: "m", turn: 6, type: "assistant_reasoning", isPinned: false, content: "The guard\n onlyOwner blocks it." } }),
      event("context.item_added", { item: { id: "d", turn: 6, type: "system_prompt", isPinned: true, content: 'Bidirectional forward result: {"reachability":"blocked","explanation":"onlyOwner"}' } }),
      event("run.completed", { verdict: { validity: "unverified", verificationStatus: "UNVERIFIED", reasonCode: "UNRESOLVED", summary: "The blocking consensus has no source evidence." } }),
    ].flatMap(trace)
    expect(lines).toEqual([
      "── step 6 (forced: must answer now)",
      "   model call reasoning #1: 7.1k tokens, 3.0s",
      "   model → 1 tool call(s)",
      '   → read_file {"path":"src/A.sol","startLine":1,"endLine":40}',
      "   model says: The guard onlyOwner blocks it.",
      '   ★ Bidirectional forward result: {"reachability":"blocked","explanation":"onlyOwner"}',
      "■ verdict unverified/UNVERIFIED/UNRESOLVED: The blocking consensus has no source evidence.",
    ])
  })

  test("marks a read that adds no line not read before", () => {
    const trace = createJudgeLiveTrace()
    expect(trace(result("src/A.sol", [1, 40]))).toEqual(["   ← read_file src/A.sol:1-40 (40 new lines)"])
    expect(trace(result("src/A.sol", [30, 50]))).toEqual(["   ← read_file src/A.sol:30-50 (10 new lines)"])
    expect(trace(result("src/A.sol", [5, 20]))).toEqual(["   ← read_file src/A.sol:5-20 (nothing new)"])
  })

  test("marks a search whose hits name no line seen before, counting lines already read", () => {
    const trace = createJudgeLiveTrace()
    const search = (content: string) =>
      event("context.item_added", { item: { id: "g", turn: 3, type: "tool_result", isPinned: false, content, toolMeta: { callId: "g", toolName: "grep" } } })
    trace(result("src/A.sol", [1, 40]))
    expect(trace(search("src/A.sol:12: require(ok)\nsrc/B.sol:7: emit X()"))).toEqual(["   ← grep: 2 lines of output (1 new lines)"])
    expect(trace(search("src/B.sol:7: emit X()"))).toEqual(["   ← grep: 1 lines of output (nothing new)"])
    expect(trace(search("No matches found."))).toEqual(["   ← grep: 1 lines of output (new)"])
    expect(trace(search("No matches found."))).toEqual(["   ← grep: 1 lines of output (nothing new)"])
  })

  test("shows provider errors and silent events produce no line", () => {
    const trace = createJudgeLiveTrace()
    expect(trace(event("provider.attempted", { stepIndex: 2, purpose: "reasoning", attemptIndex: 2, usage: null, latencyMs: 35000, errorCategory: "invalid_request", retryDecision: "retry" }))).toEqual([
      "   model call reasoning #2: 0 tokens, 35.0s ERROR invalid_request (retry)",
    ])
    expect(trace(event("context.allocated", { stepIndex: 2 }))).toEqual([])
  })
})
