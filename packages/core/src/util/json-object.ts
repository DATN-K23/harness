const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const tryRecord = (candidate: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(candidate)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * The one JSON object in a model reply: the whole text, the body of a single ```json fence, or the outermost `{...}`
 * span when the model wrapped the object in prose. A top-level array is never sliced into an object.
 */
export const parseJsonObject = (text: string): Record<string, unknown> | undefined => {
  const trimmed = text.trim()
  const fenceBody = fenced.exec(trimmed)?.[1]
  const direct = tryRecord(fenceBody === undefined ? trimmed : fenceBody.trim())
  if (direct !== undefined) return direct
  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace === -1 || lastBrace <= firstBrace || trimmed.startsWith("[")) return undefined
  return tryRecord(trimmed.slice(firstBrace, lastBrace + 1).trim())
}
