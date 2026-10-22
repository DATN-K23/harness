import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import type { SandboxPort, SandboxResult, SourceSnapshotPort, StageInput, StateProbeResult } from "@harness/protocol"

export const FOUNDRY_IMAGE = "ghcr.io/foundry-rs/foundry@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c"
const OUTPUT_LIMIT = 16_384
const PROCESS_TIMEOUT_MS = 65_000
const SOLC_VERSION = "0.8.30+commit.73712a01.Emscripten.clang"

export interface DockerProcess {
  (argv: string[], options: { signal: AbortSignal; timeout: number; maxOutputBytes: number }): Promise<{
    exitCode: number
    stdout: string
    stderr: string
    timedOut?: boolean
  }>
}

export const spawnDocker: DockerProcess = async (argv, options) => {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/local/bin:/usr/bin:/bin" } })
  const nameIndex = argv.indexOf("--name")
  const containerName = nameIndex >= 0 ? argv[nameIndex + 1] : undefined
  let timedOut = false
  const terminate = () => {
    child.kill("SIGKILL")
    if (containerName) Bun.spawn(["docker", "kill", containerName], { stdout: "ignore", stderr: "ignore" })
  }
  let outputExceeded = false
  const abort = () => terminate()
  options.signal.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => { timedOut = true; terminate() }, options.timeout)
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (size < options.maxOutputBytes) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = value.subarray(0, options.maxOutputBytes - size)
      chunks.push(chunk)
      size += chunk.length
    }
    if (size >= options.maxOutputBytes) { outputExceeded = true; terminate() }
    return new TextDecoder().decode(Buffer.concat(chunks))
  }
  try {
    const [stdout, stderr, exitCode] = await Promise.all([read(child.stdout), read(child.stderr), child.exited])
    if (exitCode !== 0 && containerName && !timedOut && !options.signal.aborted) {
      const probe = Bun.spawnSync(["docker", "inspect", "-f", "{{.State.OOMKilled}}", containerName], { stdout: "pipe", stderr: "ignore" })
      if (probe.stdout.toString().trim() === "true") return { exitCode, stdout, stderr: `${stderr}\ncontainer exceeded resource limits`, timedOut: true }
    }
    return { exitCode, stdout, stderr: outputExceeded ? `${stderr}\ncontainer output exceeded limit` : stderr, timedOut }
  } finally {
    clearTimeout(timer)
    options.signal.removeEventListener("abort", abort)
  }
}

export interface OfflineCompilerMounts {
  nodeBinary: string
  solcJsRoot: string
  dependencyRoot: string
  solcShim: string
}

/** Local opt-in runner; source contents are read only through the immutable snapshot port. */
export class DockerFoundrySandbox implements SandboxPort {
  constructor(
    private readonly process: DockerProcess,
    private readonly snapshots: SourceSnapshotPort,
    private readonly compiler: OfflineCompilerMounts,
    private readonly options: { enabled?: boolean; tempRoot?: string } = {},
  ) {}

  async runSingleShot(input: StageInput & { testFile: string }, signal?: AbortSignal): Promise<SandboxResult> {
    return this.run(input, input.testFile, "Poc.t.sol", signal)
  }

  async runStateProbe(input: StageInput & { probedTestFile: string }, signal?: AbortSignal): Promise<StateProbeResult> {
    const result = await this.run(input, input.probedTestFile, "Probe.t.sol", signal)
    return { ...result, stateDeltas: [] }
  }

