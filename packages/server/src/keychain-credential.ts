import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

export interface KeychainCredentialProvider {
  getOrCreate(): Promise<string>
  rotate(): Promise<string>
}

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface KeychainCredentialOptions {
  platform?: string
  service?: string
  account?: string
  generate?: () => string
  run?: (args: string[], stdin?: string) => Promise<CommandResult>
}

const defaultRun = async (args: string[], stdin?: string): Promise<CommandResult> => {
  const proc = Bun.spawn(["swift", fileURLToPath(new URL("../native/keychain-credential.swift", import.meta.url)), ...args], {
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (stdin !== undefined) {
    const input = proc.stdin
    if (!input || typeof input === "number") throw new Error("Keychain helper stdin unavailable")
    input.write(stdin)
    input.end()
  }
  const read = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return ""
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString("utf8")
  }
  const [stdout, stderr, code] = await Promise.all([read(proc.stdout), read(proc.stderr), proc.exited])
  return {
    code,
    stdout,
    stderr,
  }
}

export const createKeychainCredentialProvider = (
  options: KeychainCredentialOptions = {},
): KeychainCredentialProvider => {
  const platform = options.platform ?? process.platform
  const service = options.service ?? "com.harness.local-api"
  const account = options.account ?? "installation"
  const generate = options.generate ?? (() => randomBytes(32).toString("base64url"))
  const run = options.run ?? defaultRun

  const invoke = async (action: "get" | "set" | "rotate", secret?: string) => {
    if (platform !== "darwin") throw new Error("macOS Keychain is required")
    const result = await run([action, service, account], secret)
    if (result.code !== 0) throw new Error("Keychain credential access failed")
    return result.stdout.replace(/[\r\n]+$/, "")
  }

  return {
    async getOrCreate() {
      if (platform !== "darwin") throw new Error("macOS Keychain is required")
      const existing = await run(["get", service, account])
      if (existing.code === 0 && existing.stdout.length > 0) return existing.stdout.replace(/[\r\n]+$/, "")
      if (existing.code !== 44) throw new Error("Keychain credential access failed")
      const generated = generate()
      try {
        await invoke("set", generated)
        return generated
      } catch {
        const raced = await run(["get", service, account])
        if (raced.code === 0 && raced.stdout.length > 0) return raced.stdout.replace(/[\r\n]+$/, "")
        throw new Error("Keychain credential access failed")
      }
    },
    async rotate() {
      const generated = generate()
      await invoke("rotate", generated)
      return generated
    },
  }
}
