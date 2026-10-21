import { describe, expect, test } from "bun:test"
import { isLoopbackHost, isAuthorizedLocalRequest } from "../src/runtime-security"

describe("local runtime security", () => {
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

  test("never accepts a credential from the URL", () => {
    const request = new Request("http://127.0.0.1/health?token=installation-secret")
    expect(isAuthorizedLocalRequest(request, "installation-secret")).toBe(false)
  })
})
