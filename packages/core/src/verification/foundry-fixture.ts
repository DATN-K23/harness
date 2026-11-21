import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { LocalExecutionProfile, SourceSnapshotPort, VerificationTelemetry } from "@harness/protocol"
import { createLocalExecution, isStagedPath, type PinnedExecutable } from "../execution"
import { isDeniedSourceFile } from "../source/source-snapshot"
import { digestOf, textDigest } from "../util/digest"
import type { VerificationPort, VerificationResult } from "./contracts"
import { unavailableVerification } from "./unavailable-verification"

const TestPath = "test/HarnessFixture.t.sol"
const TimeoutMs = 65_000
const MaxOutputBytes = 16_384
const BuildConfig = `[profile.default]
src = "src"
test = "test"
libs = ["lib"]
out = "out"
cache = false
ffi = false
offline = true
auto_detect_solc = false
auto_detect_remappings = false
fs_permissions = []
`

const forgeArgs = (root: string, compiler: string, contract: string, test: string) =>
  ["test", "--root", root, "--offline", "--use", compiler, "--json",
    "--match-path", TestPath, "--match-contract", `^${contract}$`, "--match-test", `^${test}\\(\\)$`]

interface VersionedExecutable extends PinnedExecutable { readonly version: string }

export interface ReviewedFoundryFixture {
  readonly snapshotId: string
  /** Path to digest of the canonical projection (snapshot lines joined by LF). */
  readonly files: Readonly<Record<string, string>>
  readonly testDigest: string
  readonly contract: string
  readonly test: string
  readonly toolchain: {
    readonly platform: string
    readonly architecture: string
    readonly forge: VersionedExecutable
    readonly solc: VersionedExecutable
  }
}

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/
const isDigest = (value: string) => /^sha256:[0-9a-f]{64}$/.test(value)
const isSnapshotPath = (path: string) =>
  /^(src|lib)\/.+\.sol$/.test(path) && isStagedPath(path) && !isDeniedSourceFile(path)

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined

const testStatus = (output: string, contract: string, test: string) => {
  try {
    const suites = record(JSON.parse(output))
    if (!suites || Object.keys(suites).length !== 1) return
    const entry = Object.entries(suites)[0]
    if (!entry) return
    const [suite, report] = entry
    if (suite.replaceAll("\\", "/") !== `${TestPath}:${contract}`) return
    const results = record(record(report)?.test_results)
    if (!results || Object.keys(results).length !== 1) return
    return record(results[`${test}()`])?.status
  } catch {
    return undefined
  }
}