  private async run(input: StageInput, testFile: string, testPath: string, signal?: AbortSignal): Promise<SandboxResult> {
    signal?.throwIfAborted()
    if (!this.options.enabled) return failed("setup_failed", "PoC runtime is disabled")
    if (!this.validTestPath(testPath) || Buffer.byteLength(testFile) > OUTPUT_LIMIT * 4) return failed("setup_failed", "Invalid or oversized test input")
    const root = await mkdtemp(join(this.options.tempRoot ?? tmpdir(), "harness-poc-"))
    const snapshot = join(root, "snapshot")
    const scratch = join(root, "scratch")
    try {
      await mkdir(join(snapshot, "src"), { recursive: true })
      await mkdir(join(snapshot, "test"), { recursive: true })
      await mkdir(scratch)
      await chmod(scratch, 0o777)
      const files = await this.snapshots.listFiles({ snapshotId: input.snapshotId }, signal)
      if (!files.length || files.length > 256) return failed("setup_failed", "Snapshot file count is outside bounds")
      let snapshotBytes = 0
      for (const file of files) {
        const path = safeSnapshotPath(file)
        if (!path) return failed("setup_failed", "Snapshot contains an unsafe path")
        if (!path.endsWith(".sol")) continue
        if (path === "test/Poc.t.sol" || path === "test/Probe.t.sol") return failed("setup_failed", "Snapshot conflicts with the isolated test file")
        const endLine = await this.lineCount(input.snapshotId, file, signal)
        if (endLine < 1 || endLine > 20_000) return failed("setup_failed", "Snapshot file exceeds line limit")
        const result = await this.snapshots.readLines({ snapshotId: input.snapshotId, path: file, startLine: 1, endLine }, signal)
        if (result.kind !== "ok") return failed("setup_failed", "Snapshot file could not be read")
        const content = result.lines.join("\n")
        if (Buffer.byteLength(content) > 1_000_000) return failed("setup_failed", "Snapshot file exceeds size limit")
        snapshotBytes += Buffer.byteLength(content)
        if (snapshotBytes > 8_000_000) return failed("setup_failed", "Snapshot exceeds total Solidity byte limit")
        const destination = resolve(snapshot, path)
        if (!destination.startsWith(`${snapshot}${sep}`)) return failed("setup_failed", "Snapshot path escapes staging root")
        await mkdir(join(destination, ".."), { recursive: true })
        await writeFile(destination, content, { flag: "wx", mode: 0o444 })
      }
      await writeFile(join(snapshot, "test", testPath), testFile, { flag: "wx", mode: 0o444 })
      if (!await this.verifyCompiler(signal)) return failed("setup_failed", "Pinned offline Node/solc-js compiler is unavailable or mismatched")

      const containerName = `harness-${crypto.randomUUID()}`
      const argv = [
        "docker", "run", "--rm", "--name", containerName,
        "--network=none", "--read-only", "--user", "10001:10001", "--cap-drop=ALL",
        "--security-opt=no-new-privileges", "--memory=1024m", "--cpus=1", "--pids-limit=64",
        "--mount", `type=bind,src=${snapshot},dst=/workspace,readonly`,
        "--mount", `type=bind,src=${scratch},dst=/scratch`,
        "--mount", `type=bind,src=${this.compiler.nodeBinary},dst=/usr/local/bin/node,readonly`,
        "--mount", `type=bind,src=${this.compiler.solcJsRoot},dst=/opt/solc,readonly`,
        "--mount", `type=bind,src=${this.compiler.dependencyRoot},dst=/opt/node_modules,readonly`,
        "--mount", `type=bind,src=${this.compiler.solcShim},dst=/usr/local/bin/solc,readonly`,
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m",
        "-e", "PATH=/usr/local/bin:/usr/bin:/bin", "-e", "NODE_PATH=/opt/node_modules",
        FOUNDRY_IMAGE,
        `forge test --offline --use /usr/local/bin/solc --root /workspace --cache-path /scratch/cache --out /scratch/out --match-path test/${testPath}`,
      ]
      let output: Awaited<ReturnType<DockerProcess>>
      const startedAt = Date.now()
      try {
        output = await this.process(argv, { signal: signal ?? new AbortController().signal, timeout: PROCESS_TIMEOUT_MS, maxOutputBytes: OUTPUT_LIMIT })
      } catch (error) {
        if (signal?.aborted) throw error
        return failed("infrastructure_failed", "Docker process failed")
      }
      signal?.throwIfAborted()
      const durationMs = Date.now() - startedAt
      if (output.timedOut) return failed("timed_out", output.stderr)
      const text = `${output.stdout}\n${output.stderr}`.slice(0, OUTPUT_LIMIT)
      if (/Compiler run failed|Error \(\d+\):|failed to obtain solc|compiler version .* does not match|^Error:/im.test(text)) return failed("setup_failed", text)
      if (/container (?:output exceeded limit|exceeded resource limits)/i.test(text)) return failed("timed_out", text)
      if (output.exitCode === 0) return { outcome: "passed", exitCode: 0, trace: text, durationMs }
      if (/\[FAIL:|test failed|assertion failed/i.test(text)) return { outcome: "assertion_failed", exitCode: output.exitCode, trace: text, durationMs }
      return { ...failed("infrastructure_failed", text, output.exitCode), durationMs }
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async verifyCompiler(signal?: AbortSignal): Promise<boolean> {
    try {
      const output = await this.process([
        "docker", "run", "--rm", "--network=none", "--read-only", "--user", "10001:10001",
        "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=512m", "--cpus=1", "--pids-limit=32",
        "--mount", `type=bind,src=${this.compiler.nodeBinary},dst=/usr/local/bin/node,readonly`,
        "--mount", `type=bind,src=${this.compiler.solcJsRoot},dst=/opt/solc,readonly`,
        "--mount", `type=bind,src=${this.compiler.dependencyRoot},dst=/opt/node_modules,readonly`,
        FOUNDRY_IMAGE, "node /opt/solc/solc.js --version",
      ], { signal: signal ?? new AbortController().signal, timeout: 10_000, maxOutputBytes: 1024 })
      return output.exitCode === 0 && output.stdout.trim() === SOLC_VERSION
    } catch (error) {
      if (signal?.aborted) throw error
      return false
    }
  }

  private async lineCount(snapshotId: string, path: string, signal?: AbortSignal): Promise<number> {
    let low = 1
    let high = 20_000
    let found = 0
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const result = await this.snapshots.readLines({ snapshotId, path, startLine: 1, endLine: mid }, signal)
      if (result.kind === "ok") { found = mid; low = mid + 1 }
      else if (result.kind === "out_of_range") { high = Math.min(high, result.lineCount); found = result.lineCount; low = mid + 1 }
      else return 0
    }
    return found
  }

  private validTestPath(path: string): boolean {
    return path === "Poc.t.sol" || path === "Probe.t.sol"
  }
}

const safeSnapshotPath = (path: string): string | undefined => {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return
  return path
}

const failed = (outcome: SandboxResult["outcome"], trace: string, exitCode = -1): SandboxResult => ({
  outcome, exitCode, trace: trace.slice(0, OUTPUT_LIMIT), durationMs: 0,
})
