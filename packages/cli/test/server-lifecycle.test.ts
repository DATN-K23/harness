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
