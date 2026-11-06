import { describe, expect, it } from "bun:test"
import { checkSnapshotPath, isDeniedSourceFile, DEFAULT_DENIED_PREFIXES } from "../../src/source/source-snapshot"

describe("source-snapshot security predicates", () => {
  it("denies absolute paths", () => {
    expect(checkSnapshotPath("/etc/passwd").kind).toBe("denied")
    expect(checkSnapshotPath("C:\\Windows\\system32").kind).toBe("denied")
  })

  it("denies directory traversal", () => {
    expect(checkSnapshotPath("../escape").kind).toBe("denied")
    expect(checkSnapshotPath("contracts/../../escape").kind).toBe("denied")
  })

  it("denies default denied prefixes", () => {
    expect(checkSnapshotPath(".git/config", DEFAULT_DENIED_PREFIXES).kind).toBe("denied")
    expect(checkSnapshotPath("node_modules/lib/index.js", DEFAULT_DENIED_PREFIXES).kind).toBe("denied")
    expect(checkSnapshotPath("adjudication/report.json", DEFAULT_DENIED_PREFIXES).kind).toBe("denied")
    expect(checkSnapshotPath("test/ground-truth/finding.json", DEFAULT_DENIED_PREFIXES).kind).toBe("denied")
  })

  it("identifies denied source files via isDeniedSourceFile", () => {
    expect(isDeniedSourceFile(".env")).toBe(true)
    expect(isDeniedSourceFile(".env.local")).toBe(true)
    expect(isDeniedSourceFile("secret.pem")).toBe(true)
    expect(isDeniedSourceFile("deployer.key")).toBe(true)
    expect(isDeniedSourceFile(".git/HEAD")).toBe(true)
    expect(isDeniedSourceFile("adjudication/summary.txt")).toBe(true)

    // Allowed source files
    expect(isDeniedSourceFile("contracts/Token.sol")).toBe(false)
    expect(isDeniedSourceFile("README.md")).toBe(false)
    expect(isDeniedSourceFile("src/utils/math.sol")).toBe(false)
  })
})
