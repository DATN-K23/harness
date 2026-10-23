import { describe, expect, test } from "bun:test"
import { claimExtractionItems, claimExtractionPrompt, parseExtractedFields } from "../../src/judge/claim-extraction"
import { loadPrompt } from "../../src/prompts/index"

describe("claim extraction", () => {
  test("uses prompt v2, whose instructions avoid attack vocabulary", () => {
    expect(claimExtractionPrompt().digest).toBe(loadPrompt("claim-extraction.v2").digest)
    expect(claimExtractionPrompt().text).not.toMatch(/attack|exploit/i)
  })

  test("quotes the report verbatim in <report> tags after the snapshot paths, in one user item", () => {
    let id = 0
    const items = claimExtractionItems({ reportMarkdown: "# Title\n\nBody", sourcePaths: ["src/A.sol"], id: () => `i${id++}` })
    expect(items.map((item) => item.type)).toEqual(["system_prompt", "candidate_finding"])
    expect(items[1]!.content).toBe("Snapshot Solidity files:\nsrc/A.sol\n\n<report>\n# Title\n\nBody\n</report>")
  })

  test("reads v2's neutral keys and still accepts v1's", () => {
    expect(parseExtractedFields('{"target":"A.f","rootCause":"r","callSequence":"c","consequence":"i","stateChange":null}')).toEqual({
      target: "A.f",
      rootCause: "r",
      attackScenario: "c",
      impact: "i",
    })
    expect(parseExtractedFields('{"attackScenario":"c","impact":"i","state":"s"}')).toEqual({ attackScenario: "c", impact: "i", state: "s" })
    expect(parseExtractedFields("target: src/A.sol")).toBeUndefined()
  })
})

describe("submit_verification", () => {
  test("a forced direction is offered only its own field, required with the explanation", async () => {
    const { submitVerificationTool } = await import("../../src/judge/structured-output")
    const backward = submitVerificationTool("backward").parameters as { properties: Record<string, unknown>; required: string[] }
    expect(Object.keys(backward.properties).sort()).toEqual(["explanation", "reconstruction"])
    expect(backward.required).toEqual(["reconstruction", "explanation"])
    const both = submitVerificationTool().parameters as { properties: Record<string, unknown> }
    expect(Object.keys(both.properties).sort()).toEqual(["explanation", "reachability", "reconstruction"])
  })
})

