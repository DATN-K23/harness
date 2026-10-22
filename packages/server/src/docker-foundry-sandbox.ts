import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { createHash } from "node:crypto"
import type { SandboxPort, SandboxResult, SourceSnapshotPort, StageInput, StateProbeResult } from "@harness/protocol"

export const FOUNDRY_IMAGE = "ghcr.io/foundry-rs/foundry@sha256:41c5bb8c954d386195a48c2ac22c9eb992d916df96018ac3e4b7d5e569b6e05c"
const OUTPUT_LIMIT = 16_384
const PROCESS_TIMEOUT_MS = 65_000
const SOLC_VERSION = "0.8.30+commit.73712a01.Emscripten.clang"
const NODE_SHA256 = "f15053488b3c49d16eb4b0da25593b459a79839248381f6aa61a876bcce54966"
const SOLC_PACKAGE_SHA256 = "91e0e78adf51cafe33c934f520d644235479775237f76f46f0d047eb636ea546"
const SHIM_SHA256 = "d3f4cc1e6aaf6c86be665fa4ff2fd33e2804935dbe1331d6db9f7032dae20dec"
const DEPS_SHA256 = "6c23481f6ea8aa45fd69b0dade03159e615d4df5df811015900d81529b78548b"

export interface DockerProcess {
  (argv: string[], options: { signal: AbortSignal; timeout: number; maxOutputBytes: number }, control?: (argv: string[]) => unknown): Promise<{
    exitCode: number
    stdout: string
    stderr: string
    timedOut?: boolean
  }>
}

export const spawnDocker: DockerProcess = async (argv, options, control = (args) => Bun.spawnSync(args, { stdout: "ignore", stderr: "ignore" })) => {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/local/bin:/usr/bin:/bin" } })
  const nameIndex = argv.indexOf("--name")
  const containerName = nameIndex >= 0 ? argv[nameIndex + 1] : undefined
  let timedOut = false
  let terminating: Promise<void> | undefined
  const terminate = () => {
    child.kill("SIGKILL")
    if (containerName && !terminating) terminating = (async () => {
      control(["docker", "kill", containerName])
      control(["docker", "rm", "-f", containerName])
    })()
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
    if (containerName) control(["docker", "rm", "-f", containerName])
  }
}

export interface OfflineCompilerArtifacts { readonly root: string }

const verifyArtifacts = async (root: string) => {
  const realRoot = await import("node:fs/promises").then(({ realpath }) => realpath(root))
  if (realRoot !== root) throw new Error("Compiler root must be an absolute canonical path")
  const paths = {
    node: join(realRoot, "node-v22.14.0", "bin", "node"),
    solc: join(realRoot, "solc-0.8.30"),
    shim: join(realRoot, "solc-shim.sh"),
    deps: join(realRoot, "node_modules"),
  }
  for (const [path, digest] of [[paths.node, NODE_SHA256], [paths.shim, SHIM_SHA256]] as const) {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || createHash("sha256").update(await readFile(path)).digest("hex") !== digest) throw new Error("Pinned compiler artifact invalid")
  }
  if (paths.solc !== join(realRoot, "solc-0.8.30")) throw new Error("Compiler artifact path mismatch")
  const solcStat = await lstat(paths.solc)
  if (!solcStat.isDirectory() || solcStat.isSymbolicLink()) throw new Error("Compiler package must be a real directory")
  const walk = async (dir: string, dirRoot: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true })
    const rows: string[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) throw new Error("Compiler dependencies cannot contain symlinks")
      if (entry.isDirectory()) rows.push(...await walk(path, dirRoot))
      else if (entry.isFile()) rows.push(`${path.slice(dirRoot.length + 1)} ${createHash("sha256").update(await readFile(path)).digest("hex")}`)
      else throw new Error("Unsupported compiler dependency artifact")
    }
    return rows
  }
  const deps = await lstat(paths.deps)
  if (!deps.isDirectory() || deps.isSymbolicLink()) throw new Error("Pinned dependency directory invalid")
  const depEntries = await readdir(paths.deps)
  if (depEntries.some((name) => name.startsWith("."))) throw new Error("Unexpected compiler dependency entry")
  const depsHash = createHash("sha256").update((await walk(paths.deps, paths.deps)).join("\n")).digest("hex")
  if (depsHash !== DEPS_SHA256) throw new Error(`Pinned dependency digest mismatch: ${depsHash}`)
  const solcHash = createHash("sha256").update((await walk(paths.solc, paths.solc)).join("\n")).digest("hex")
  if (solcHash !== SOLC_PACKAGE_SHA256) throw new Error(`Pinned solc package digest mismatch: ${solcHash}`)
  const shimStat = await lstat(paths.shim)
  if ((shimStat.mode & 0o111) === 0) throw new Error("solc shim is not executable")
  return paths
}

