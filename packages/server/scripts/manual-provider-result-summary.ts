type ManualEvent = { type: string; payload: Record<string, unknown> }

export function manualProviderResultSummary(status: Record<string, unknown>, events: ManualEvent[]) {
  const attempts = events.filter((event) => event.type === "provider.attempted")
  return {
    state: status.state,
    ...(status.terminalReason === undefined ? {} : { terminalReason: status.terminalReason }),
    ...(status.errorCategory === undefined ? {} : { errorCategory: status.errorCategory }),
    providerAttemptCount: attempts.length,
    eventTypes: events.map((event) => event.type),
    providerAttemptCategories: attempts.map((event) => event.payload.errorCategory ?? null),
  }
}
