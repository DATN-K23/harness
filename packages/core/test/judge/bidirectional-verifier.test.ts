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

  test("one blocking result plus incomplete evidence refutes", () => {
    expect(decideConsensus({ reachability: "blocked" }, { reconstruction: "incomplete" })).toBe("agreed-invalid")
    expect(decideConsensus({ reachability: "incomplete" }, { reconstruction: "blocked" })).toBe("agreed-invalid")
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
    expect(parseForwardResult('{"reachability":"maybe"}').kind).toBe("invalid")
    expect(parseForwardResult('{"reachability":"reachable","explanation":"x","extra":true}').kind).toBe("invalid")
    expect(parseBackwardResult("not json").kind).toBe("invalid")
  })

  test("forward/backward prompts are versioned and distinct", () => {
    expect(loadPrompt("forward-verification.v1").text).toContain("forward exploration")
    expect(loadPrompt("backward-verification.v1").text).toContain("backward reconstruction")
  })
})
