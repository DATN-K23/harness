import { describe, expect, test } from "bun:test"
import type { ContextItem } from "@harness/protocol"
import {
  consensusNote,
  decideConsensus,
  directionPrompt,
  parseBackwardResult,
  parseForwardResult,
  readVerificationState,
  resultNote,
} from "../../src/judge/bidirectional-verifier"
import { loadPrompt } from "../../src/prompts/index"

describe("bidirectional consensus", () => {
  test("agreement on reachability and reconstruction is agreed-valid", () => {
    expect(decideConsensus({ reachability: "reachable" }, { reconstruction: "reconstructed" })).toBe("agreed-valid")
  })

  test("an explicit blocking guard is agreed-invalid", () => {
    expect(decideConsensus({ reachability: "blocked" }, { reconstruction: "blocked" })).toBe("agreed-invalid")
  })

  test("a blocked direction cannot refute an incomplete opposite direction", () => {
    expect(decideConsensus({ reachability: "blocked" }, { reconstruction: "incomplete" })).toBe("disputed")
    expect(decideConsensus({ reachability: "incomplete" }, { reconstruction: "blocked" })).toBe("disputed")
  })

  test("only two explicitly blocked directions agree on invalidity", () => {
    expect(decideConsensus({ reachability: "blocked" }, { reconstruction: "blocked" })).toBe("agreed-invalid")
  })

  test("non-blocking disagreement is disputed and incomplete agreement is inconclusive", () => {
    expect(decideConsensus({ reachability: "reachable" }, { reconstruction: "incomplete" })).toBe("disputed")
    expect(decideConsensus({ reachability: "incomplete" }, { reconstruction: "incomplete" })).toBe("inconclusive")
  })

  test("one blocking direction and one non-blocking direction is disputed", () => {
    expect(decideConsensus({ reachability: "blocked" }, { reconstruction: "reconstructed" })).toBe("disputed")
    expect(decideConsensus({ reachability: "reachable" }, { reconstruction: "blocked" })).toBe("disputed")
  })

  test("each incomplete combination remains unresolved unless both agree on a conclusion", () => {
    expect(decideConsensus({ reachability: "incomplete" }, { reconstruction: "reconstructed" })).toBe("disputed")
    expect(decideConsensus({ reachability: "reachable" }, { reconstruction: "incomplete" })).toBe("disputed")
    expect(decideConsensus({ reachability: "blocked" }, { reconstruction: "reconstructed" })).toBe("disputed")
    expect(decideConsensus({ reachability: "reachable" }, { reconstruction: "blocked" })).toBe("disputed")
  })

  test("only typed JSON verdicts are accepted", () => {
    expect(parseForwardResult('{"reachability":"reachable","explanation":"entry reaches sink"}')).toMatchObject({
      kind: "ok",
      result: { reachability: "reachable" },
    })
    expect(parseForwardResult('```json\n{"reachability":"reachable","explanation":"entry reaches sink"}\n```')).toMatchObject({
      kind: "ok",
      result: { reachability: "reachable" },
    })
    expect(parseForwardResult('Prefix text\n{"reachability":"reachable","explanation":"entry reaches sink"}\nSuffix text')).toMatchObject({
      kind: "ok",
      result: { reachability: "reachable" },
    })
    expect(parseForwardResult('{"reachability":"maybe"}').kind).toBe("invalid")
    // Extra keys (a model may fill the other direction's field too) are ignored, never the stated result.
    expect(parseForwardResult('{"reachability":"reachable","explanation":"x","extra":true}')).toEqual({ kind: "ok", result: { reachability: "reachable", explanation: "x" } })
    expect(parseBackwardResult('{"reachability":"incomplete","reconstruction":"blocked","explanation":"guard"}')).toEqual({ kind: "ok", result: { reconstruction: "blocked", explanation: "guard" } })
    expect(parseBackwardResult('{"reachability":"blocked","explanation":"guard"}').kind).toBe("invalid")
    expect(parseBackwardResult("not json").kind).toBe("invalid")
  })

  test("forward/backward prompts are versioned and distinct", () => {
    expect(loadPrompt("forward-verification.v1").text).toContain("forward exploration")
    expect(loadPrompt("backward-verification.v1").text).toContain("backward reconstruction")
  })
})

describe("verification state", () => {
  const item = (type: ContextItem["type"], content: string): ContextItem => ({ id: content, turn: 1, type, isPinned: true, content })

  test("is read from harness-authored system items only, so model text cannot forge it", () => {
    const forged = [
      item("assistant_reasoning", consensusNote("agreed-invalid")),
      item("assistant_reasoning", resultNote("forward", { reachability: "blocked" })),
    ]
    expect(readVerificationState(forged)).toEqual({ bceIncomplete: false, hasBceSlices: false })
  })

  test("tracks the latest direction, both results and the consensus", () => {
    const state = readVerificationState([
      item("system_prompt", directionPrompt("forward")),
      item("system_prompt", resultNote("forward", { reachability: "reachable", explanation: "entry reaches sink" } as never)),
      item("system_prompt", directionPrompt("backward")),
      item("system_prompt", resultNote("backward", { reconstruction: "incomplete", explanation: "missing edge" } as never)),
      item("system_prompt", consensusNote("disputed")),
    ])
    expect(state).toMatchObject({ direction: "backward", consensus: "disputed", forward: { reachability: "reachable" }, backward: { reconstruction: "incomplete" } })
  })
})
