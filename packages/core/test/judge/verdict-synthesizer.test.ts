import { describe, expect, test } from "bun:test"
import { EventPayloadSchemas } from "@harness/protocol"
import { MaxSchemaRepairs, synthesizeVerdict, type VerdictSynthesisInput } from "../../src/judge/verdict-synthesizer"
import { InMemorySnapshot } from "../../src/testing/in-memory-snapshot"
import { RegexSecurityFilter } from "../../src/testing/regex-security-filter"
import { sha256Hex } from "../../src/util/digest"

const vaultLines = Array.from({ length: 30 }, (_, index) => `line ${index + 1} of Vault.sol`)

const files = {
  "src/Vault.sol": `${vaultLines.join("\n")}\n`,
  "src/Config.sol": "contract Config {\n  // PRIVATE_KEY=0xabc123\n}\n",
}

const snapshot = () => new InMemorySnapshot({ snapshotId: "snap-1", files })

const deps = () => ({ snapshot: snapshot(), security: new RegexSecurityFilter() })

const validVerdict = {
  validity: "valid",
  verificationStatus: "PASS",
  reasonCode: "EXPLOIT_CONFIRMED",
  severity: "HIGH",
  confidence: "HIGH",
  summary: "Withdraw lets an attacker drain the vault.",
  reasoning: "The trace shows the attacker balance increasing after reentering withdraw before the state update.",
  citesEvidence: [{ filePath: "src/Vault.sol", startLine: 10, endLine: 20, explanation: "state update after call" }],
}

const invalidVerdict = {
  validity: "invalid",
  verificationStatus: "FAIL",
  reasonCode: "BENIGN_MECHANICS",
  confidence: "MEDIUM",
  summary: "The PoC only shows a normal withdrawal.",
  reasoning: "The asserted balance change is the user's own deposit coming back, which is intended behavior.",
}

const input = (text: string, overrides: Partial<VerdictSynthesisInput> = {}): VerdictSynthesisInput => ({
  text,
  runId: "run-1",
  findingId: "finding-7",
  snapshotId: "snap-1",
  enableSchemaRepair: true,
  repairsUsed: 0,
  ...overrides,
})

const json = (value: unknown) => JSON.stringify(value)

describe("synthesizeVerdict: accepted verdicts", () => {
  test("a valid verdict is accepted with the run identity filled in by the harness", async () => {
    const result = await synthesizeVerdict(deps(), input(json(invalidVerdict)))
    expect(result.kind).toBe("accepted")
    if (result.kind !== "accepted") return
    expect(result.verdict).toMatchObject({ ...invalidVerdict, runId: "run-1", findingId: "finding-7" })
  })

  test("the committed evidence carries the SHA-256 of exactly lines 10-20 as read from the snapshot", async () => {
    const owned = deps()
    const result = await synthesizeVerdict(owned, input(json(validVerdict)))
    expect(result.kind).toBe("accepted")
    if (result.kind !== "accepted") return
    const exact = vaultLines.slice(9, 20).join("\n")
    expect(result.verdict.citesEvidence[0]).toEqual({
      ...validVerdict.citesEvidence[0],
      snippet: exact,
      contentDigest: `sha256:${sha256Hex(exact)}`,
    })
    expect(owned.snapshot.reads).toEqual([{ snapshotId: "snap-1", path: "src/Vault.sol", startLine: 10, endLine: 20 }])
  })

  test("hashes the model supplies are discarded and replaced by the harness's own", async () => {
    const forged = {
      ...validVerdict,
      runId: "someone-else",
      findingId: "other",
      traceDigest: "sha256:forged",
      citesEvidence: [{ ...validVerdict.citesEvidence[0], snippet: "fake", contentDigest: "sha256:forged" }],
    }
    const result = await synthesizeVerdict(deps(), input(json(forged), { traceDigest: `sha256:${"a".repeat(64)}` }))
    expect(result.kind).toBe("accepted")
    if (result.kind !== "accepted") return
    expect(result.verdict.runId).toBe("run-1")
    expect(result.verdict.findingId).toBe("finding-7")
    expect(result.verdict.traceDigest).toBe(`sha256:${"a".repeat(64)}`)
    expect(result.verdict.citesEvidence[0]?.contentDigest).toBe(
      `sha256:${sha256Hex(vaultLines.slice(9, 20).join("\n"))}`,
    )
    expect(result.verdict.citesEvidence[0]?.snippet).not.toBe("fake")
  })

  test("without a trace digest from the run, a model-supplied traceDigest is dropped", async () => {
    const result = await synthesizeVerdict(deps(), input(json({ ...invalidVerdict, traceDigest: "sha256:forged" })))
    expect(result.kind === "accepted" && result.verdict.traceDigest).toBeUndefined()
  })

  test("accepts the JSON object wrapped in a json code fence", async () => {
    const result = await synthesizeVerdict(deps(), input(`\n\`\`\`json\n${json(invalidVerdict)}\n\`\`\`\n`))
    expect(result.kind).toBe("accepted")
  })

  test("the snippet passes the security filter while the digest covers the raw lines", async () => {
    const verdict = {
      ...validVerdict,
      citesEvidence: [{ filePath: "src/Config.sol", startLine: 1, endLine: 3, explanation: "hardcoded key" }],
    }
    const result = await synthesizeVerdict(deps(), input(json(verdict)))
    expect(result.kind).toBe("accepted")
    if (result.kind !== "accepted") return
    const raw = "contract Config {\n  // PRIVATE_KEY=0xabc123\n}"
    expect(result.verdict.citesEvidence[0]?.snippet).not.toContain("0xabc123")
    expect(result.verdict.citesEvidence[0]?.contentDigest).toBe(`sha256:${sha256Hex(raw)}`)
  })
})

