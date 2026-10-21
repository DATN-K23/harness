import { describe, expect, test } from "bun:test"
import { ApiCompatibility, validateApiCompatibility, isLoopbackHost, isAuthorizedLocalRequest } from "../src/runtime-security"
import { listenLocal } from "../src/local-server"

describe("local runtime security", () => {
  test("accepts compatible API version and contract digest", () => {
    expect(validateApiCompatibility(ApiCompatibility, ApiCompatibility)).toEqual({ compatible: true })
  })

  test("rejects incompatible major version or contract digest with upgrade details", () => {
    expect(validateApiCompatibility({ apiVersion: 2, contractDigest: ApiCompatibility.contractDigest }, ApiCompatibility)).toEqual({
      compatible: false,
      reason: "api_version_mismatch",
      expectedApiVersion: 1,
      receivedApiVersion: 2,
    })
    expect(validateApiCompatibility({ apiVersion: 1, contractDigest: "sha256:other" }, ApiCompatibility)).toEqual({
      compatible: false,
      reason: "contract_digest_mismatch",
      expectedContractDigest: "sha256:harness-api-v1",
      receivedContractDigest: "sha256:other",
    })
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
      headers: credential === undefined ? {} : { authorization: `Bearer ${credential}` },
    })
    expect(isAuthorizedLocalRequest(request(), "installation-secret")).toBe(false)
    expect(isAuthorizedLocalRequest(request("wrong-secret"), "installation-secret")).toBe(false)
    expect(isAuthorizedLocalRequest(request("installation-secret"), "installation-secret")).toBe(true)
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
})
