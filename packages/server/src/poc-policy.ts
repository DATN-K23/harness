import type { SanitizerPort, SanitizerResult, StageInput } from "@harness/protocol"

/** Conservative admission check only; this text policy is not an isolation boundary. */
export class ConservativePocPolicy implements SanitizerPort {
  constructor(private readonly options: { compilerAvailable: boolean }) {}

  async sanitize(input: StageInput & { pocCode: string }, signal?: AbortSignal): Promise<SanitizerResult> {
    signal?.throwIfAborted()
    const code = input.pocCode
    const findings = [
      ...(code.length === 0 || code.length > 64_000 ? [{ ruleId: "poc_size", message: "PoC is empty or exceeds the size limit" }] : []),
      ...(/\bimport\b[^;]*["'](?:\/|\.\.[/\\])/i.test(code) ? [{ ruleId: "import_escape", message: "Absolute and parent imports are unsupported" }] : []),
      ...(/\b(?:ffi|rpc|rpcUrl|createSelectFork|createFork|deal|etch|store|load|mockCall|mockCalls|mockFunction|expectCall|broadcast|startBroadcast|pauseGasMetering)\s*\(/i.test(code) ? [{ ruleId: "unsafe_cheatcode", message: "Unsupported or state-forging cheatcode" }] : []),
      ...(/\b(?:https?:\/\/|socket|tcp|udp|while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;)/i.test(code) ? [{ ruleId: "unsafe_behavior", message: "Network behavior or unbounded loop is unsupported" }] : []),
      ...(/\b(?:selfdestruct|delegatecall|create2)\b/i.test(code) ? [{ ruleId: "unsupported_opcode", message: "Unsupported low-level behavior" }] : []),
      ...(!/\bcontract\s+\w+\b/.test(code) || !/\bfunction\s+test\w*\s*\(/.test(code) || !/\bassert(?:Eq|True|False|Gt|Lt)?\s*\(/.test(code)
        ? [{ ruleId: "unbound_assertion", message: "A contract, test function, and explicit assertion are required" }]
        : []),
      ...(!this.options.compilerAvailable ? [{ ruleId: "compiler_unavailable", message: "Pinned offline Solidity compiler is unavailable" }] : []),
      { ruleId: "policy_unverified", message: "No audited parser and claim-to-test binding is available" },
    ]
    if (findings.length) return { kind: "cheat_detected", findings }
    return { kind: "ok", stitchedTestFile: code, hasSubmitterAssertions: true, antiCheatReport: { rulesChecked: ["conservative-text-policy"], findings: [] } }
  }

  async injectStateProbes(_stitchedTestFile: string, _stateVariables: string[], signal?: AbortSignal): Promise<{ probedTestFile: string }> {
    signal?.throwIfAborted()
    throw new Error("State probe injection is unsupported by the conservative PoC policy")
  }
}
