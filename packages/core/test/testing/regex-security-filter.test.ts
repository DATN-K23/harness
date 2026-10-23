import { describe, expect, test } from "bun:test"
import type { ContextItem } from "@harness/protocol"
import { PassThroughContextEngine } from "../../src/testing/fake-context-engines"
import { InMemoryToolRegistry } from "../../src/testing/in-memory-tool-registry"
import { RegexSecurityFilter, Redacted } from "../../src/testing/regex-security-filter"
import { ScriptedModelGateway, textResponse } from "../../src/testing/scripted-model-gateway"

const apiKey = "sk-abcdefghijklmnop1234"
const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nline2\n-----END RSA PRIVATE KEY-----"

describe("RegexSecurityFilter", () => {
  test("redacts an sk- key and counts it", async () => {
    const result = await new RegexSecurityFilter().filterSecrets(`token=${apiKey} trailing`)
    expect(result).toEqual({ content: `token=${Redacted} trailing`, redactionCount: 1 })
  })

  test.each([
    ["bearer token", "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig=="],
    ["Google API key", "key=AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUv"],
    ["AWS temporary key", "id ASIAABCDEFGHIJKLMNOP"],
    ["GitHub OAuth token", "token gho_abcdefghijklmnopqrstuvwxyz0123"],
  ])("redacts a %s (OpenCode secret formats)", async (_name, text) => {
    const result = await new RegexSecurityFilter().filterSecrets(text)
    expect(result.redactionCount).toBe(1)
    expect(result.content).toContain(Redacted)
  })

  test("redacts a hyphenated sk- key as one match", async () => {
    const result = await new RegexSecurityFilter().filterSecrets("key sk-ant-api03-AbCdEfGhIjKlMnOpQrSt end")
    expect(result).toEqual({ content: `key ${Redacted} end`, redactionCount: 1 })
  })

  test("redacts PRIVATE_KEY assignments in several spellings, not the bare word", async () => {
    const filter = new RegexSecurityFilter()
    const result = await filter.filterSecrets(
      ["PRIVATE_KEY=0xabc123", 'DEPLOYER_PRIVATE_KEY: "0xdef456"', "uses PRIVATE_KEY from the env"].join("\n"),
    )
    expect(result.content).toBe([Redacted, Redacted, "uses PRIVATE_KEY from the env"].join("\n"))
    expect(result.redactionCount).toBe(2)
  })

  test("redacts a multi-line PEM private key block as one match", async () => {
    const result = await new RegexSecurityFilter().filterSecrets(`before\n${pem}\nafter`)
    expect(result).toEqual({ content: `before\n${Redacted}\nafter`, redactionCount: 1 })
  })

  test("counts every occurrence, across different shapes", async () => {
    const result = await new RegexSecurityFilter().filterSecrets(`${apiKey} ${apiKey}\nAWS AKIAABCDEFGHIJKLMNOP`)
    expect(result.redactionCount).toBe(3)
    expect(result.content).toBe(`${Redacted} ${Redacted}\nAWS ${Redacted}`)
  })

  test("leaves clean content untouched with a zero count", async () => {
    const content = "task-list sk-short ask-me-anything function withdraw() {}"
    expect(await new RegexSecurityFilter().filterSecrets(content)).toEqual({ content, redactionCount: 0 })
  })

  test("is idempotent and does not carry regex state between calls", async () => {
    const filter = new RegexSecurityFilter()
    const once = await filter.filterSecrets(`a ${apiKey} b`)
    const again = await filter.filterSecrets(once.content)
    expect(again).toEqual({ content: once.content, redactionCount: 0 })
    expect(await filter.filterSecrets(`a ${apiKey} b`)).toEqual(once)
    expect(filter.callCount).toBe(3)
  })

  test("accepts custom patterns, global or not", async () => {
    const filter = new RegexSecurityFilter([/internal-\d+/, /\bTOKEN\b/g])
    const result = await filter.filterSecrets("internal-12 internal-34 TOKEN")
    expect(result).toEqual({ content: `${Redacted} ${Redacted} ${Redacted}`, redactionCount: 3 })
  })
})

describe("redaction happens before any later step", () => {
  // The step order the runner must follow: tool output -> security filter -> shape -> context item -> model request.
  test("a secret read by a tool never reaches the shaped output, the context item or the model request", async () => {
    const files = { "config/deploy.env": `RPC=http://localhost\nPRIVATE_KEY=0xdeadbeef\nAPI=${apiKey}\n${pem}\n` }
    const tools = new InMemoryToolRegistry({ files })
    const filter = new RegexSecurityFilter()
    const engine = new PassThroughContextEngine()
    const gateway = new ScriptedModelGateway([textResponse("done")])

    const raw = await tools.execute({
      runId: "run-1",
      callId: "call-1",
      toolName: "read_file",
      arguments: { path: "config/deploy.env" },
    })
    expect(raw.content).toContain(apiKey)

    const filtered = await filter.filterSecrets(raw.content)
    expect(filtered.redactionCount).toBe(3)
    const shaped = await engine.shapeToolResult({
      content: filtered.content,
      toolName: "read_file",
      policy: {
        policyVersion: "p",
        windowLimitTokens: 1_000,
        outputReserveTokens: 100,
        compactionThreshold: 0.8,
        safetyMarginFactor: 1.2,
        recentWindowTokens: 100,
        toolOutputMaxTokens: 500,
        toolOutputMaxLines: 50,
        maxCompactions: 1,
        flags: {
          enableToolTruncation: true,
          enableObsMasking: false,
          enableSupersedeReads: false,
          enableDropEmpty: false,
          enableLlmCompaction: false,
          enableSessionNote: false,
        },
      },
    })
    const item: ContextItem = {
      id: "item-1",
      turn: 1,
      type: "tool_result",
      isPinned: false,
      content: shaped.content,
      toolMeta: { callId: "call-1", toolName: "read_file", filePath: raw.filePath },
    }
    await gateway.executeAttempt({ runId: "run-1", stepIndex: 1, attemptIndex: 0, profileId: "p", items: [item] })

    const everythingLater = JSON.stringify([shaped, item, gateway.calls])
    for (const secret of [apiKey, "0xdeadbeef", "MIIEowIBAAKCAQEA"]) expect(everythingLater).not.toContain(secret)
    expect(everythingLater).toContain(Redacted)
    expect(everythingLater).toContain("RPC=http://localhost")
  })
})
