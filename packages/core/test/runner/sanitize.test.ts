import { describe, expect, test } from "bun:test"
import { sanitizeSourceContent, sanitizeSystemText } from "../../src/util/sanitize"

describe("model-visible sanitizers", () => {
  test("redacts Windows drive and UNC paths, including directory names with spaces", () => {
    const sanitized = sanitizeSystemText([
      "D:\\repo\\Vault.sol",
      "C:\\Users\\NHAT DAT\\AppData\\Roaming\\bun.cmd",
      "\\\\host\\share\\x",
      "\\\\host\\share name\\nested\\x",
    ].join("\n"))

    expect(sanitized).not.toContain("D:\\repo")
    expect(sanitized).not.toContain("C:\\Users\\NHAT DAT")
    expect(sanitized).not.toContain("\\\\host\\share")
  })

  test("redacts POSIX paths only at allowed boundaries and keeps URLs", () => {
    const permalink = "https://github.com/org/repo/blob/abc/src/Vault.sol#L10"
    const sanitized = sanitizeSystemText(
      "/home/u/x\nsee /Users/NHAT DAT/repo/Vault.sol\nprefix/home/u/x\n" + permalink,
    )

    const lines = sanitized.split("\n")
    expect(lines[0]).toBe("<absolute path redacted>")
    expect(lines[1]).toBe("see <absolute path redacted>")
    expect(sanitized).not.toContain("/Users/NHAT DAT")
    expect(sanitized).toContain("prefix/home/u/x")
    expect(sanitized).toContain(permalink)
  })

  test("removes ground-truth and scoring marker lines", () => {
    const sanitized = sanitizeSystemText(
      "safe line\nGroundTruthLabel: vulnerable\nadjudication_report: private\nscoring: 1.0\nkept",
    )

    expect(sanitized).toBe("safe line\nkept")
  })

  test("redacts credential patterns from system text", () => {
    const sanitized = sanitizeSystemText("key = sk-1234567890abcdef123456")

    expect(sanitized).not.toContain("sk-1234567890abcdef123456")
    expect(sanitized).toContain("<redacted>")
  })

  test("preserves snapshot path-like comments while redacting credentials", () => {
    const source = "// see /docs/spec.md for details\nconst key = sk-1234567890abcdef123456"
    const sanitized = sanitizeSourceContent(source)

    expect(sanitized).toContain("// see /docs/spec.md for details")
    expect(sanitized).not.toContain("sk-1234567890abcdef123456")
  })
})
