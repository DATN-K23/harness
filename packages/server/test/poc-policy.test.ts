import { describe, expect, test } from "bun:test"
import { ConservativePocPolicy } from "../src/poc-policy"

describe("ConservativePocPolicy", () => {
  const policy = new ConservativePocPolicy({ compilerAvailable: false })

  test.each([
    ["import escape", 'import "../../outside.sol";'],
    ["ffi", "vm.ffi(\"touch /tmp/pwned\");"],
    ["network", "vm.rpc(\"http://example.invalid\");"],
    ["implementation replacement", "vm.etch(address(target), bytecode);"],
    ["mock target", "vm.mockCall(address(target), data, result);"],
    ["resource abuse", "while (true) {}"],
  ])("rejects %s before granting eligibility", async (_name, source) => {
    expect(await policy.sanitize({ runId: "r", snapshotId: "s", pocCode: source })).toMatchObject({ kind: "cheat_detected" })
  })

  test("does not grant eligibility when the offline compiler is unavailable", async () => {
    const result = await policy.sanitize({ runId: "r", snapshotId: "s", pocCode: "contract Test {}" })
    expect(result.kind).toBe("cheat_detected")
    if (result.kind === "cheat_detected") expect(result.findings.map((finding) => finding.ruleId)).toContain("compiler_unavailable")
  })

  test("does not return ok from a text-only policy, even when compiler capability is reported", async () => {
    const textOnly = new ConservativePocPolicy({ compilerAvailable: true })
    expect(await textOnly.sanitize({ runId: "r", snapshotId: "s", pocCode: "contract Test { function testX() public { assertTrue(true); } }" })).toMatchObject({
      kind: "cheat_detected",
      findings: [{ ruleId: "policy_unverified" }],
    })
  })

  test("does not silently pass malformed or unbound test content", async () => {
    expect(await policy.sanitize({ runId: "r", snapshotId: "s", pocCode: "not solidity" })).toMatchObject({ kind: "cheat_detected" })
    expect(await policy.sanitize({ runId: "r", snapshotId: "s", pocCode: "contract T { function testExploit() public {} }" })).toMatchObject({ kind: "cheat_detected" })
  })
})
