import { describe, expect, test } from "bun:test"
import { ApiCompatibility, assertApiCompatibility, validateApiCompatibility, isLoopbackHost, isAuthorizedLocalRequest, localAuthorization } from "../src/runtime-security"
import { listenLocal } from "../src/local-server"
import { startJudgeServer } from "../src/startup"

describe("local runtime security", () => {
  test("accepts the matching version-only API handshake", () => {
    expect(ApiCompatibility).toEqual({ apiVersion: 1 })
    expect(validateApiCompatibility(ApiCompatibility, ApiCompatibility)).toEqual({ compatible: true })
  })

  test("rejects incompatible major version with upgrade details", () => {
    expect(validateApiCompatibility({ apiVersion: 2 }, ApiCompatibility)).toEqual({
      compatible: false,
      reason: "api_version_mismatch",
      expectedApiVersion: 1,
      receivedApiVersion: 2,
    })
    expect(validateApiCompatibility({ apiVersion: 1 }, ApiCompatibility)).toEqual({ compatible: true })
    expect(() => assertApiCompatibility({ apiVersion: 2 })).toThrow("Incompatible API version")
  })

  test("allows loopback hosts and refuses public interface binds", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true)
    expect(isLoopbackHost("::1")).toBe(true)
    expect(isLoopbackHost("localhost")).toBe(true)
    expect(isLoopbackHost("0.0.0.0")).toBe(false)
    expect(isLoopbackHost("192.168.1.5")).toBe(false)
  })

  test("rejects missing or incorrect credentials and accepts the injected credential", () => {
    const request = (credential?: string) => new Request("http://127.0.0.1/health", {
      headers: credential === undefined ? {} : { authorization: localAuthorization(credential) },
    })
    expect(isAuthorizedLocalRequest(request(), "installation-secret")).toBe(false)
    expect(isAuthorizedLocalRequest(request("wrong-secret"), "installation-secret")).toBe(false)
    expect(isAuthorizedLocalRequest(request("installation-secret"), "installation-secret")).toBe(true)
    const withHeader = (authorization: string) => new Request("http://127.0.0.1/health", { headers: { authorization } })
    expect(isAuthorizedLocalRequest(withHeader("Bearer installation-secret"), "installation-secret")).toBe(false)
    expect(isAuthorizedLocalRequest(withHeader(`Basic ${btoa("other:installation-secret")}`), "installation-secret")).toBe(false)
    expect(isAuthorizedLocalRequest(withHeader("Basic !!!!"), "installation-secret")).toBe(false)
    expect(isAuthorizedLocalRequest(withHeader(`basic ${btoa("harness:a:b")}`), "a:b")).toBe(true)
  })

  test("refuses public bind hosts before invoking the listener", () => {
    let listenCalls = 0
    expect(() => listenLocal("0.0.0.0", 1234, () => { listenCalls++; return {} })).toThrow("Server must bind to loopback")
    expect(listenCalls).toBe(0)
    expect(listenLocal("127.0.0.1", 1234, () => { listenCalls++; return {} })).toEqual({})
    expect(listenCalls).toBe(1)
  })

  test("never accepts a credential from the URL", () => {
    const request = new Request("http://127.0.0.1/health?token=installation-secret")
    expect(isAuthorizedLocalRequest(request, "installation-secret")).toBe(false)
  })

  test("refuses service startup when no server password is supplied", async () => {
    const { startLocalRuntime } = await import("../src/local-runtime")
    let listenCalls = 0
    expect(() => startLocalRuntime({
      hostname: "127.0.0.1",
      port: 4312,
      credential: undefined,
      listen: () => { listenCalls++; return {} },
      fetch: async () => Response.json({ ok: true }),
    })).toThrow("HARNESS_SERVER_PASSWORD")
    expect(listenCalls).toBe(0)
  })

  test("loads the configured password before serving", async () => {
    const sequence: string[] = []
    const server = await startJudgeServer<{ fetch(request: Request): Promise<Response> }>({
      hostname: "127.0.0.1",
      port: 4555,
      getCredential: async () => { sequence.push("password"); return "protected-secret" },
      createRuntime: (credential) => {
        sequence.push(`runtime:${credential}`)
        return { api: { fetch: async () => Response.json({ ok: true }) }, worker: { runOnce: async () => { sequence.push("worker"); return 1 } } }
      },
      listen: (hostname, port, fetch) => {
        sequence.push(`listen:${hostname}:${port}`)
        return { fetch }
      },
      runWorker: false,
    })
    expect(sequence).toEqual(["password", "runtime:protected-secret", "listen:127.0.0.1:4555"])
    expect((await server.fetch(new Request("http://127.0.0.1/health", { headers: { authorization: localAuthorization("protected-secret") } }))).status).toBe(200)
    expect(server.runWorkerOnce).toBeDefined()
    await server.runWorkerOnce()
    expect(sequence.at(-1)).toBe("worker")
  })
})
