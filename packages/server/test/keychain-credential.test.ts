import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createKeychainCredentialProvider } from "../src/keychain-credential"

describe("Keychain credential provider", () => {
  test("creates once, returns stored credential, and rotates without changing run identity", async () => {
    const stored = new Map<string, string>()
    const calls: { args: string[]; stdin?: string }[] = []
    const provider = createKeychainCredentialProvider({
      platform: "darwin",
      generate: () => "generated-secret",
      run: async (args, stdin) => {
        calls.push({ args, stdin })
        const [action, service, account] = args
        const key = `${service}:${account}`
        if (action === "get") {
          const value = stored.get(key)
          return value === undefined ? { code: 44, stdout: "", stderr: "not found" } : { code: 0, stdout: value, stderr: "" }
        }
        if (action === "set" || action === "rotate") stored.set(key, stdin ?? "")
        return { code: 0, stdout: "", stderr: "" }
      },
    })

    expect(await provider.getOrCreate()).toBe("generated-secret")
    expect(await provider.getOrCreate()).toBe("generated-secret")
    expect(await provider.rotate()).toBe("generated-secret")
    expect(stored.get("com.harness.local-api:installation")).toBe("generated-secret")
    expect(calls.every(({ args }) => !args.includes("generated-secret"))).toBe(true)
    expect(calls.filter(({ args }) => args[0] === "set")).toHaveLength(1)
    expect(calls.filter(({ args }) => args[0] === "rotate")).toHaveLength(1)
    expect(calls.find(({ args }) => args[0] === "set")?.stdin).toBe("generated-secret")
    expect(calls.find(({ args }) => args[0] === "rotate")?.stdin).toBe("generated-secret")
  })

  test("fails closed off macOS and when Keychain access fails", async () => {
    const unsupported = createKeychainCredentialProvider({ platform: "linux", run: async () => ({ code: 0, stdout: "", stderr: "" }) })
    await expect(unsupported.getOrCreate()).rejects.toThrow("macOS Keychain is required")

    const unavailable = createKeychainCredentialProvider({ platform: "darwin", run: async () => ({ code: 1, stdout: "", stderr: "Keychain unavailable" }) })
    await expect(unavailable.getOrCreate()).rejects.toThrow("Keychain credential access failed")
  })

  test.if(process.platform === "darwin")("stores and rotates a real uniquely named macOS Keychain item", async () => {
    const service = `com.harness.test.${randomUUID()}`
    const provider = createKeychainCredentialProvider({ service, account: "integration-test" })
    try {
      const initial = await provider.getOrCreate()
      expect(initial).toHaveLength(43)
      expect(await provider.getOrCreate()).toBe(initial)
      const rotated = await provider.rotate()
      expect(rotated).not.toBe(initial)
      expect(await provider.getOrCreate()).toBe(rotated)
    } finally {
      const removed = spawnSync("security", ["delete-generic-password", "-s", service, "-a", "integration-test"], {
        stdio: "ignore",
      })
      expect(removed.error).toBeUndefined()
      expect(removed.status).toBe(0)
    }
  })
})
