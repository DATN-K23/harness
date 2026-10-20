import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sha256Hex } from "../../src/util/digest"
import { loadPrompt } from "../../src/prompts/index"

describe("loadPrompt", () => {
  test("returns the text and a sha256 digest of exactly that text", () => {
    const prompt = loadPrompt("judge-system.v1")
    expect(prompt.text.length).toBeGreaterThan(0)
    expect(prompt.digest).toBe(`sha256:${sha256Hex(prompt.text)}`)
  })

  test("is stable across loads", () => {
    expect(loadPrompt("max-steps.v1")).toEqual(loadPrompt("max-steps.v1"))
  })

  test("gives the two prompts different digests", () => {
    expect(loadPrompt("judge-system.v1").digest).not.toBe(loadPrompt("max-steps.v1").digest)
  })
})

describe("prompt directory override", () => {
  let dir = ""
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "harness-prompts-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test("digest changes when the file changes", () => {
    writeFileSync(join(dir, "judge-system.v1.txt"), "Decide the finding.\n")
    const before = loadPrompt("judge-system.v1", dir)
    writeFileSync(join(dir, "judge-system.v1.txt"), "Decide the finding carefully.\n")
    const after = loadPrompt("judge-system.v1", dir)
    expect(after.digest).not.toBe(before.digest)
    expect(after.text).toBe("Decide the finding carefully.\n")
  })

  test("digest is unchanged when the file is rewritten with the same content", () => {
    writeFileSync(join(dir, "max-steps.v1.txt"), "Respond now.\n")
    const before = loadPrompt("max-steps.v1", dir)
    writeFileSync(join(dir, "max-steps.v1.txt"), "Respond now.\n")
    expect(loadPrompt("max-steps.v1", dir).digest).toBe(before.digest)
  })

  test("normalizes CRLF so the digest does not depend on checkout line endings", () => {
    writeFileSync(join(dir, "max-steps.v1.txt"), "one\ntwo\n")
    const lf = loadPrompt("max-steps.v1", dir)
    writeFileSync(join(dir, "max-steps.v1.txt"), "one\r\ntwo\r\n")
    expect(loadPrompt("max-steps.v1", dir)).toEqual(lf)
  })

  test("strips a leading attribution comment block from the text and the digest", () => {
    writeFileSync(join(dir, "max-steps.v1.txt"), "// Adapted from somewhere\n// MIT License\n\nRespond now.\n")
    const prompt = loadPrompt("max-steps.v1", dir)
    expect(prompt.text).toBe("Respond now.\n")
    expect(prompt.digest).toBe(`sha256:${sha256Hex("Respond now.\n")}`)
  })

  test("keeps a // line that appears after the prompt body starts", () => {
    writeFileSync(join(dir, "max-steps.v1.txt"), "Respond now.\n// not a header\n")
    expect(loadPrompt("max-steps.v1", dir).text).toBe("Respond now.\n// not a header\n")
  })

  test("throws a clear error for a missing file", () => {
    mkdirSync(join(dir, "empty"))
    expect(() => loadPrompt("judge-system.v1", join(dir, "empty"))).toThrow(/judge-system\.v1/)
  })
})

describe("judge-system.v1", () => {
  const { text } = loadPrompt("judge-system.v1")

  test("states the Judge role and the Zero Repair Loops stance", () => {
    expect(text).toMatch(/Judge/)
    expect(text).toMatch(/Zero Repair Loops/)
    expect(text).toMatch(/never (write|fix|repair)/i)
  })

  test("describes both oracle tiers", () => {
    expect(text).toMatch(/Tier 1/)
    expect(text).toMatch(/Tier 2/)
    expect(text).toMatch(/run_state_probe/)
  })

  test("requires evidence as a file path with a line range and never asks for hashes", () => {
    expect(text).toMatch(/startLine/)
    expect(text).toMatch(/endLine/)
    expect(text).toMatch(/Do not (compute|output|include)[^.]*(hash|digest)/i)
    expect(text).not.toMatch(/(provide|compute|include) (a |the )?(sha|hash)/i)
  })

  test("names every verdict field the schema requires", () => {
    for (const field of [
      "runId",
      "findingId",
      "validity",
      "verificationStatus",
      "reasonCode",
      "confidence",
      "summary",
      "reasoning",
      "citesEvidence",
    ])
      expect(text).toContain(field)
  })

  test("lists the allowed reason codes", () => {
    for (const code of [
      "EXPLOIT_CONFIRMED",
      "MISSING_POC",
      "NON_FAITHFUL_OVERRIDE",
      "EXECUTION_FAILED",
      "BENIGN_MECHANICS",
      "NO_STATE_DELTA",
      "OUT_OF_SCOPE",
      "UNRESOLVED",
    ])
      expect(text).toContain(code)
  })
})

describe("max-steps.v1", () => {
  const { text } = loadPrompt("max-steps.v1")

  test("demands a final text verdict without tool calls and carries no edit or user-input language", () => {
    expect(text).toMatch(/MAXIMUM STEPS/)
    expect(text).toMatch(/verdict/i)
    expect(text).toMatch(/Do NOT make any tool calls/)
    expect(text).not.toMatch(/\bedit/i)
    expect(text).not.toMatch(/user input/i)
    expect(text).not.toMatch(/\bwrites?\b/i)
  })
})
