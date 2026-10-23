import type { SnapshotReadResult, SourceSnapshotPort } from "@harness/protocol"

export type SnapshotPathCheck =
  | { kind: "ok"; path: string }
  | { kind: "denied"; reason: "absolute" | "traversal" | "denied_prefix" }

const absolutePath = /^(?:\/|[A-Za-z]:|file:\/\/)/i

const trimSlashes = (path: string) => path.replace(/\/+$/, "")

/**
 * Accepts only a normalized path relative to the snapshot root. Absolute host paths, `..` segments and anything under
 * a denied prefix are refused, which is the rule the real snapshot and tool adapters must also enforce.
 */
export const checkSnapshotPath = (input: string, deniedPrefixes: readonly string[] = []): SnapshotPathCheck => {
  const slashed = input.replaceAll("\\", "/")
  if (absolutePath.test(slashed)) return { kind: "denied", reason: "absolute" }
  const segments = slashed.split("/").filter((segment) => segment !== "" && segment !== ".")
  if (segments.includes("..")) return { kind: "denied", reason: "traversal" }
  const path = segments.join("/")
  const denied = deniedPrefixes.map((prefix) => trimSlashes(prefix.replaceAll("\\", "/")).replace(/^\.\//, ""))
  if (denied.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
    return { kind: "denied", reason: "denied_prefix" }
  return { kind: "ok", path }
}

/** Locale-independent, so listings are identical on every machine. */
export const comparePaths = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

/** Lines of a file; a trailing newline does not add an empty last line. */
export const splitLines = (content: string) => {
  if (content === "") return []
  const lines = content.split("\n")
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines
}

const globStar = "<<globstar>>"
const globStarSlash = "<<globstar-slash>>"

/** `*` and `?` stay inside a path segment, `**` crosses segments, and `**` followed by `/` may match nothing. */
export const globToRegExp = (pattern: string) => {
  const source = pattern
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**/", globStarSlash)
    .replaceAll("**", globStar)
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll(globStarSlash, "(?:.*/)?")
    .replaceAll(globStar, ".*")
  return new RegExp(`^${source}$`)
}

export const normalizeFiles = (files: Readonly<Record<string, string>>) =>
  new Map(
    Object.entries(files).map(([path, content]) => {
      const checked = checkSnapshotPath(path)
      if (checked.kind === "denied") throw new Error(`fixture path ${path} must be relative to the snapshot root`)
      return [checked.path, content] as const
    }),
  )

export interface SourceSnapshotOptions {
  snapshotId: string
  deniedPrefixes?: readonly string[]
}

export const DEFAULT_DENIED_PREFIXES: readonly string[] = [
  ".git",
  ".env",
  ".github",
  "node_modules",
  "adjudication",
  "test/ground-truth",
  "ground-truth",
  "groundtruth",
  "scoring",
]

const deniedDirectoryNames = new Set([
  ...DEFAULT_DENIED_PREFIXES.map((prefix) => prefix.toLowerCase()),
  "audits",
  "discord-export",
  ".claude",
  ".cursor",
])
const reportExtensions = new Set([".md", ".txt", ".html", ".htm", ".pdf", ".json"])
const reportNameFragments = [
  "findings",
  "_v12",
  "post-mortem",
  "postmortem",
  "4naly3er",
  "audit-report",
  "audit report",
]

export const isDeniedSourceFile = (relativePath: string, extraDeniedPrefixes: readonly string[] = []): boolean => {
  const checked = checkSnapshotPath(relativePath)
  if (checked.kind === "denied") return true

  const segments = checked.path.split("/").map((segment) => segment.toLowerCase())
  if (segments.some((segment) => deniedDirectoryNames.has(segment))) return true

  const normalizedPath = checked.path.toLowerCase()
  const denied = extraDeniedPrefixes.map((prefix) =>
    prefix.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase(),
  )
  if (denied.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(prefix + "/"))) return true

  // Check filename patterns (e.g. .env*, *.pem, *.key, id_rsa*)
  const filename = segments.at(-1) ?? ""
  if (filename.startsWith(".env")) return true
  if (filename.endsWith(".pem") || filename.endsWith(".key") || filename.startsWith("id_rsa")) return true

  const extension = filename.match(/\.[^.]+$/)?.[0] ?? ""
  if (reportExtensions.has(extension) && reportNameFragments.some((fragment) => filename.includes(fragment))) return true

  return false
}

export type { SnapshotReadResult, SourceSnapshotPort }
