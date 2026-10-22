import { describe, expect, mock, test } from "bun:test"
import { InMemorySnapshot } from "@harness/core"
import { DockerFoundrySandbox, FOUNDRY_IMAGE, spawnDocker, type DockerProcess } from "../src/docker-foundry-sandbox"

const compiler = { root: `${Bun.env.HOME}/Library/Caches/harness-task5/artifacts` }

describe("DockerFoundrySandbox", () => {
  test("fails closed when the offline compiler version is unverified", async () => {
    const process = mock(async (_argv: string[], _options: unknown) => ({ exitCode: 0, stdout: "0.8.31", stderr: "" }))
    const sandbox = new DockerFoundrySandbox(process, new InMemorySnapshot({ snapshotId: "s", files: { "src/V.sol": "contract V {}" } }), { root: "/untrusted-root" }, { enabled: true })
    const result = await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "contract T {}" })
    expect(result.outcome).toBe("setup_failed")
    expect(process).not.toHaveBeenCalled()
    expect(FOUNDRY_IMAGE).toBe("ghcr.io/foundry-rs/foundry@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c")
  })

  test("honors cancellation before any process launch", async () => {
    const process = mock(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
    const sandbox = new DockerFoundrySandbox(process, new InMemorySnapshot({ snapshotId: "s", files: {} }), compiler, { enabled: true })
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
        return calls === 1 ? { exitCode: 0, stdout: "solc, the solidity compiler commandline interface\nVersion: 0.8.30+commit.73712a01.Emscripten.clang\n", stderr: "" } : result
      })
      const sandbox = new DockerFoundrySandbox(process as unknown as DockerProcess, new InMemorySnapshot({ snapshotId: "s", files: { "src/V.sol": "contract V {}" } }), compiler, { enabled: true })
      const output = await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "contract Test { function testIt() public { assert(true); } }" })
      const argv = process.mock.calls.at(-1)?.[0] ?? []
      for (const flag of ["--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=1024m", "--cpus=1", "--pids-limit=64"]) expect(argv).toContain(flag)
      expect(argv).toContain(FOUNDRY_IMAGE)
      expect(argv.some((arg) => arg.includes("dst=/workspace,readonly"))).toBe(true)
      expect(argv.some((arg) => arg.includes("docker.sock"))).toBe(false)
      expect(argv).toContain("--tmpfs")
      expect(argv).toContain("/scratch:rw,nosuid,size=256m")
      expect(argv.some((arg) => arg.includes("dst=/scratch"))).toBe(false)
      expect(argv.some((arg) => arg.includes("--cache-path /scratch/cache --out /scratch/out"))).toBe(true)
      expect(argv.some((arg) => arg.includes("dst=/workspace,readonly"))).toBe(true)
      return output
    }
    expect((await run({ exitCode: 1, stdout: "[FAIL] testIt()", stderr: "" })).outcome).toBe("assertion_failed")
    expect((await run({ exitCode: 1, stdout: "Compiler run failed", stderr: "" })).outcome).toBe("setup_failed")
    expect((await run({ exitCode: 125, stdout: "", stderr: "daemon error" })).outcome).toBe("infrastructure_failed")
    expect((await run({ exitCode: 137, stdout: "", stderr: "", timedOut: true })).outcome).toBe("timed_out")
  })

  test("does not count empty, missing, or mis-targeted Forge output as a pass", async () => {
    for (const stdout of ["", "No tests found", "Ran 1 test for test/Poc.t.sol\n[PASS] testDifferent() (gas: 1)"]) {
      let calls = 0
      const process = mock(async (_argv: string[], _options: unknown) => {
        calls++
        return calls === 1
          ? { exitCode: 0, stdout: "Version: 0.8.30+commit.73712a01.Emscripten.clang", stderr: "" }
          : { exitCode: 0, stdout, stderr: "" }
      })
      const sandbox = new DockerFoundrySandbox(process as unknown as DockerProcess, new InMemorySnapshot({ snapshotId: "s", files: { "src/V.sol": "contract V {}" } }), compiler, { enabled: true })
      expect((await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "contract T { function testPass() public pure { assert(true); } }" })).outcome).not.toBe("passed")
    }
  })

  test("rejects empty test source before compiler or Docker process", async () => {
    const process = mock(async (_argv: string[], _options: unknown) => ({ exitCode: 0, stdout: "", stderr: "" }))
    const sandbox = new DockerFoundrySandbox(process as unknown as DockerProcess, new InMemorySnapshot({ snapshotId: "s", files: { "src/V.sol": "contract V {}" } }), compiler, { enabled: true })
    expect((await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: " \n " })).outcome).toBe("setup_failed")
    expect(process).not.toHaveBeenCalled()
  })

  test("compiler probe names its container and kills/removes it on timeout or cancellation", async () => {
    const controller = new AbortController()
    let calls = 0
    const process = mock(async (argv: string[], _options: { signal: AbortSignal; timeout: number; maxOutputBytes: number }) => {
      calls++
      if (calls === 1) return { exitCode: 0, stdout: "", stderr: "", timedOut: true }
      return { exitCode: 125, stdout: "", stderr: "" }
    })
    const sandbox = new DockerFoundrySandbox(process as unknown as DockerProcess, new InMemorySnapshot({ snapshotId: "s", files: { "src/V.sol": "contract V {}" } }), compiler, { enabled: true })
    const result = await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "contract T { function testPass() public pure { assert(true); } }" }, controller.signal)
    expect(result.outcome).toBe("setup_failed")
    const probeArgv = process.mock.calls[0]![0]
    expect(probeArgv).toContain("--name")
    expect(process).toHaveBeenCalledTimes(1)
    expect(probeArgv.at(-1)).toBe("solc --version")
    expect(probeArgv).toContain("--rm")
  })

  test("spawnDocker kills and removes the named container when its process times out", async () => {
    const cleanup: string[][] = []
    const result = await spawnDocker(
      [process.execPath, "-e", "await new Promise(() => {})", "--name", "probe-timeout"],
      { signal: new AbortController().signal, timeout: 20, maxOutputBytes: 1024 },
      (argv) => { cleanup.push(argv) },
    )
    expect(result.timedOut).toBe(true)
    expect(cleanup).toContainEqual(["docker", "kill", "probe-timeout"])
    expect(cleanup).toContainEqual(["docker", "rm", "-f", "probe-timeout"])
  })

  test("spawnDocker kills and removes the named container on cancellation", async () => {
    const cleanup: string[][] = []
    const controller = new AbortController()
    const running = spawnDocker(
      [process.execPath, "-e", "await new Promise(() => {})", "--name", "probe-cancel"],
      { signal: controller.signal, timeout: 30_000, maxOutputBytes: 1024 },
      (argv) => { cleanup.push(argv) },
    )
    controller.abort()
    await running
    expect(cleanup).toContainEqual(["docker", "kill", "probe-cancel"])
    expect(cleanup).toContainEqual(["docker", "rm", "-f", "probe-cancel"])
  })

  test("spawnDocker handles a signal already aborted at process entry", async () => {
    const cleanup: string[][] = []
    const controller = new AbortController()
    controller.abort()
    const result = await spawnDocker(
      [process.execPath, "-e", "await new Promise(() => {})", "--name", "probe-pre-aborted"],
      { signal: controller.signal, timeout: 30_000, maxOutputBytes: 1024 },
      (argv) => { cleanup.push(argv) },
    )
    expect(cleanup).toContainEqual(["docker", "kill", "probe-pre-aborted"])
    expect(cleanup).toContainEqual(["docker", "rm", "-f", "probe-pre-aborted"])
    expect(result.timedOut).toBe(false)
    expect(result.exitCode).not.toBe(0)
  })

  test("rejects unsafe snapshot paths before Docker launch", async () => {
    const process = mock(async (_argv: string[], _options: unknown) => ({ exitCode: 0, stdout: "", stderr: "" }))
    const sandbox = new DockerFoundrySandbox(process as unknown as DockerProcess, {
      listFiles: async () => ["../secret.sol"],
      readLines: async () => ({ kind: "not_found" }),
    }, compiler, { enabled: true })
    expect((await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "contract T {}" })).outcome).toBe("setup_failed")
    expect(process).not.toHaveBeenCalled()
  })

  test("rejects outside-root and secret-bearing compiler roots before Docker", async () => {
    const process = mock(async (_argv: string[], _options: unknown) => ({ exitCode: 0, stdout: "", stderr: "" }))
    const snapshot = new InMemorySnapshot({ snapshotId: "s", files: { "src/V.sol": "contract V {}" } })
    for (const root of ["/outside/root", "/Users/person/.ssh"]) {
      const sandbox = new DockerFoundrySandbox(process as unknown as DockerProcess, snapshot, { root }, { enabled: true })
      expect((await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "contract T { function testX() public {} }" })).outcome).toBe("setup_failed")
    }
    expect(process).not.toHaveBeenCalled()
  })

  test("rejects a secret file in the pinned solc mount directory before Docker", async () => {
    if (!Bun.env.TASK5_ARTIFACT_ROOT) return
    const fs = await import("node:fs/promises")
    const root = `${Bun.env.TASK5_ARTIFACT_ROOT}/solc-0.8.30`
    const secret = `${root}/private-key.pem`
    await fs.writeFile(secret, "DO NOT MOUNT")
    try {
      const process = mock(async (_argv: string[], _options: unknown) => ({ exitCode: 0, stdout: "", stderr: "" }))
      const sandbox = new DockerFoundrySandbox(process as unknown as DockerProcess, new InMemorySnapshot({ snapshotId: "s", files: { "src/V.sol": "contract V {}" } }), compiler, { enabled: true })
      expect((await sandbox.runSingleShot({ runId: "r", snapshotId: "s", testFile: "contract T { function testX() public {} }" })).outcome).toBe("setup_failed")
      expect(process).not.toHaveBeenCalled()
    } finally { await fs.rm(secret) }
  })

  test("actually runs offline Foundry benign and assertion fixtures when explicitly enabled", async () => {
    if (!Bun.env.TASK5_ARTIFACT_ROOT) return
    const sandbox = new DockerFoundrySandbox(spawnDocker, new InMemorySnapshot({ snapshotId: "integration", files: { "src/Target.sol": "pragma solidity ^0.8.0; contract Target {}" } }), {
      root: Bun.env.TASK5_ARTIFACT_ROOT,
    }, { enabled: true })
    const pass = await sandbox.runSingleShot({ runId: "integration-pass", snapshotId: "integration", testFile: "pragma solidity ^0.8.0; contract T { function testPass() public pure { assert(true); } }" })
    if (pass.outcome !== "passed") throw new Error(`benign test result: ${JSON.stringify(pass)}`)
    const fail = await sandbox.runSingleShot({ runId: "integration-fail", snapshotId: "integration", testFile: "pragma solidity ^0.8.0; contract T { function testExploit() public pure { assert(false); } }" })
    if (fail.outcome !== "assertion_failed") throw new Error(`assertion test result: ${JSON.stringify(fail)}`)
  }, 180_000)
})
