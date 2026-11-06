// Fields of a JSON finding (Hound hypothesis, verification-data JSON) that describe the claim; everything else,
// such as status, confidence or model names, is adjudication metadata and is dropped (Rule R2).
const ClaimFields = [
  "title",
  "severity",
  "vulnerability_type",
  "description",
  "implicated_functions",
  "affected_functions",
  "node_refs",
  "source_files",
  "expected_invariants",
  "reasoning",
] as const

/**
 * A JSON finding becomes markdown holding only its claim fields, one `## field` section each, so the report
 * normalizer reads it like any sectioned report. Any non-JSON report is returned as is. `undefined` means the text is
 * JSON but not one finding object with a claim field (an array, a Hound `hypotheses.json` collection, a scalar).
 */
export const claimMarkdown = (report: string): string | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(report)
  } catch {
    return report
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  const nested = typeof record.properties === "object" && record.properties !== null ? (record.properties as Record<string, unknown>) : {}
  const sections = ClaimFields.flatMap((field) => {
    const value = record[field] ?? nested[field]
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0) || value === "") return []
    return [`## ${field}\n\n${typeof value === "string" ? value : JSON.stringify(value)}`]
  })
  return sections.length === 0 ? undefined : sections.join("\n\n")
}
