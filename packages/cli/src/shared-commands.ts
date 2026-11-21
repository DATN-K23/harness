import { isAbsolute } from "node:path"
import { localAuthorization } from "@harness/server"
import type { SharedServerConnection } from "./shared-server"

type Writers = { stdout(message: string): void; stderr(message: string): void }
type CommandRequest = { argv: string[]; cwd: string }
type CommandEvent = { stream: "stdout" | "stderr"; message: string } | { exitCode: number }

export const serveSharedCommand = async (
  request: Request,
  execute: (request: CommandRequest, writers: Writers) => Promise<number>,
): Promise<Response> => {
  let body: unknown
  try { body = await request.json() } catch { return new Response("Invalid command request", { status: 400 }) }
  if (!body || typeof body !== "object" || !("argv" in body) || !Array.isArray(body.argv) ||
      body.argv.length > 128 || !body.argv.every((arg: unknown) => typeof arg === "string") ||
      !("cwd" in body) || typeof body.cwd !== "string" || !isAbsolute(body.cwd) || body.cwd.includes("\0"))
    return new Response("Invalid command request", { status: 400 })
  const command = { argv: body.argv as string[], cwd: body.cwd }
  let disconnected = false
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: CommandEvent) => {
        if (!disconnected) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
      }
      void execute(command, {
        stdout: (message) => emit({ stream: "stdout", message }),
        stderr: (message) => emit({ stream: "stderr", message }),
      }).then((exitCode) => emit({ exitCode }), () => {
        emit({ stream: "stderr", message: "Error: Shared command failed" })
        emit({ exitCode: 1 })
      }).finally(() => { if (!disconnected) controller.close() })
    },
    cancel() { disconnected = true },
  }), { headers: { "content-type": "application/x-ndjson" } })
}

export const runSharedCommand = async (
  server: SharedServerConnection,
  argv: string[],
  cwd: string,
  writers: Writers,
  signal: AbortSignal,
): Promise<number> => {
  const response = await fetch(server.origin + "/_local/command", {
    method: "POST", redirect: "error", signal,
    headers: { authorization: localAuthorization(server.password), "content-type": "application/json" },
    body: JSON.stringify({ argv, cwd }),
  })
  if (!response.ok || !response.body) throw new Error(`Shared server rejected the command (HTTP ${response.status})`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) throw new Error("Shared server disconnected before returning the command result")
      pending += decoder.decode(value, { stream: true })
      let end = pending.indexOf("\n")
      while (end >= 0) {
        const event = JSON.parse(pending.slice(0, end)) as CommandEvent
        pending = pending.slice(end + 1)
        if ("exitCode" in event) {
          if (!Number.isInteger(event.exitCode) || event.exitCode < 0 || event.exitCode > 255)
            throw new Error("Shared server returned an invalid exit code")
          return event.exitCode
        }
        if (typeof event.message !== "string" || (event.stream !== "stdout" && event.stream !== "stderr"))
          throw new Error("Shared server returned an invalid output event")
        writers[event.stream](event.message)
        end = pending.indexOf("\n")
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
