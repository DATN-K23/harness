type ManualEvent = { type: string; payload: Record<string, unknown> }

const failureKind = (message: string) => {
  if (/Cannot read properties of undefined/i.test(message)) return "TypeError:undefined_property"
  if (/Cannot read properties of null/i.test(message)) return "TypeError:null_property"
  if (/^TypeError:/i.test(message)) return "TypeError"
  if (/^RangeError:/i.test(message)) return "RangeError"
  if (/^ReferenceError:/i.test(message)) return "ReferenceError"
  if (/^SyntaxError:/i.test(message)) return "SyntaxError"
  if (/rate.?limit|429/i.test(message)) return "rate_limit"
  if (/timeout|timed.?out/i.test(message)) return "timeout"
  if (/econnrefused|econnreset|network|socket/i.test(message)) return "network"
  if (/context_length_exceeded|too many tokens|context window/i.test(message)) return "context_length"
  if (/tokeniz|encoding/i.test(message)) return "tokenizer"
  if (/context engine|context budget|context result/i.test(message)) return "context"
  if (/snapshot|source file/i.test(message)) return "snapshot"
  if (/security|secret filter/i.test(message)) return "security_filter"
  if (/database|store|persist/i.test(message)) return "persistence"
  return "other"
}

export function manualProviderResultSummary(status: Record<string, unknown>, events: ManualEvent[]) {
  const attempts = events.filter((event) => event.type === "provider.attempted")
  const errorMessage = typeof status.errorMessage === "string" ? status.errorMessage : undefined
  return {
    state: status.state,
    ...(status.terminalReason === undefined ? {} : { terminalReason: status.terminalReason }),
    ...(status.errorCategory === undefined ? {} : { errorCategory: status.errorCategory }),
    ...(errorMessage === undefined ? {} : { failureKind: failureKind(errorMessage) }),
    providerAttemptCount: attempts.length,
    eventTypes: events.map((event) => event.type),
    providerAttemptCategories: attempts.map((event) => event.payload.errorCategory ?? null),
  }
}