/** For explicit internal composition with a maintainer-owned manifest and no scorer dependency. */
export const createReviewedFoundryVerification = (options: {
  enabled: boolean
  snapshot: SourceSnapshotPort
  approvedFixture: ReviewedFoundryFixture
}): VerificationPort => {
  if (!options.enabled) return unavailableVerification

  const snapshot = options.snapshot
  const approved = structuredClone(options.approvedFixture)
  const entries = Object.entries(approved.files)
  const { forge, solc, platform, architecture } = approved.toolchain
  const validManifest = isDigest(approved.testDigest) &&
    identifier.test(approved.contract) && /^test[A-Za-z0-9_]+$/.test(approved.test) &&
    isDigest(forge.digest) && isDigest(solc.digest) && Boolean(forge.version && solc.version) &&
    entries.every(([path, digest]) => isSnapshotPath(path) && isDigest(digest)) &&
    new Set(entries.map(([path]) => path.toLowerCase())).size === entries.length

  const executionProfile: Extract<LocalExecutionProfile, { backend: "host" }> = Object.freeze({
    version: 1, backend: "host", platform, architecture,
    policyDigest: digestOf({ version: 1, config: BuildConfig, args: forgeArgs("<workspace>", "<compiler>", approved.contract, approved.test) }),
    toolchainDigest: digestOf({ platform, architecture, forge: [forge.version, forge.digest], solc: [solc.version, solc.digest] }),
    snapshotDigest: digestOf(approved.files), testDigest: approved.testDigest,
    timeoutMs: TimeoutMs, maxOutputBytes: MaxOutputBytes,
  })

  return {
    executionProfile,
    runStateProbe: unavailableVerification.runStateProbe,
    async runSingleShot(input, signal) {
      const start = performance.now()
      let preparationMs = 0
      let processMs = 0
      let cleanupMs = 0
      let outputBytes = 0
      let maxRssBytes: number | undefined
      let permissionDecision: VerificationTelemetry["permissionDecision"] = "not_evaluated"
      const result = (outcome: VerificationResult["outcome"], exitCode = -1): VerificationResult => {
        const durationMs = performance.now() - start
        return {
          outcome, exitCode, durationMs,
          trace: outcome === "passed" || outcome === "assertion_failed"
            ? `Foundry fixture ${approved.contract}.${approved.test}: ${outcome}. Evidence profile ${digestOf(executionProfile)}.`
            : "",
          telemetry: {
            outcome, permissionDecision, outputBytes,
            preparationMs: preparationMs || (processMs === 0 && cleanupMs === 0 ? durationMs : 0),
            processMs, cleanupMs, totalMs: durationMs,
            ...(maxRssBytes === undefined ? {} : { maxRssBytes }),
          },
        }
      }
      if (signal?.aborted) return result("cancelled")
      const { snapshotId, testFile } = input
      if (!validManifest || snapshotId !== approved.snapshotId || textDigest(testFile) !== approved.testDigest) {
        permissionDecision = "denied"
        return result("denied")
      }
      if (platform !== process.platform || architecture !== process.arch) {
        permissionDecision = "unavailable"
        return result("unavailable")
      }

      const deadline = AbortSignal.timeout(TimeoutMs)
      const abort = signal ? AbortSignal.any([signal, deadline]) : deadline
      let cwd: string | undefined
      let cleanupConfirmed = true
      let outcome: VerificationResult["outcome"] = "setup_failed"
      let exitCode = -1
      try {
        cwd = await mkdtemp(join(await realpath(tmpdir()), "harness-fixture-"))
        const root = cwd
        const stage = async (path: string, contents: string) => {
          abort.throwIfAborted()
          const target = join(root, path)
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, contents, { flag: "wx", signal: abort })
        }
        for (const dir of ["home", "tmp", "src"]) await mkdir(join(root, dir))
        for (const [path, digest] of entries) {
          const read = (endLine: number) => snapshot.readLines({ snapshotId, path, startLine: 1, endLine }, abort)
          const first = await read(Number.MAX_SAFE_INTEGER)
          const content = first.kind === "out_of_range" && first.lineCount > 0 ? await read(first.lineCount) : first
          if (content.kind !== "ok") throw new Error("fixture input unavailable")
          const projected = content.lines.join("\n")
          if (textDigest(projected) !== digest) {
            permissionDecision = "denied"
            throw new Error("fixture input changed")
          }
          await stage(path, projected)
        }
        await stage(TestPath, testFile)
        await stage("foundry.toml", BuildConfig)
        const args = forgeArgs(root, solc.path, approved.contract, approved.test)
        const execution = createLocalExecution({
          executable: forge, tools: [solc], workspace: root, args,
          files: [...entries.map(([path]) => path), TestPath, "foundry.toml", "home", "tmp", "src"],
        })
        const remaining = Math.floor(TimeoutMs - (performance.now() - start))
        if (remaining < 1) throw new DOMException("Fixture deadline exhausted", "TimeoutError")
        preparationMs = performance.now() - start
        const ran = await execution.run({ executable: forge.path, cwd: root, args, timeoutMs: remaining, maxOutputBytes: MaxOutputBytes }, abort)
        preparationMs += Math.max(0, ran.durationMs - ran.processMs)
        processMs = ran.processMs
        cleanupConfirmed = ran.cleanupConfirmed
        outputBytes = ran.outputBytes
        maxRssBytes = ran.maxRssBytes
        exitCode = ran.exitCode ?? -1
        permissionDecision = ran.outcome === "denied" || ran.outcome === "unavailable" ? ran.outcome
          : ran.processMs > 0 ? "allowed" : "not_evaluated"
        if (ran.outcome === "exited") {
          const status = testStatus(ran.stdout, approved.contract, approved.test)
          outcome = status === "Success" && exitCode === 0 ? "passed"
            : status === "Failure" && exitCode !== 0 ? "assertion_failed" : "setup_failed"
        } else {
          outcome = ran.outcome === "cancelled" && deadline.aborted && !signal?.aborted ? "timed_out" : ran.outcome
        }
      } catch (error) {
        outcome = signal?.aborted ? "cancelled" : deadline.aborted || (error instanceof DOMException && error.name === "TimeoutError")
          ? "timed_out" : permissionDecision === "denied" ? "denied" : "setup_failed"
      } finally {
        if (preparationMs === 0) preparationMs = performance.now() - start
        if (cwd !== undefined && cleanupConfirmed) {
          const cleanupStart = performance.now()
          try { await rm(cwd, { recursive: true, force: true }) } catch { outcome = "infrastructure_failed" }
          cleanupMs = performance.now() - cleanupStart
        }
      }
      return result(outcome, exitCode)
    },
  }
}
