import { describe, expect, test } from "bun:test"
import { manualProviderResultSummary } from "../scripts/manual-provider-result-summary"

describe("manual provider result summary", () => {
  test("classifies terminal failures without printing their message", () => {
    expect(manualProviderResultSummary(
      { state: "failed", terminalReason: "worker_interrupted", errorMessage: "TypeError: Cannot read properties of undefined (reading 'x'); sk-testsecret1234567890" },
      [
        { type: "provider.attempted", payload: { errorCategory: "rate_limit", response: "secret" } },
        { type: "provider.attempted", payload: { errorCategory: "transport" } },
        { type: "model.responded", payload: { response: "secret" } },
      ],
    )).toEqual({
      state: "failed",
      terminalReason: "worker_interrupted",
      failureKind: "TypeError:undefined_property",
      providerAttemptCount: 2,
      eventTypes: ["provider.attempted", "provider.attempted", "model.responded"],
      providerAttemptCategories: ["rate_limit", "transport"],
    })
  })
})
