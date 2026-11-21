import { expect, test } from "bun:test"
import { waitForServerShutdown } from "../src/server-lifecycle"

test("SIGINT and SIGTERM share one shutdown and cleanup path", async () => {
  const handlers = new Map<string, () => void>()
  let stopped = 0
  const signals = {
    once(event: "SIGINT" | "SIGTERM", listener: () => void) { handlers.set(event, listener) },
    off(event: "SIGINT" | "SIGTERM") { handlers.delete(event) },
  }
  const pending = waitForServerShutdown(signals, async () => { stopped++ })
  handlers.get("SIGTERM")?.()
  handlers.get("SIGINT")?.()
  await pending
  expect(stopped).toBe(1)
  expect(handlers.size).toBe(0)
})

test("requesting managed shutdown stops the server and removes signal listeners", async () => {
  const owner = new AbortController()
  const listeners = new Set<() => void>()
  let stopped = false
  const shutdown = waitForServerShutdown({
    once: (_event, listener) => listeners.add(listener),
    off: (_event, listener) => listeners.delete(listener),
  }, async () => { stopped = true }, owner.signal)
  owner.abort()
  await shutdown
  expect(stopped).toBe(true)
  expect(listeners.size).toBe(0)
})
