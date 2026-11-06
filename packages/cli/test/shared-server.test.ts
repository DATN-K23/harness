import { afterEach, beforeEach, expect, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { localAuthorization } from "@harness/server"
import { ensureSharedServer, findSharedServer, SharedEndpointId, SharedOrigin, sharedEndpointStore } from "../src/shared-server"
import { serveSharedCommand } from "../src/shared-commands"

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "harness-shared-test-")) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const endpoint = { pid: 12345, password: "A".repeat(43) }
const signal = () => new AbortController().signal

test("discovers and reuses the same authenticated daemon across commands", async () => {
  const store = sharedEndpointStore(directory)
  await store.publish(endpoint)
  const deps = {
    read: store.read, origin: SharedOrigin,
    alive: (pid: number) => pid === endpoint.pid,
    spawn() { throw new Error("should reuse the existing server") },
    async fetch(url: string, init?: RequestInit) {
      expect(url).toBe(SharedOrigin + "/_local/status")
      expect(new Headers(init?.headers).get("authorization")).toBe(localAuthorization(endpoint.password))
      return Response.json({ pid: endpoint.pid, endpointId: SharedEndpointId, apiVersion: 1 })
    },
  }
  for (const _ of ["judge", "run", "view", "repo", "snapshot"])
    expect(await ensureSharedServer({}, signal(), deps)).toEqual({ origin: SharedOrigin, password: endpoint.password })
})

test("starts once for a missing endpoint and waits until the authenticated daemon is ready", async () => {
  let starts = 0
  const deps = {
    read: async () => starts === 1 ? endpoint : undefined,
    origin: SharedOrigin,
    alive: () => true,
    spawn() { starts++ },
    async fetch() { return Response.json({ pid: endpoint.pid, endpointId: SharedEndpointId, apiVersion: 1 }) },
  }
  expect(await ensureSharedServer({}, signal(), deps)).toEqual({ origin: SharedOrigin, password: endpoint.password })
  expect(starts).toBe(1)
})

test("stale records and mismatched server identity do not authorize reuse", async () => {
  const deps = {
    read: async () => endpoint, origin: SharedOrigin,
    alive: () => false,
    spawn() { throw new Error("unexpected spawn") },
    async fetch() { return Response.json({ pid: endpoint.pid + 1, endpointId: SharedEndpointId, apiVersion: 1 }) },
  }
  expect(await findSharedServer(signal(), deps)).toBeUndefined()
  expect(await findSharedServer(signal(), { ...deps, alive: () => true })).toBeUndefined()
})

test.skipIf(process.getuid === undefined)("rejects a credential descriptor with shared permissions", async () => {
  const store = sharedEndpointStore(directory)
  await store.publish(endpoint)
  await chmod(join(directory, "endpoint.json"), 0o644)
  await expect(store.read()).rejects.toThrow("unsafe")
})

test("command transport preserves output order and exit code", async () => {
  const request = new Request("http://127.0.0.1/_local/command", {
    method: "POST", body: JSON.stringify({ argv: ["snapshot", "list"], cwd: directory }),
  })
  const response = await serveSharedCommand(request, async ({ argv, cwd }, writers) => {
    expect(argv).toEqual(["snapshot", "list"])
    expect(cwd).toBe(directory)
    writers.stdout("snapshot 1")
    writers.stderr("warning")
    return 3
  })
  expect((await response.text()).trim().split("\n").map((line) => JSON.parse(line))).toEqual([
    { stream: "stdout", message: "snapshot 1" }, { stream: "stderr", message: "warning" }, { exitCode: 3 },
  ])
})
