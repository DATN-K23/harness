import { describe, expect, test } from "bun:test"
import { truncateText } from "../../src/util/truncate"

describe("truncateText (adapted from OpenCode)", () => {
  test("returns content unchanged when within limits", () => {
    const text = "line 1\nline 2\nline 3"
    const result = truncateText(text, { maxLines: 5, maxBytes: 1000 })
    expect(result.truncated).toBe(false)
    expect(result.content).toBe(text)
  })

  test("truncates by maxLines in head direction", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")
    const result = truncateText(text, { maxLines: 3, maxBytes: 10000, direction: "head" })
    expect(result.truncated).toBe(true)
    expect(result.content).toContain("line 1\nline 2\nline 3")
    expect(result.content).toContain("...7 lines truncated...")
    expect(result.content).not.toContain("line 4")
  })

  test("truncates by maxBytes when byte budget is exceeded before line count", () => {
    const text = "a".repeat(100) + "\n" + "b".repeat(100)
    const result = truncateText(text, { maxLines: 10, maxBytes: 120, direction: "head" })
    expect(result.truncated).toBe(true)
    expect(result.content).toContain("bytes truncated...")
  })

  test("truncates in tail direction", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")
    const result = truncateText(text, { maxLines: 3, maxBytes: 10000, direction: "tail" })
    expect(result.truncated).toBe(true)
    expect(result.content).toContain("line 8\nline 9\nline 10")
    expect(result.content).toContain("...7 lines truncated...")
    expect(result.content).not.toContain("line 7")
  })
})
