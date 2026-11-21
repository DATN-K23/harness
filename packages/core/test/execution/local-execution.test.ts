import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLocalExecution } from "@harness/core/execution"

const path = await realpath(process.execPath)
const digest = `sha256:${new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex")}`
let cwd: string

beforeEach(async () => { cwd = await mkdtemp(join(await realpath(tmpdir()), "harness-execution-test-")) })
afterEach(async () => { await rm(cwd, { force: true, recursive: true }) })

const fixture = (code: string, files: string[] = [], pinnedDigest = digest) => {
  const args = ["-e", code]
  const driver = createLocalExecution({ executable: { path, digest: pinnedDigest }, workspace: cwd, args, files })
  return { driver, request: { executable: path, args, cwd, timeoutMs: 5_000, maxOutputBytes: 1_024 } }
}

test("spawns direct argv with explicit environment and captures the owned child's exit", async () => {
  const { driver, request } = fixture('console.log(process.env.HARNESS_TEST_SECRET ?? "unset"); console.error("diagnostic")')
  const previous = process.env.HARNESS_TEST_SECRET
  process.env.HARNESS_TEST_SECRET = "synthetic-canary"
  try {
    const result = await driver.run(request)
    expect(result).toMatchObject({ outcome: "exited", exitCode: 0, stdout: "unset\n", stderr: "diagnostic\n" })
  } finally {
    if (previous === undefined) delete process.env.HARNESS_TEST_SECRET
    else process.env.HARNESS_TEST_SECRET = previous
  }
})

test("rejects modified argv and an unverified artifact before spawn", async () => {
  const { driver, request } = fixture('console.log("executed")')
  expect(await driver.run({ ...request, args: ["-e", "process.exit(3)"] })).toMatchObject({ outcome: "denied", processMs: 0 })
  const wrong = fixture('console.log("executed")', [], `sha256:${"0".repeat(64)}`)
  expect(await wrong.driver.run(wrong.request)).toMatchObject({ outcome: "unavailable", processMs: 0 })
})

test.skipIf(process.platform === "win32")("rejects a staged symlink that resolves outside the workspace", async () => {
  const external = join(cwd, "outside.txt")
  const workspace = await mkdtemp(join(cwd, "workspace-"))
  await writeFile(external, "synthetic-canary")
  await symlink(external, join(workspace, "target"))
  const args = ["-e", 'console.log("executed")']
  const driver = createLocalExecution({ executable: { path, digest }, workspace, args, files: ["target"] })
  const result = await driver.run({ executable: path, args, cwd: workspace, timeoutMs: 5_000, maxOutputBytes: 1_024 })
  expect(result).toMatchObject({ outcome: "denied", processMs: 0, stdout: "" })
})

test("uses a shared byte budget and stops the child on overflow", async () => {
  const { driver, request } = fixture('process.stdout.write("a".repeat(32)); process.stderr.write("b".repeat(32)); setInterval(() => {}, 100)')
  const result = await driver.run({ ...request, maxOutputBytes: 48 })
  expect(result).toMatchObject({ outcome: "output_limit", cleanupConfirmed: true, truncated: true, outputBytes: 48 })
  expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBe(48)
})

test("returns explicit timeout and cancellation outcomes", async () => {
  const { driver, request } = fixture('setInterval(() => {}, 100)')
  expect(await driver.run({ ...request, timeoutMs: 300 })).toMatchObject({ outcome: "timed_out", cleanupConfirmed: true })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort("lease_lost"), 250)
  try {
    expect(await driver.run(request, controller.signal)).toMatchObject({ outcome: "cancelled", cleanupConfirmed: true })
  } finally {
    clearTimeout(timer)
  }
})
