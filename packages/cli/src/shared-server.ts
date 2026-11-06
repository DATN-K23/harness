import { randomBytes, randomUUID } from "node:crypto"
import { constants, type Stats } from "node:fs"
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ApiCompatibility, assertApiCompatibility, isLoopbackHost, localAuthorization,
  isAuthorizedLocalRequest, localAuthenticationRequired,
} from "@harness/server"
import { waitForServerShutdown } from "./server-lifecycle"

export const SharedPort = 4318
export const SharedOrigin = `http://127.0.0.1:${SharedPort}`
export const SharedEndpointId = "harness-shared-runtime"
const command = [process.execPath, fileURLToPath(new URL("./index.ts", import.meta.url)), "serve", "--managed"]

interface Endpoint {
  pid: number
  password: string
}
export interface SharedServerConnection {
  origin: string
  password: string
}

export const loopbackOrigin = (input: string): string => {
  let url: URL
  try { url = new URL(input) } catch { throw new Error("Server URL must be an HTTP loopback origin") }
  if (url.protocol !== "http:" || !isLoopbackHost(url.hostname) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash)
    throw new Error("Server URL must be an HTTP loopback origin")
  return url.origin
}

const hasCode = (error: unknown, code: string) => (error as NodeJS.ErrnoException)?.code === code
const isPrivate = (stat: Stats) => {
  const uid = process.getuid?.()
  // Windows inherits the ACL of the user's profile directory.
  return uid === undefined || (stat.uid === uid && (stat.mode & 0o077) === 0)
}

export const sharedEndpointStore = (directory = join(homedir(), ".harness-server")) => {
  const file = join(directory, "endpoint.json")
  const ensureDirectory = async () => {
    await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => { if (!hasCode(error, "EEXIST")) throw error })
    const stat = await lstat(directory)
    if (!stat.isDirectory() || !isPrivate(stat)) throw new Error("Shared server state directory is not private")
  }
  return {
    async read(): Promise<Endpoint | undefined> {
      await ensureDirectory()
      const stat = await lstat(file).catch((error: unknown) => { if (!hasCode(error, "ENOENT")) throw error })
      if (!stat) return
      if (!stat.isFile() || !isPrivate(stat) || stat.size > 512) throw new Error("Shared server endpoint file is unsafe")
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
      try {
        const current = await handle.stat()
        if (!current.isFile() || !isPrivate(current) || current.size > 512)
          throw new Error("Shared server endpoint file is unsafe")
        const data = Buffer.alloc(513)
        const { bytesRead } = await handle.read(data, 0, data.length, 0)
        if (bytesRead > 512) throw new Error("Shared server endpoint file is unsafe")
        const value: unknown = JSON.parse(data.subarray(0, bytesRead).toString("utf8"))
        if (!value || typeof value !== "object" || !("pid" in value) || typeof value.pid !== "number" ||
            !Number.isSafeInteger(value.pid) || value.pid < 1 || !("password" in value) ||
            typeof value.password !== "string" || value.password.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(value.password))
          throw new Error("Shared server endpoint file is invalid")
        return { pid: value.pid, password: value.password }
      } finally {
        await handle.close()
      }
    },
    async publish(endpoint: Endpoint) {
      await ensureDirectory()
      const temporary = join(directory, `endpoint-${randomUUID()}.tmp`)
      await writeFile(temporary, JSON.stringify(endpoint), { mode: 0o600, flag: "wx" })
      try { await rename(temporary, file) } finally { await rm(temporary, { force: true }) }
    },
  }
}

const processAlive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch { return false }
}

type ConnectionDeps = {
  read(): Promise<Endpoint | undefined>
  alive(pid: number): boolean
  fetch(url: string, init?: RequestInit): Promise<Response>
  spawn(env: Record<string, string | undefined>): void
  origin: string
}

const connectionDeps = (): ConnectionDeps => ({
  read: sharedEndpointStore().read,
  alive: processAlive,
  fetch,
  origin: SharedOrigin,
  spawn(env) {
    Bun.spawn(command, { env, detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref()
  },
})

export const findSharedServer = async (
  signal: AbortSignal,
  deps: ConnectionDeps = connectionDeps(),
): Promise<SharedServerConnection | undefined> => {
  signal.throwIfAborted()
  const endpoint = await deps.read()
  if (!endpoint || !deps.alive(endpoint.pid)) return
  let response: Response
  try {
    response = await deps.fetch(deps.origin + "/_local/status", {
      headers: { authorization: localAuthorization(endpoint.password) },
      redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
    })
  } catch (error) {
    signal.throwIfAborted()
    return
  }
  if (!response.ok) return
  const status = await response.json().catch(() => undefined) as { endpointId?: unknown; pid?: unknown; apiVersion?: unknown } | undefined
  if (status?.endpointId !== SharedEndpointId || status.pid !== endpoint.pid || typeof status.apiVersion !== "number") return
  assertApiCompatibility({ apiVersion: status.apiVersion })
  return { origin: deps.origin, password: endpoint.password }
}

export const ensureSharedServer = async (
  env: Record<string, string | undefined>,
  signal: AbortSignal,
  deps: ConnectionDeps = connectionDeps(),
): Promise<SharedServerConnection> => {
  const existing = await findSharedServer(signal, deps)
  if (existing) return existing

  deps.spawn(env)
  const startup = AbortSignal.timeout(15_000)
  while (!startup.aborted) {
    const ready = await findSharedServer(signal, deps)
    if (ready) return ready
    await Bun.sleep(100)
  }
  throw new Error(`Shared Harness server did not start. Check whether port ${SharedPort} is in use`)
}

export const runSharedDaemon = async (options: {
  fetch(request: Request, password: string): Promise<Response>
  stop(): Promise<void>
}, deps = { publish: sharedEndpointStore().publish, port: SharedPort }) => {
  const password = randomBytes(32).toString("base64url")
  const owner = new AbortController()
  const server = Bun.serve({
    hostname: "127.0.0.1", port: deps.port, idleTimeout: 0, maxRequestBodySize: 512_000,
    async fetch(request) {
      if (!isAuthorizedLocalRequest(request, password)) return localAuthenticationRequired()
      const { pathname } = new URL(request.url)
      if (request.method === "GET" && pathname === "/_local/status")
        return Response.json({ endpointId: SharedEndpointId, pid: process.pid, apiVersion: ApiCompatibility.apiVersion })
      if (request.method === "POST" && pathname === "/_local/stop") {
        setTimeout(() => owner.abort(), 0)
        return Response.json({ stopping: true }, { status: 202 })
      }
      return options.fetch(request, password)
    },
  })
  try {
    await deps.publish({ pid: process.pid, password })
    await waitForServerShutdown(process, async () => { await server.stop() }, owner.signal)
  } finally {
    await server.stop(true)
    await options.stop()
  }
}