describe("synthesizeVerdict: validation failures", () => {
  test("text that is not one JSON object is a schema violation at the root and asks for a repair", async () => {
    const result = await synthesizeVerdict(deps(), input("I think the finding is valid."))
    expect(result).toMatchObject({ kind: "repair", attempt: 1, issues: [{ reason: "SCHEMA_VIOLATION", path: [] }] })
  })

  test("a JSON array is not a verdict", async () => {
    const result = await synthesizeVerdict(deps(), input(json([invalidVerdict])))
    expect(result).toMatchObject({ kind: "repair", issues: [{ reason: "SCHEMA_VIOLATION", path: [] }] })
  })

  test("short reasoning fails on the reasoning path and the feedback names it", async () => {
    const result = await synthesizeVerdict(deps(), input(json({ ...invalidVerdict, reasoning: "too short" })))
    expect(result.kind).toBe("repair")
    if (result.kind !== "repair") return
    expect(result.issues.map((issue) => issue.path)).toEqual([["reasoning"]])
    expect(result.feedback).toContain("reasoning")
    expect(result.feedback).toContain("JSON")
  })

  test("contradictory fields fail with the cross-field reason code", async () => {
    const result = await synthesizeVerdict(deps(), input(json({ ...validVerdict, verificationStatus: "FAIL" })))
    expect(result).toMatchObject({
      kind: "repair",
      issues: [{ reason: "VALID_REQUIRES_PASS", path: ["verificationStatus"] }],
    })
  })

  test("evidence the snapshot cannot resolve fails validation and the feedback never asks for a hash", async () => {
    const verdict = {
      ...validVerdict,
      citesEvidence: [{ filePath: "src/Missing.sol", startLine: 1, endLine: 2, explanation: "x" }],
    }
    const owned = deps()
    const result = await synthesizeVerdict(owned, input(json(verdict)))
    expect(result).toMatchObject({
      kind: "repair",
      issues: [{ reason: "EVIDENCE_UNRESOLVED", path: ["citesEvidence", 0, "filePath"] }],
    })
    if (result.kind !== "repair") return
    expect(owned.snapshot.reads).toHaveLength(1)
    expect(result.feedback).not.toMatch(/please (?:provide|compute|supply)[^.]*(?:hash|digest)/i)
    expect(result.feedback).toContain("Do not include snippet, contentDigest, traceDigest or any hash")
  })

  test("absolute and parent-directory paths are refused without reading the snapshot or echoing the path", async () => {
    const verdict = {
      ...validVerdict,
      citesEvidence: [
        { filePath: "C:\\Users\\alice\\secret.sol", startLine: 1, endLine: 1, explanation: "x" },
        { filePath: "/etc/passwd", startLine: 1, endLine: 1, explanation: "x" },
        { filePath: "src/../../outside.sol", startLine: 1, endLine: 1, explanation: "x" },
      ],
    }
    const owned = deps()
    const result = await synthesizeVerdict(owned, input(json(verdict)))
    expect(result.kind).toBe("repair")
    if (result.kind !== "repair") return
    expect(owned.snapshot.reads).toEqual([])
    expect(result.issues.map((issue) => [issue.reason, ...issue.path])).toEqual([
      ["EVIDENCE_UNRESOLVED", "citesEvidence", 0, "filePath"],
      ["EVIDENCE_UNRESOLVED", "citesEvidence", 1, "filePath"],
      ["EVIDENCE_UNRESOLVED", "citesEvidence", 2, "filePath"],
    ])
    expect(result.feedback).not.toContain("alice")
    expect(result.feedback).not.toContain("/etc/passwd")
    expect(result.feedback).not.toContain("outside.sol")
  })

  test("a line range past the end of the file fails on endLine and states the file length", async () => {
    const verdict = {
      ...validVerdict,
      citesEvidence: [{ filePath: "src/Vault.sol", startLine: 25, endLine: 40, explanation: "x" }],
    }
    const result = await synthesizeVerdict(deps(), input(json(verdict)))
    expect(result).toMatchObject({
      kind: "repair",
      issues: [{ reason: "EVIDENCE_UNRESOLVED", path: ["citesEvidence", 0, "endLine"] }],
    })
    if (result.kind !== "repair") return
    expect(result.feedback).toContain("30 lines")
  })

  test("every evidence item is checked and only the unresolved ones are reported", async () => {
    const verdict = {
      ...validVerdict,
      citesEvidence: [
        validVerdict.citesEvidence[0],
        { filePath: "src/Nope.sol", startLine: 1, endLine: 1, explanation: "x" },
      ],
    }
    const result = await synthesizeVerdict(deps(), input(json(verdict)))
    expect(result.kind === "repair" && result.issues.map((issue) => issue.path)).toEqual([
      ["citesEvidence", 1, "filePath"],
    ])
  })

  test("issues carry only a reason code and a path, which the validation event accepts", async () => {
    const result = await synthesizeVerdict(deps(), input(json({ ...invalidVerdict, summary: 3 })))
    expect(result.kind).toBe("repair")
    if (result.kind !== "repair") return
    const payload = {
      attempt: result.attempt,
      issues: result.issues.map((issue) => ({ reason: issue.reason, path: issue.path })),
    }
    expect(EventPayloadSchemas["verdict.validation_failed"].safeParse(payload).success).toBe(true)
  })
})

