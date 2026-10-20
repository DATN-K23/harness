import {
  DefaultRetryConfig,
  type BudgetLimits,
  type CandidateFinding,
  type ContextPolicy,
  type ResolvedFlags,
} from "@harness/protocol"
import type { JudgeRunConfig, JudgeRunInput } from "../runner/judge-runner"

export const vaultSource = [
  "// SPDX-License-Identifier: MIT",
  "pragma solidity ^0.8.20;",
  "",
  "contract Vault {",
  "    mapping(address => uint256) public balances;",
  "",
  "    function deposit() external payable {",
  "        balances[msg.sender] += msg.value;",
  "    }",
  "",
  "    function withdraw(uint256 amount) external {",
  '        require(balances[msg.sender] >= amount, "insufficient");',
  '        (bool ok, ) = msg.sender.call{value: amount}("");',
  '        require(ok, "transfer failed");',
  "        balances[msg.sender] -= amount;",
  "    }",
  "",
  "    function totalAssets() external view returns (uint256) {",
  "        return address(this).balance;",
  "    }",
  "}",
  "",
].join("\n")

export const snapshotFiles = {
  "src/Vault.sol": vaultSource,
  "secrets/key.txt": "not-a-real-secret\n",
}

export const DemoSnapshotId = "snap-demo"

export const demoFinding: CandidateFinding = {
  findingId: "finding-7",
  reportMarkdown: "## Reentrancy in Vault.withdraw\nThe attacker re-enters withdraw before balances are updated.",
}

export const demoPolicy: ContextPolicy = {
  policyVersion: "demo-policy-1",
  windowLimitTokens: 100_000,
  outputReserveTokens: 4_000,
  compactionThreshold: 0.8,
  safetyMarginFactor: 1.2,
  recentWindowTokens: 10_000,
  toolOutputMaxTokens: 4_000,
  toolOutputMaxLines: 50,
  maxCompactions: 2,
  flags: {
    enableToolTruncation: true,
    enableObsMasking: true,
    enableSupersedeReads: true,
    enableDropEmpty: true,
    enableLlmCompaction: true,
    enableSessionNote: false,
  },
}

export const demoFlags: ResolvedFlags = {
  ...demoPolicy.flags,
  enableSchemaRepair: true,
  enableMaxStepsForcing: true,
  enableNoProgressDetection: true,
  enableInfraRetry: true,
  enableParallelToolDispatch: true,
}

export const demoLimits: BudgetLimits = {
  wallClockTimeoutMs: 3_600_000,
  totalTokenBudget: 1_000_000,
  maxSteps: 10,
  noProgressMaxRepeats: 3,
}

export const demoConfig: JudgeRunConfig = {
  flags: demoFlags,
  policy: demoPolicy,
  retry: DefaultRetryConfig,
  limits: demoLimits,
  modelLimits: { maxContextTokens: 128_000, maxOutputTokens: 4_000, safetyMarginFactor: 1.1 },
  profileId: "profile-demo",
}

export const demoInput = (config: Partial<JudgeRunConfig> = {}): JudgeRunInput => ({
  finding: demoFinding,
  snapshotId: DemoSnapshotId,
  config: { ...demoConfig, ...config },
})
