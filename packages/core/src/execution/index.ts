import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, realpath } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

export interface PinnedExecutable {
  readonly path: string
  readonly digest: string
}

export interface LocalExecutionRequest {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}

export interface LocalExecutionPolicy {
  readonly executable: PinnedExecutable
  readonly tools?: readonly PinnedExecutable[]
  readonly args: readonly string[]
  readonly workspace: string
  readonly files: readonly string[]
}

export interface LocalExecutionResult {
  readonly outcome: "exited" | "denied" | "unavailable" | "cancelled" | "timed_out" | "output_limit" | "infrastructure_failed"
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly outputBytes: number
  readonly truncated: boolean
  readonly cleanupConfirmed: boolean
  readonly durationMs: number
  readonly processMs: number
  readonly maxRssBytes?: number
}

export interface LocalExecutionPort {
  run(request: LocalExecutionRequest, signal?: AbortSignal): Promise<LocalExecutionResult>
}

/** Relative, unambiguous staged paths on POSIX and Windows. */
export const isStagedPath = (path: string) => path.split("/").every((part) =>
  /^[A-Za-z0-9_@-][A-Za-z0-9_.@-]*$/.test(part) &&
  !part.endsWith(".") && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
)

const samePath = (left: string, right: string) => relative(left, right) === ""

const verifiedFile = async (file: PinnedExecutable, signal: AbortSignal) => {
  if (!isAbsolute(file.path) || !samePath(await realpath(file.path), file.path) || !(await lstat(file.path)).isFile())
    return false
  if (process.platform === "win32" && !file.path.toLowerCase().endsWith(".exe")) return false
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file.path, { signal })) hash.update(chunk)
  return `sha256:${hash.digest("hex")}` === file.digest
}

const authorize = async (policy: LocalExecutionPolicy, request: LocalExecutionRequest, signal: AbortSignal) => {
  if (request.executable !== policy.executable.path || !samePath(request.cwd, policy.workspace) ||
      request.args.length !== policy.args.length || request.args.some((arg, i) => arg !== policy.args[i]))
    return "denied"
  try {
    for (const tool of [policy.executable, ...(policy.tools ?? [])]) {
      if (!await verifiedFile(tool, signal)) return "unavailable"
    }
  } catch {
    return "unavailable"
  }
  try {
    if (!isAbsolute(request.cwd) || !samePath(await realpath(request.cwd), request.cwd)) return "denied"
    for (const path of policy.files) {
      if (!isStagedPath(path)) return "denied"
      const target = join(request.cwd, path)
      const canonical = await realpath(target)
      const rel = relative(request.cwd, canonical)
      if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) || !samePath(canonical, target) ||
          (await lstat(target)).isSymbolicLink()) return "denied"
    }
  } catch {
    return "denied"
  }
  return "allowed"
}

const environment = (cwd: string): Record<string, string> => ({
  HOME: join(cwd, "home"), USERPROFILE: join(cwd, "home"),
  TMPDIR: join(cwd, "tmp"), TMP: join(cwd, "tmp"), TEMP: join(cwd, "tmp"),
  XDG_CACHE_HOME: join(cwd, "home", ".cache"), NO_COLOR: "1",
  ...(process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
})

/** A rule-checked host spawn for trusted callers. Child permissions are those of the host account. */
export const createLocalExecution = (source: LocalExecutionPolicy): LocalExecutionPort => {
  const policy = structuredClone(source)
  return {
    async run(input, signal) {
      const request = { ...input, args: [...input.args] }
      const start = performance.now()
      const result = (outcome: LocalExecutionResult["outcome"], details: Partial<LocalExecutionResult> = {}): LocalExecutionResult => ({
        outcome, exitCode: null, stdout: "", stderr: "", outputBytes: 0, truncated: false, cleanupConfirmed: true,
        durationMs: performance.now() - start, processMs: 0, ...details,
      })
      if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 2_147_483_647 ||
          !Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes < 1) return result("denied")
      if (signal?.aborted) return result("cancelled")
      if (typeof Bun.spawn !== "function") return result("unavailable")
      const deadline = AbortSignal.timeout(request.timeoutMs)
      const abort = signal ? AbortSignal.any([signal, deadline]) : deadline
      const allowed = await authorize(policy, request, abort)
      if (abort.aborted) return result(signal?.aborted ? "cancelled" : "timed_out")
      if (allowed !== "allowed") return result(allowed)

      let child: ReturnType<typeof spawn>
      const processStart = performance.now()
      try {
        child = spawn(request)
      } catch {
        return result("unavailable")
      }

      const readers = [child.stdout.getReader(), child.stderr.getReader()] as const
      const chunks: [Uint8Array[], Uint8Array[]] = [[], []]
      let outputBytes = 0
      let truncated = false
      let stopReason: "cancelled" | "timed_out" | "output_limit" | "infrastructure_failed" | undefined
      let stop!: () => void
      const stopped = new Promise<void>((resolve) => { stop = resolve })
      const terminate = (reason: NonNullable<typeof stopReason>) => {
        if (stopReason !== undefined) return
        stopReason = reason
        try { child.kill("SIGKILL") } catch { /* Confirm exit separately. */ }
        for (const reader of readers) void reader.cancel().catch(() => undefined)
        stop()
      }
      const onAbort = () => terminate(signal?.aborted ? "cancelled" : "timed_out")
      abort.addEventListener("abort", onAbort, { once: true })
      if (abort.aborted) onAbort()

      const capture = async (index: 0 | 1) => {
        while (stopReason === undefined) {
          const { done, value } = await readers[index].read()
          if (done || stopReason !== undefined) return
          const count = Math.min(value.byteLength, request.maxOutputBytes - outputBytes)
          if (count > 0) chunks[index].push(value.slice(0, count))
          outputBytes += count
          if (value.byteLength > count) {
            truncated = true
            terminate("output_limit")
          }
        }
      }
      const finished = Promise.all([child.exited, capture(0), capture(1)])
        .then(([exitCode]) => exitCode, () => { terminate("infrastructure_failed"); return null })
      try {
        const exitCode = await Promise.race([finished, stopped.then(() => null)])
        const cleanupConfirmed = stopReason === undefined ||
          await Promise.race([child.exited.then(() => true, () => false), Bun.sleep(500).then(() => false)])
        const maxRssBytes = child.resourceUsage()?.maxRSS
        return result(cleanupConfirmed ? stopReason ?? "exited" : "infrastructure_failed", {
          exitCode, cleanupConfirmed, outputBytes, truncated, processMs: performance.now() - processStart,
          ...(maxRssBytes === undefined ? {} : { maxRssBytes }),
          stdout: Buffer.concat(chunks[0]).toString("utf8"), stderr: Buffer.concat(chunks[1]).toString("utf8"),
        })
      } finally {
        abort.removeEventListener("abort", onAbort)
      }
    },
  }
}

const spawn = (request: LocalExecutionRequest) =>
  Bun.spawn([request.executable, ...request.args], {
    cwd: resolve(request.cwd), env: environment(request.cwd), stdin: "ignore", stdout: "pipe", stderr: "pipe",
  })
