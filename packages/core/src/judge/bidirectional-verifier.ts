export type ForwardResult = { reachability: "reachable" | "blocked" | "incomplete" }
export type BackwardResult = { reconstruction: "reconstructed" | "blocked" | "incomplete" }
export type ConsensusDecision = "agreed-valid" | "agreed-invalid" | "disputed" | "inconclusive"

export type ParsedResult<T> = { kind: "ok"; result: T } | { kind: "invalid" }

const parseResult = <T extends Record<string, unknown>>(text: string, field: string, values: readonly string[]): ParsedResult<T> => {
  try {
    const value: unknown = JSON.parse(text.trim())
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { kind: "invalid" }
    const result = value as Record<string, unknown>
    if (
      Object.keys(result).length !== 2 ||
      !Object.hasOwn(result, field) ||
      !Object.hasOwn(result, "explanation") ||
      !values.includes(result[field] as string) ||
      typeof result.explanation !== "string" ||
      result.explanation.trim() === ""
    )
      return { kind: "invalid" }
    return { kind: "ok", result: result as T }
  } catch {
    return { kind: "invalid" }
  }
}

export const parseForwardResult = (text: string): ParsedResult<ForwardResult & { explanation: string }> =>
  parseResult(text, "reachability", ["reachable", "blocked", "incomplete"])

export const parseBackwardResult = (text: string): ParsedResult<BackwardResult & { explanation: string }> =>
  parseResult(text, "reconstruction", ["reconstructed", "blocked", "incomplete"])

export const decideConsensus = (forward: ForwardResult, backward: BackwardResult): ConsensusDecision => {
  if (forward.reachability === "blocked" && backward.reconstruction === "blocked") return "agreed-invalid"
  if (forward.reachability === "reachable" && backward.reconstruction === "reconstructed") return "agreed-valid"
  if (forward.reachability === "incomplete" && backward.reconstruction === "incomplete") return "inconclusive"
  if (forward.reachability === "blocked" || backward.reconstruction === "blocked") return "disputed"
  if (forward.reachability === "incomplete" || backward.reconstruction === "incomplete") return "disputed"
  return "disputed"
}
