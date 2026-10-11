import type { ContextItem, IngestionResult, SandboxResult, SanitizerResult, StateProbeResult } from "@harness/protocol"
import { ScriptedContextEngine, estimateTokens } from "../testing/fake-context-engines"
import {
  errorResponse,
  textResponse,
  toolCallResponse,
  usageOf,
  type ScriptedModelEntry,
} from "../testing/scripted-model-gateway"
import { demoLimits } from "./fixtures"
import type { ScenarioSpec } from "./world"

const poc = "function testExploit() public { vault.deposit{value: 1 ether}(); attacker.attack(); /* no assertions */ }"

const okIngestion: IngestionResult = {
  kind: "ok",
  pocCode: poc,
  bceSlices: [
    { filePath: "src/Vault.sol", content: "function withdraw(uint256 amount) external { ... }", lineRange: [11, 16] },
  ],
}

const okSanitizer: SanitizerResult = {
  kind: "ok",
  stitchedTestFile: `contract ExploitTest is BaseTest { ${poc} }`,
  hasSubmitterAssertions: false,
  antiCheatReport: {
    rulesChecked: ["vm-ffi", "vm-store", "vm-etch", "modified-target-source"],
    findings: [],
  },
}

const okSandbox: SandboxResult = {
  exitCode: 0,
  trace:
    "[PASS] testExploit() (gas: 214530)\n  Vault::withdraw(1 ether)\n    attacker::receive() -> Vault::withdraw(1 ether)",
  durationMs: 1840,
}

const probe: StateProbeResult = {
  exitCode: 0,
  trace: "[PASS] testExploit() with state probes",
  stateDeltas: [
    { variable: "balanceOf(attacker)", before: "0", after: "3000000000000000000" },
    { variable: "address(vault).balance", before: "10000000000000000000", after: "7000000000000000000" },
  ],
}

export const confirmedVerdict = {
  validity: "valid",
  verificationStatus: "PASS",
  reasonCode: "EXPLOIT_CONFIRMED",
  severity: "HIGH",
  confidence: "HIGH",
  summary: "Vault.withdraw sends ether before it updates the balance, so an attacker drains the vault by re-entering.",
  reasoning:
    "The state probe shows the attacker balance rising by 3 ether while the vault balance falls by the same amount after one deposit of 1 ether. withdraw performs the external call before the balance is decremented, so the receive hook can call withdraw again against the stale balance.",
  classification: { name: "Reentrancy", standardId: "SWC-107" },
  citesEvidence: [
    {
      filePath: "src/Vault.sol",
      startLine: 12,
      endLine: 15,
      explanation:
        "the balance check passes again on re-entry because the decrement on line 15 runs after the call on line 13",
    },
  ],
  report: {
    executiveSummary:
      "A depositor can withdraw several times its balance in one transaction; the exploit PoC runs and the state delta confirms the loss.",
    rootCause:
      "withdraw violates checks-effects-interactions: the low-level call on line 13 precedes the balance update on line 15.",
    attackPath:
      "1. Deposit 1 ether. 2. Call withdraw(1 ether). 3. In receive(), call withdraw(1 ether) again while the balance is unchanged. 4. Repeat until the vault is drained.",
    impact: "Funds of every depositor are at risk; the probe measured 3 ether leaving the vault for a 1 ether deposit.",
    remediation:
      'Update the balance before the external call or add a reentrancy guard.\n```diff\n-        (bool ok, ) = msg.sender.call{value: amount}("");\n-        require(ok, "transfer failed");\n-        balances[msg.sender] -= amount;\n+        balances[msg.sender] -= amount;\n+        (bool ok, ) = msg.sender.call{value: amount}("");\n+        require(ok, "transfer failed");\n```',
  },
}

export const validVerdict = {
  validity: "valid",
  verificationStatus: "PASS",
  reasonCode: "EXPLOIT_CONFIRMED",
  severity: "HIGH",
  confidence: "HIGH",
  summary: "Withdraw lets an attacker drain the vault.",
  reasoning: "The trace shows the attacker balance increasing after reentering withdraw before the state update.",
  citesEvidence: [{ filePath: "src/Vault.sol", startLine: 11, endLine: 16, explanation: "state update after call" }],
}

const call = (id: string, name: string, args: Record<string, unknown>, cost = 0.01): ScriptedModelEntry =>
  toolCallResponse([{ id, name, arguments: args }], { usage: usageOf(100, 20, cost), latencyMs: 400 })

const readVault = (id: string, startLine: number, endLine: number) =>
  call(id, "read_file", { path: "src/Vault.sol", startLine, endLine })

const verdictEntry = (verdict: object = validVerdict): ScriptedModelEntry =>
  textResponse(JSON.stringify(verdict), { usage: usageOf(80, 20, 0.02), latencyMs: 600 })

