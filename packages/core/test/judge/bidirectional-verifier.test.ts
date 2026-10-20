import { describe, expect, test } from "bun:test"
import { decideConsensus, parseBackwardResult, parseForwardResult } from "../../src/judge/bidirectional-verifier"
import { loadPrompt } from "../../src/prompts/index"

describe("bidirectional consensus", () => {
  test("agreement on reachability and reconstruction is agreed-valid", () => {
    expect(decideConsensus({ reachability: "reachable" }, { reconstruction: "reconstructed" })).toBe("agreed-valid")
  })

  test("an explicit blocking guard is agreed-invalid", () => {
    expect(decideConsensus({ reachability: "blocked" }, { reconstruction: "blocked" })).toBe("agreed-invalid")
  })

  test("disagreement is disputed and incomplete agreement is inconclusive", () => {
    expect(decideConsensus({ reachability: "reachable" }, { reconstruction: "blocked" })).toBe("agreed-invalid")
    expect(decideConsensus({ reachability: "incomplete" }, { reconstruction: "incomplete" })).toBe("inconclusive")
  })

  test("only typed JSON verdicts are accepted", () => {
    expect(parseForwardResult('{"reachability":"reachable","explanation":"entry reaches sink"}')).toMatchObject({
      kind: "ok",
      result: { reachability: "reachable" },
    })
    expect(parseForwardResult('{"reachability":"maybe"}').kind).toBe("invalid")
    expect(parseBackwardResult("not json").kind).toBe("invalid")
  })

  test("forward/backward prompts are versioned and distinct", () => {
    expect(loadPrompt("forward-verification.v1").text).toContain("forward exploration")
    expect(loadPrompt("backward-verification.v1").text).toContain("backward reconstruction")
  })
})
