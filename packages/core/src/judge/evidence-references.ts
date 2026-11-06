import type { JudgeVerdict, SecurityFilterPort, SourceSnapshotPort } from "@harness/protocol"
import { textDigest } from "../util/digest"

/** Spans taken from the model's own text; more, or longer, are not read. */
const MaxReferences = 8
const MaxReferenceLines = 80

export interface SourceReference {
  filePath: string
  startLine: number
  endLine: number
}

const patterns = [
  // core/contracts/Clearinghouse.sol:228-231, Clearinghouse.sol:228
  /([\w./-]+\.sol):(\d+)(?:\s*[-–]\s*(\d+))?/g,
  // Clearinghouse.sol (lines 228-231), Clearinghouse.sol (L228-L231)
  /([\w./-]+\.sol)\s*\(\s*(?:lines?\s*|L)(\d+)(?:\s*[-–]\s*L?(\d+))?\s*\)/gi,
  // Clearinghouse.sol lines 228-231, Clearinghouse.sol, line 228
  /([\w./-]+\.sol),?\s+lines?\s+(\d+)(?:\s*[-–]\s*(\d+))?/gi,
]

/** The `File.sol:line` style references in a text, in order, without duplicates. */
export const sourceReferences = (text: string): SourceReference[] => {
  const found = new Map<string, SourceReference>()
  for (const pattern of patterns)
    for (const match of text.matchAll(pattern)) {
      const startLine = Number(match[2])
      const endLine = match[3] === undefined ? startLine : Number(match[3])
      if (startLine < 1 || endLine < startLine || endLine - startLine >= MaxReferenceLines) continue
      const reference = { filePath: match[1]!, startLine, endLine }
      found.set(`${reference.filePath}:${startLine}-${endLine}`, reference)
    }
  return [...found.values()].slice(0, MaxReferences)
}

const segments = (path: string) => path.replaceAll("\\", "/").split("/").filter((segment) => segment !== "" && segment !== ".")

/** The one snapshot path a reference names: exact, or the unique path ending with the referenced segments. */
const snapshotPath = (reference: string, paths: readonly string[]) => {
  const wanted = segments(reference)
  if (wanted.includes("..")) return undefined
  const matches = paths.filter((path) => {
    const have = segments(path)
    return have.length >= wanted.length && wanted.every((segment, index) => have[have.length - wanted.length + index] === segment)
  })
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Evidence for the source the model referred to in its own words (the verdict reasoning and the direction results),
 * read by the harness from the snapshot: the model points, the harness reads what is really there. A reference that
 * names no single snapshot file, or lines outside it, is dropped. Citations already in the verdict are kept first.
 */
export const withReferencedEvidence = async (
  deps: { snapshot: SourceSnapshotPort; security: SecurityFilterPort },
  input: { verdict: JudgeVerdict; texts: readonly string[]; snapshotId: string; signal?: AbortSignal },
): Promise<JudgeVerdict> => {
  const references = sourceReferences(input.texts.join("\n"))
  if (references.length === 0) return input.verdict
  const paths = await deps.snapshot.listFiles({ snapshotId: input.snapshotId }, input.signal)
  const cited = new Set(input.verdict.citesEvidence.map((evidence) => `${evidence.filePath}:${evidence.startLine}-${evidence.endLine}`))
  const added: JudgeVerdict["citesEvidence"] = []
  for (const reference of references) {
    const path = snapshotPath(reference.filePath, paths)
    if (path === undefined || cited.has(`${path}:${reference.startLine}-${reference.endLine}`)) continue
    const read = await deps.snapshot.readLines(
      { snapshotId: input.snapshotId, path, startLine: reference.startLine, endLine: reference.endLine },
      input.signal,
    )
    if (read.kind !== "ok") continue
    const exact = read.lines.join("\n")
    const filtered = await deps.security.filterSecrets(exact, input.signal)
    cited.add(`${path}:${reference.startLine}-${reference.endLine}`)
    added.push({
      filePath: path,
      startLine: reference.startLine,
      endLine: reference.endLine,
      explanation: "Referred to in the model's reasoning; lines read from the snapshot by the harness.",
      snippet: filtered.content,
      contentDigest: textDigest(exact),
    })
  }
  return added.length === 0 ? input.verdict : { ...input.verdict, citesEvidence: [...input.verdict.citesEvidence, ...added] }
}
