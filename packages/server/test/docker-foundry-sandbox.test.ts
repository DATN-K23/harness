import { describe, expect, mock, test } from "bun:test"
import { InMemorySnapshot } from "@harness/core"
import { DockerFoundrySandbox, FOUNDRY_IMAGE, spawnDocker, type DockerProcess } from "../src/docker-foundry-sandbox"

describe("DockerFoundrySandbox", () => {
  test("fails closed when the offline compiler version is unverified", async () => {
    const process = mock(async (_argv: string[], _options: unknown) => ({ exitCode: 0, stdout: "0.8.31", stderr: "" }))
    const sandbox = new DockerFoundrySandbox(process, new InMemorySnapshot({ snapshotId: "s", files: { "src/V.sol": "contract V {}" } }), { nodeBinary: "/n", solcJsRoot: "/s", dependencyRoot: "/d", solcShim: "/shim" }, { enabled: true })
    const result = await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "contract T {}" })
    expect(result.outcome).toBe("setup_failed")
    expect(process).toHaveBeenCalledTimes(1)
    expect(process.mock.calls[0]?.[0]).toContain("--network=none")
    expect(FOUNDRY_IMAGE).toBe("ghcr.io/foundry-rs/foundry@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c")
  })

  test("honors cancellation before any process launch", async () => {
    const process = mock(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
    const sandbox = new DockerFoundrySandbox(process, new InMemorySnapshot({ snapshotId: "s", files: {} }), { nodeBinary: "/n", solcJsRoot: "/s", dependencyRoot: "/d", solcShim: "/shim" }, { enabled: true })
    const controller = new AbortController()
    controller.abort()
    await expect(sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "" }, controller.signal)).rejects.toThrow()
    expect(process).not.toHaveBeenCalled()
  })

  test("uses exact hardened Docker argv and maps assertion/setup/infra/timeout results", async () => {
    const run = async (result: { exitCode: number; stdout: string; stderr: string; timedOut?: boolean }) => {
      let calls = 0
      const process = mock(async (_argv: string[], _options: unknown) => {
        calls++
        return calls === 1 ? { exitCode: 0, stdout: "0.8.30+commit.73712a01.Emscripten.clang\n", stderr: "" } : result
      })
      const sandbox = new DockerFoundrySandbox(process as unknown as DockerProcess, new InMemorySnapshot({ snapshotId: "s", files: { "src/V.sol": "contract V {}" } }), { nodeBinary: "/node", solcJsRoot: "/solc", dependencyRoot: "/deps", solcShim: "/shim" }, { enabled: true })
      const output = await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "contract Test { function testIt() public { assert(true); } }" })
      const argv = process.mock.calls.at(-1)?.[0] ?? []
      for (const flag of ["--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=1024m", "--cpus=1", "--pids-limit=64"]) expect(argv).toContain(flag)
      expect(argv).toContain(FOUNDRY_IMAGE)
      expect(argv.some((arg) => arg.includes("dst=/workspace,readonly"))).toBe(true)
      expect(argv.some((arg) => arg.includes("docker.sock"))).toBe(false)
      return output
    }
    expect((await run({ exitCode: 1, stdout: "[FAIL: assertion failed]", stderr: "" })).outcome).toBe("assertion_failed")
    expect((await run({ exitCode: 1, stdout: "Compiler run failed", stderr: "" })).outcome).toBe("setup_failed")
    expect((await run({ exitCode: 125, stdout: "", stderr: "daemon error" })).outcome).toBe("infrastructure_failed")
    expect((await run({ exitCode: 137, stdout: "", stderr: "", timedOut: true })).outcome).toBe("timed_out")
  })

  test("rejects unsafe snapshot paths before Docker launch", async () => {
    const process = mock(async (_argv: string[], _options: unknown) => ({ exitCode: 0, stdout: "", stderr: "" }))
    const sandbox = new DockerFoundrySandbox(process as unknown as DockerProcess, {
      listFiles: async () => ["../secret.sol"],
      readLines: async () => ({ kind: "not_found" }),
    }, { nodeBinary: "/node", solcJsRoot: "/solc", dependencyRoot: "/deps", solcShim: "/shim" }, { enabled: true })
    expect((await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "contract T {}" })).outcome).toBe("setup_failed")
    expect(process).not.toHaveBeenCalled()
  })

  test("actually runs offline Foundry benign and assertion fixtures when explicitly enabled", async () => {
    const required = ["TASK5_NODE", "TASK5_SOLC", "TASK5_DEPS", "TASK5_SHIM"] as const
    if (required.some((name) => !Bun.env[name])) return
    const sandbox = new DockerFoundrySandbox(spawnDocker, new InMemorySnapshot({ snapshotId: "integration", files: { "src/Target.sol": "pragma solidity ^0.8.0; contract Target {}" } }), {
      nodeBinary: Bun.env.TASK5_NODE!, solcJsRoot: Bun.env.TASK5_SOLC!, dependencyRoot: Bun.env.TASK5_DEPS!, solcShim: Bun.env.TASK5_SHIM!,
    }, { enabled: true })
    const pass = await sandbox.runSingleShot({ runId: "integration-pass", snapshotId: "integration", testFile: "pragma solidity ^0.8.0; contract T { function testPass() public pure { assert(true); } }" })
    expect(pass.outcome).toBe("passed")
    const fail = await sandbox.runSingleShot({ runId: "integration-fail", snapshotId: "integration", testFile: "pragma solidity ^0.8.0; contract T { function testFail() public pure { assert(false); } }" })
    expect(fail.outcome).toBe("assertion_failed")
  }, 180_000)
})