/** Local opt-in runner; source contents are read only through the immutable snapshot port. */
export class DockerFoundrySandbox implements SandboxPort {
  constructor(
    private readonly process: DockerProcess,
    private readonly snapshots: SourceSnapshotPort,
    private readonly compiler: OfflineCompilerArtifacts,
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
    if (!this.validTestPath(testPath) || !testFile.trim() || !/\bfunction\s+test\w*\s*\(/.test(testFile) || Buffer.byteLength(testFile) > OUTPUT_LIMIT * 4) return failed("setup_failed", "Invalid or oversized test input")
    let artifacts: Awaited<ReturnType<typeof verifyArtifacts>>
    try { artifacts = await verifyArtifacts(this.compiler.root) } catch (error) { return failed("setup_failed", `Trusted offline compiler artifacts are missing or modified: ${String(error)}`) }
    const root = await mkdtemp(join(this.options.tempRoot ?? tmpdir(), "harness-poc-"))
    const snapshot = join(root, "snapshot")
    const scratch = join(root, "scratch")
    try {
      await mkdir(join(snapshot, "src"), { recursive: true })
      await mkdir(join(snapshot, "test"), { recursive: true })
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
      const compilerVersion = await this.verifyCompiler(signal)
      if (!compilerVersion) return failed("setup_failed", "Pinned offline Node/solc-js compiler is unavailable or mismatched")

      const containerName = `harness-${crypto.randomUUID()}`
      const argv = [
        "docker", "run", "--rm", "--name", containerName,
        "--network=none", "--read-only", "--user", "10001:10001", "--cap-drop=ALL",
        "--security-opt=no-new-privileges", "--memory=1024m", "--cpus=1", "--pids-limit=64",
        "--mount", `type=bind,src=${snapshot},dst=/workspace,readonly`,
        "--mount", `type=bind,src=${artifacts.node},dst=/usr/local/bin/node,readonly`,
        "--mount", `type=bind,src=${artifacts.solc},dst=/opt/solc,readonly`,
        "--mount", `type=bind,src=${artifacts.deps},dst=/opt/node_modules,readonly`,
        "--mount", `type=bind,src=${artifacts.shim},dst=/usr/local/bin/solc,readonly`,
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m",
        "--tmpfs", "/scratch:rw,nosuid,size=256m",
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
      const expectedTests = [...testFile.matchAll(/\bfunction\s+(test\w*)\s*\(/g)].map((match) => match[1]!)
      if (!expectedTests.length) return failed("setup_failed", "Test input defines no named test functions", output.exitCode)
      const passedTests = [...text.matchAll(/\[PASS\]\s+(test\w*)\s*\(/g)].map((match) => match[1]!)
      const failedTests = [...text.matchAll(/\[FAIL(?::[^\]]*)?\]\s+(test\w*)\s*\(/g)].map((match) => match[1]!)
      const failedExpectedTests = failedTests.filter((name) => expectedTests.includes(name))
      if (output.exitCode !== 0 && failedExpectedTests.length) return { outcome: "assertion_failed", exitCode: output.exitCode, trace: text, durationMs }
      if (output.exitCode === 0 && expectedTests.every((name) => passedTests.includes(name))) return { outcome: "passed", exitCode: 0, trace: text, durationMs }
      if (failedTests.some((name) => expectedTests.includes(name))) return { outcome: "assertion_failed", exitCode: output.exitCode, trace: text, durationMs }
      if (output.exitCode === 0) return failed("setup_failed", "Forge did not report every expected named test as passed", output.exitCode)
      return { ...failed("infrastructure_failed", text, output.exitCode), durationMs }
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async verifyCompiler(signal?: AbortSignal): Promise<boolean> {
    try {
      const artifacts = await verifyArtifacts(this.compiler.root)
      const probeName = `harness-compiler-${crypto.randomUUID()}`
      const output = await this.process([
        "docker", "run", "--rm", "--name", probeName,
        "--network=none", "--read-only", "--user", "10001:10001",
        "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=512m", "--cpus=1", "--pids-limit=32",
        "--mount", `type=bind,src=${artifacts.node},dst=/usr/local/bin/node,readonly`,
        "--mount", `type=bind,src=${artifacts.solc},dst=/opt/solc,readonly`,
        "--mount", `type=bind,src=${artifacts.deps},dst=/opt/node_modules,readonly`,
        "--mount", `type=bind,src=${artifacts.shim},dst=/usr/local/bin/solc,readonly`,
        FOUNDRY_IMAGE, "solc --version",
      ], { signal: signal ?? new AbortController().signal, timeout: 10_000, maxOutputBytes: 1024 })
      if (output.timedOut) return false
      return output.exitCode === 0 && output.stdout.includes(`Version: ${SOLC_VERSION}`)
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