const transient = (statusCode: number) =>
  errorResponse({ isRetryable: true, category: "transport", message: `HTTP ${statusCode}`, statusCode })

/** Masks the oldest tool result from step 2 on, so the economics report has real savings to show. */
const maskingEngine = () =>
  new ScriptedContextEngine([
    (input) => ({ status: "ready", preparedItems: input.items }),
    (input) => {
      const target = input.items.find((item) => item.type === "tool_result")
      if (target === undefined) return { status: "ready", preparedItems: input.items }
      const note = "[tool output masked: the state delta was already used]"
      const masked: ContextItem = { ...target, content: note }
      return {
        status: "ready",
        preparedItems: input.items.map((item) => (item.id === target.id ? masked : item)),
        transformations: [
          {
            action: "masked",
            targetItemId: target.id,
            tokensBefore: estimateTokens(target.content),
            tokensAfter: estimateTokens(note),
            replacementNote: note,
          },
        ],
      }
    },
  ])

const summarizeUnpinned = (input: { items: ContextItem[] }) => ({
  status: "needs_compaction" as const,
  summaryPrompt: "Summarize the investigation so far.",
  itemsToSummarize: input.items.filter((item) => !item.isPinned),
})

const base = {
  ingestion: okIngestion,
  sanitizer: okSanitizer,
  sandbox: okSandbox,
}

const confirmed: ScenarioSpec = {
  name: "confirmed-exploit",
  ...base,
  stateProbes: [probe],
  engine: maskingEngine,
  script: [
    call("call-1", "run_state_probe", { stateVariables: ["balanceOf(attacker)", "address(vault).balance"] }, 0.012),
    readVault("call-2", 11, 16),
    textResponse(JSON.stringify(confirmedVerdict), { usage: usageOf(1800, 420, 0.03), latencyMs: 2400 }),
  ],
}

const missingPoc: ScenarioSpec = { ...confirmed, name: "missing-poc", ingestion: { kind: "missing_poc" }, script: [] }

const cheatingPoc: ScenarioSpec = {
  ...confirmed,
  name: "cheating-poc",
  sanitizer: {
    kind: "cheat_detected",
    findings: [{ ruleId: "vm-store", message: "vm.store overwrites Vault.balances directly", line: 3 }],
  },
  script: [],
}

const failingPoc: ScenarioSpec = {
  ...confirmed,
  name: "failing-poc",
  sandbox: { exitCode: 1, trace: "[FAIL] testExploit() reverted: Vault: insufficient", durationMs: 920 },
  script: [],
}

/** The four judge scenarios of the demo specification, in presentation order. */
export const demoScenarios: ScenarioSpec[] = [confirmed, missingPoc, cheatingPoc, failingPoc]

const tier1: Pick<ScenarioSpec, "sanitizer"> = {
  sanitizer: { ...okSanitizer, hasSubmitterAssertions: true },
}

const mixed = (name: string, spec: Partial<ScenarioSpec>): ScenarioSpec => ({
  ...base,
  ...tier1,
  name,
  script: [],
  ...spec,
})

/** The stress mixture: the judge scenarios plus every recovery path of the loop, each a distinct kind. */
export const stressScenarios: ScenarioSpec[] = [
  confirmed,
  missingPoc,
  cheatingPoc,
  failingPoc,
  mixed("multi-step-tool-failures", {
    script: [
      call("call-1", "no_such_tool", {}),
      call("call-2", "read_file", { startLine: "one" }),
      call("call-3", "read_file", { path: "secrets/key.txt" }),
      readVault("call-4", 11, 16),
      verdictEntry(),
    ],
  }),
  mixed("retry-then-success", { script: [transient(503), transient(429), verdictEntry()] }),
  mixed("compaction", {
    engine: () =>
      new ScriptedContextEngine([(input) => ({ status: "ready", preparedItems: input.items }), summarizeUnpinned]),
    script: [
      readVault("call-1", 11, 16),
      textResponse("Step 1 read Vault.sol lines 11-16: withdraw sends ether first.", { usage: usageOf(50, 10, 0.005) }),
      verdictEntry(),
    ],
  }),
  mixed("step-limit-forcing", {
    config: { limits: { ...demoLimits, maxSteps: 3 } },
    script: [readVault("call-1", 1, 5), readVault("call-2", 11, 16), verdictEntry()],
  }),
  mixed("schema-repair", {
    script: [
      textResponse(JSON.stringify({ ...validVerdict, reasoning: "short" }), { usage: usageOf(80, 20, 0.02) }),
      verdictEntry(),
    ],
  }),
  mixed("cancellation", { cancelOnPoll: 6, script: [readVault("call-1", 11, 16), verdictEntry()] }),
  mixed("worker-interruption-takeover", {
    interrupt: { atStep: 3, takeoverScript: [verdictEntry()] },
    script: [readVault("call-1", 1, 5), readVault("call-2", 11, 16), verdictEntry()],
  }),
]
