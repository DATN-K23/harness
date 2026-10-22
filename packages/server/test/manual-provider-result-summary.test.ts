import { describe, expect, test } from "bun:test"
import { manualProviderResultSummary } from "../scripts/manual-provider-result-summary"

describe("manual provider result summary", () => {
  test("keeps only terminal metadata and normalized provider-attempt categories", () => {
    expect(manualProviderResultSummary(
      { state: "failed", terminalReason: "provider_error", errorCategory: "transport", errorMessage: "secret response" },
      [
        { type: "provider.attempted", payload: { errorCategory: "rate_limit", response: "secret" } },
        { type: "provider.attempted", payload: { errorCategory: "transport" } },
        { type: "model.responded", payload: { response: "secret" } },
      ],
    )).toEqual({
      state: "failed",
      terminalReason: "provider_error",
      errorCategory: "transport",
      providerAttemptCount: 2,
      eventTypes: ["provider.attempted", "provider.attempted", "model.responded"],
      providerAttemptCategories: ["rate_limit", "transport"],
    })
  })
})