describe("synthesizeVerdict: bounded repair", () => {
  test("allows two repairs: the attempt number follows the repairs already used", async () => {
    const bad = json({ ...invalidVerdict, reasoning: "short" })
    const first = await synthesizeVerdict(deps(), input(bad, { repairsUsed: 0 }))
    const second = await synthesizeVerdict(deps(), input(bad, { repairsUsed: 1 }))
    expect(MaxSchemaRepairs).toBe(2)
    expect(first).toMatchObject({ kind: "repair", attempt: 1 })
    expect(second).toMatchObject({ kind: "repair", attempt: 2 })
  })

  test("after two repairs the next invalid verdict is rejected", async () => {
    const bad = json({ ...invalidVerdict, reasoning: "short" })
    const result = await synthesizeVerdict(deps(), input(bad, { repairsUsed: 2 }))
    expect(result).toMatchObject({ kind: "rejected", attempt: 3, issues: [{ path: ["reasoning"] }] })
  })

  test("with enableSchemaRepair off the first invalid verdict is rejected", async () => {
    const result = await synthesizeVerdict(
      deps(),
      input(json({ ...invalidVerdict, reasoning: "short" }), { enableSchemaRepair: false }),
    )
    expect(result).toMatchObject({ kind: "rejected", attempt: 1 })
  })

  test("with enableSchemaRepair off a valid verdict is still accepted", async () => {
    const result = await synthesizeVerdict(deps(), input(json(invalidVerdict), { enableSchemaRepair: false }))
    expect(result.kind).toBe("accepted")
  })

  test("the repair budget is an input", async () => {
    const result = await synthesizeVerdict(deps(), input("nope", { repairsUsed: 0, maxRepairs: 0 }))
    expect(result.kind).toBe("rejected")
  })

  test("the feedback says how many repairs remain", async () => {
    const result = await synthesizeVerdict(deps(), input("nope", { repairsUsed: 1 }))
    expect(result.kind === "repair" && result.feedback).toContain("last repair")
  })
})
