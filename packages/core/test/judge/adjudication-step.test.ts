import { describe, expect, test } from "bun:test"
import type { SanitizerResult, StateProbeResult } from "@harness/protocol"
import {
  RunStateProbeToolName,
  buildInitialContext,
  composeTools,
  createProbeCounter,
  stateProbeFor,
} from "../../src/judge/adjudication-step"
import { FakeClock, SeededRandom } from "../../src/testing/deterministic"
import { InMemoryToolRegistry } from "../../src/testing/in-memory-tool-registry"
import { ScriptedSandbox, ScriptedSanitizer } from "../../src/testing/scripted-stages"
import { createIdGenerator } from "../../src/util/id"

type Sanitized = Extract<SanitizerResult, { kind: "ok" }>

const sanitized = (hasSubmitterAssertions: boolean): Sanitized => ({
  kind: "ok",
  stitchedTestFile: "contract VaultTest is BaseTest { function testExploit() public {} }",
  hasSubmitterAssertions,
  antiCheatReport: { rulesChecked: ["ffi"], findings: [] },
})

const probeResult: StateProbeResult = {
  exitCode: 0,
  trace: "[PASS] testExploit()",
  stateDeltas: [{ variable: "totalSupply", before: "100", after: "250" }],
}

const setup = (hasSubmitterAssertions: boolean, maxProbeRuns = 2) => {
  const registry = new InMemoryToolRegistry({ files: { "src/Vault.sol": "contract Vault {}\n" } })
  const sanitizer = new ScriptedSanitizer([sanitized(hasSubmitterAssertions)])
  const sandbox = new ScriptedSandbox({ stateProbe: [probeResult] })
  const probe = stateProbeFor({
    sanitized: sanitized(hasSubmitterAssertions),
    claim: { targetContracts: ["Vault"], targetFunctions: [], rootCause: "supply change", attackScenario: "attacker calls", callerAssumptions: [], claimedImpact: "totalSupply rises", claimedState: "totalSupply" },
    stage: { runId: "run-1", snapshotId: "snap-1" },
    sanitizer,
    sandbox,
    maxProbeRuns,
    counter: createProbeCounter(),
  })
  return { registry, sanitizer, sandbox, tools: composeTools(registry, probe) }
}

const probeCall = (callId: string) => ({
  runId: "run-1",
  callId,
  toolName: RunStateProbeToolName,
  arguments: { stateVariables: ["totalSupply"] },
})

const multiProbeCall = (callId: string) => ({
  ...probeCall(callId),
  arguments: { stateVariables: ["totalSupply", "balanceOf(attacker)"] },
})

describe("adjudication step: tier selection and state probe", () => {
  test("run_state_probe is offered only in Tier 2 (no submitter assertions)", () => {
    const names = (hasAssertions: boolean) =>
      setup(hasAssertions)
        .tools.definitions()
        .map((tool) => tool.name)
    expect(names(false)).toContain(RunStateProbeToolName)
    expect(names(true)).not.toContain(RunStateProbeToolName)
    expect(names(true)).toEqual(["read_file", "grep", "glob", "list_dir"])
  })

  test("the third probe with maxProbeRuns = 2 is refused without a sandbox call", async () => {
    const { tools, sandbox, sanitizer, registry } = setup(false, 2)
    const first = await tools.execute(probeCall("probe-1"))
    await tools.execute(probeCall("probe-2"))
    const third = await tools.execute(probeCall("probe-3"))

    expect(first.isError).toBe(false)
    expect(first.content).toContain("| totalSupply | 100 | 250 |")
    expect(sanitizer.probeCalls).toHaveLength(2)
    expect(sandbox.stateProbeCalls).toHaveLength(2)
    expect(sandbox.stateProbeCalls[0]).toMatchObject({ runId: "run-1", snapshotId: "snap-1" })
    expect(third.isError).toBe(true)
    expect(third.content).toContain("limit of 2 state probe runs")
    expect(third.content).toContain("Suggested next step:")
    expect(registry.calls).toHaveLength(0)
  })

  test("a probe request must name exactly one variable", async () => {
    const { tools, sandbox, sanitizer } = setup(false)
    const result = await tools.execute(multiProbeCall("probe-multiple"))
    expect(result.isError).toBe(true)
    expect(result.content).toContain("exactly one")
    expect(sanitizer.probeCalls).toHaveLength(0)
    expect(sandbox.stateProbeCalls).toHaveLength(0)
  })
})

describe("adjudication step: initial context", () => {
  test("pinned items follow the seven-layer order and the case header names run, finding, snapshot and tier", () => {
    const clock = new FakeClock(1_000)
    const random = new SeededRandom(3)
    const { tools } = setup(false)
    const items = buildInitialContext({
      runId: "run-1",
      snapshotId: "snap-1",
      finding: { findingId: "finding-7", reportMarkdown: "# Reentrancy in Vault.withdraw" },
      pocCode: "function testExploit() public { vault.withdraw(1); }",
      bceSlices: [
        { filePath: "src/Vault.sol", content: "function withdraw() {}", lineRange: [10, 20] },
        { filePath: "src/Token.sol", content: "function transfer() {}" },
      ],
      tier: 2,
      maxProbeRuns: 2,
      systemPrompt: "You are the Judge.",
      tools: tools.definitions(),
      shapedTrace: "[PASS] testExploit() (gas: 1234)",
      ids: createIdGenerator({ clock: () => clock.nowMs(), random: (size) => random.bytes(size) }),
    })

    expect(items.map((item) => item.type)).toEqual([
      "system_prompt",
      "tool_description",
      "tool_description",
      "tool_description",
      "tool_description",
      "tool_description",
      "system_prompt",
      "candidate_finding",
      "submitter_poc",
      "bce_sliced_ast",
      "bce_sliced_ast",
      "execution_trace",
    ])
    expect(items.every((item) => item.isPinned && item.turn === 0)).toBe(true)
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
    expect(items[5].content).toContain(RunStateProbeToolName)
    const header = items[6].content
    expect(header).toContain("Case header")
    for (const value of ["runId: run-1", "findingId: finding-7", "snapshotId: snap-1", "tier: 2"])
      expect(header).toContain(value)
    expect(items[9].content).toContain("src/Vault.sol (lines 10-20)")
  })
})
