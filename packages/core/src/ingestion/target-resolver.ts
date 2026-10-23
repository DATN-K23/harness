import type { TargetReference } from "./report-normalizer"

/** Lines read from one file to confirm a target; declarations further down are not searched. */
export const MaxResolutionLines = 5_000

export interface ResolvedTarget {
  contract: string
  functionName: string
  /** Named by an explicit target field and not confirmed by reading; the compiler checks it when it can. */
  explicit: boolean
}

interface Declaration {
  name: string
  line: number
  contract?: string
}

/** Comments become spaces, newlines are kept, so line numbers still match the file. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, " "))

const lineAt = (source: string, index: number) => source.slice(0, index).split("\n").length

/** Function declarations with the contract, library or interface declared before them in the file. */
const functionsOf = (source: string): Declaration[] => {
  const code = withoutComments(source)
  const types = [...code.matchAll(/\b(?:abstract\s+contract|contract|library|interface)\s+([A-Za-z_$][\w$]*)/g)].map(
    (match) => ({ name: match[1]!, line: lineAt(code, match.index) }),
  )
  return [...code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => {
    const line = lineAt(code, match.index)
    const owner = types.filter((type) => type.line <= line).at(-1)
    return { name: match[1]!, line, ...(owner === undefined ? {} : { contract: owner.name }) }
  })
}

const segments = (path: string) => path.replaceAll("\\", "/").split("/").filter((segment) => segment !== "" && segment !== ".")

/** Snapshot paths sharing the longest trailing path with a report path (a link carries its own repository prefix). */
const filesFor = (reference: string, paths: readonly string[]) => {
  const wanted = segments(reference)
  const scored = paths.map((path) => {
    const have = segments(path)
    let shared = 0
    while (shared < Math.min(have.length, wanted.length) && have.at(-1 - shared) === wanted.at(-1 - shared)) shared += 1
    return { path, shared }
  })
  const best = Math.max(0, ...scored.map((entry) => entry.shared))
  return best === 0 ? [] : scored.filter((entry) => entry.shared === best).map((entry) => entry.path)
}

const basename = (path: string) => segments(path).at(-1) ?? ""

/**
 * The first reference that names exactly one function in the snapshot. Explicit `Contract.function` targets are
 * accepted as written; every other reference is confirmed by reading only the file it points to (or, for a bare
 * `Contract.function`, the file named after the contract), so an unconfirmed guess never becomes a target.
 */
export const resolveTarget = async (
  references: readonly TargetReference[],
  paths: readonly string[],
  read: (path: string) => Promise<string | undefined>,
): Promise<ResolvedTarget | undefined> => {
  for (const reference of references) {
    if (reference.explicit && reference.contract !== undefined && reference.functionName !== undefined)
      return { contract: reference.contract, functionName: reference.functionName, explicit: true }
    const files =
      reference.filePath !== undefined
        ? filesFor(reference.filePath, paths)
        : paths.filter((path) => basename(path) === `${reference.contract}.sol`)
    if (files.length !== 1) continue
    const source = await read(files[0]!)
    if (source === undefined) continue
    const functions = functionsOf(source)
    const matches =
      reference.functionName !== undefined
        ? functions.filter(
            (fn) =>
              fn.name === reference.functionName && (reference.contract === undefined || fn.contract === reference.contract),
          )
        : reference.line !== undefined
          ? functions.filter((fn) => fn.line <= reference.line!).slice(-1)
          : []
    const owners = new Set(matches.map((fn) => fn.contract))
    const owner = matches[0]?.contract
    if (owners.size === 1 && owner !== undefined) return { contract: owner, functionName: matches[0]!.name, explicit: false }
  }
  return undefined
}
