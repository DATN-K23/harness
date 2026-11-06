import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { ContestManifestEntry, DatasetSplit } from "./corpus-loader"
import { checkSnapshotContamination } from "./contamination"
import { ingestContestForEvaluation } from "./evaluation-ingest"
import { DiskSourceSnapshot } from "../source/disk-source-snapshot"

interface MutableIngestion {
  dataRepoCommit: string
  contestDir: string
  includeRoots: string[]
  ingestionPolicyVersion: string
  snapshotId?: string
  treeDigest?: string
}

interface VerificationContest extends ContestManifestEntry {
  contestId: string
  split: DatasetSplit
  findingsDir: string
  ingestion: MutableIngestion
}

interface VerificationManifest {
  manifestVersion: string
  frozen: boolean
  contests: VerificationContest[]
  metadata?: Record<string, unknown>
}

interface VerifyOptions {
  dataRoot?: string
  update: boolean
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const dataRoot = options.dataRoot ?? process.env.HARNESS_VERIFICATION_DATA
  if (dataRoot === undefined || dataRoot.trim() === "") {
    throw new Error("Provide --data-root or set HARNESS_VERIFICATION_DATA")
  }

  const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
  const manifestPath = path.join(repositoryRoot, "config", "corpus", "verification-data.manifest.json")
  const storageDir = path.join(repositoryRoot, "data", "snapshots")
  const manifest = parseManifest(await fs.readFile(manifestPath, "utf8"))
  let hasMismatch = false
  let hasLeaks = false

  for (const entry of manifest.contests) {
    const expectedSnapshotId = entry.ingestion.snapshotId
    const expectedTreeDigest = entry.ingestion.treeDigest
    const ingested = await ingestContestForEvaluation({ entry, dataRoot, storageDir })
    const snapshotMatch = expectedSnapshotId !== undefined && expectedSnapshotId === ingested.snapshotId
    const digestMatch = expectedTreeDigest !== undefined && expectedTreeDigest === ingested.manifest.treeDigest
    if (options.update) {
      entry.ingestion.snapshotId = ingested.snapshotId
      entry.ingestion.treeDigest = ingested.manifest.treeDigest
    } else if (!snapshotMatch || !digestMatch) {
      hasMismatch = true
    }

    const snapshot = new DiskSourceSnapshot({ storageDir, snapshotId: ingested.snapshotId })
    const findings = await readFindingTitles(dataRoot, entry.ingestion.contestDir, entry.findingsDir)
    const contamination = await checkSnapshotContamination({
      snapshot,
      snapshotId: ingested.snapshotId,
      findings,
    })
    if (!contamination.clean) hasLeaks = true

    const snapshotStatus = options.update ? "updated" : String(snapshotMatch)
    const digestStatus = options.update ? "updated" : String(digestMatch)
    console.log(
      `${entry.contestId} files=${Object.keys(ingested.manifest.files).length} ` +
        `snapshotId=${ingested.snapshotId} snapshotMatch=${snapshotStatus} ` +
        `digestMatch=${digestStatus} leaks=${contamination.leaks.length}`,
    )
    for (const leak of contamination.leaks) {
      console.log(`  leak findingId=${leak.findingId} paths=${leak.paths.join(",")}`)
    }
  }

  if (options.update) {
    const temporaryManifestPath = manifestPath + ".tmp-" + randomUUID()
    try {
      await fs.writeFile(temporaryManifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8")
      await fs.rename(temporaryManifestPath, manifestPath)
    } finally {
      await fs.rm(temporaryManifestPath, { force: true }).catch(() => {})
    }
  }
  if (hasMismatch || hasLeaks) process.exitCode = 1
}

function parseArgs(args: string[]): VerifyOptions {
  if (args[0] === "--") args.shift()
  let dataRoot: string | undefined
  let update = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--update") {
      update = true
    } else if (argument === "--data-root") {
      const value = args[index + 1]
      if (value === undefined || value.startsWith("--")) throw new Error("--data-root requires a path")
      dataRoot = value
      index += 1
    } else {
      throw new Error("Unknown corpus:verify argument")
    }
  }
  return { dataRoot, update }
}

function parseManifest(raw: string): VerificationManifest {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid corpus manifest")
  const value = parsed as Record<string, unknown>
  if (
    value.manifestVersion !== "verification-data-v1" ||
    typeof value.frozen !== "boolean" ||
    !Array.isArray(value.contests)
  ) {
    throw new Error("Invalid corpus manifest")
  }

  const contests = value.contests.map((item): VerificationContest => {
    if (typeof item !== "object" || item === null) throw new Error("Invalid corpus manifest entry")
    const entry = item as Record<string, unknown>
    const ingestion = entry.ingestion
    if (
      typeof entry.contestId !== "string" ||
      !["train", "validation", "test"].includes(entry.split as string) ||
      typeof entry.findingsDir !== "string" ||
      typeof ingestion !== "object" ||
      ingestion === null
    ) {
      throw new Error("Invalid corpus manifest entry")
    }
    const ingest = ingestion as Record<string, unknown>
    if (
      typeof ingest.dataRepoCommit !== "string" ||
      typeof ingest.contestDir !== "string" ||
      !Array.isArray(ingest.includeRoots) ||
      ingest.ingestionPolicyVersion !== "ingest-policy-v2" ||
      (ingest.snapshotId !== undefined && typeof ingest.snapshotId !== "string") ||
      (ingest.treeDigest !== undefined && typeof ingest.treeDigest !== "string")
    ) {
      throw new Error("Invalid corpus ingestion entry")
    }
    return {
      contestId: entry.contestId,
      split: entry.split as DatasetSplit,
      findingsDir: entry.findingsDir,
      ingestion: {
        dataRepoCommit: ingest.dataRepoCommit,
        contestDir: ingest.contestDir,
        includeRoots: ingest.includeRoots as string[],
        ingestionPolicyVersion: ingest.ingestionPolicyVersion,
        ...(typeof ingest.snapshotId === "string" ? { snapshotId: ingest.snapshotId } : {}),
        ...(typeof ingest.treeDigest === "string" ? { treeDigest: ingest.treeDigest } : {}),
      },
    }
  })

  return {
    manifestVersion: "verification-data-v1",
    frozen: value.frozen,
    contests,
    ...(typeof value.metadata === "object" && value.metadata !== null
      ? { metadata: value.metadata as Record<string, unknown> }
      : {}),
  }
}

async function readFindingTitles(
  dataRoot: string,
  contestDir: string,
  findingsDir: string,
): Promise<Array<{ findingId: string; title: string }>> {
  if (!isSafeRelativePath(contestDir) || !isSafeRelativePath(findingsDir)) {
    throw new Error("Corpus finding paths must be relative")
  }
  const contestRoot = path.resolve(dataRoot, contestDir)
  const findingsRoot = path.resolve(contestRoot, findingsDir)
  if (!isInside(contestRoot, findingsRoot)) throw new Error("Findings directory must remain inside the contest")

  const findings: Array<{ findingId: string; title: string }> = []
  for (const status of ["valid", "invalid"] as const) {
    const directory = path.join(findingsRoot, status)
    const stat = await fs.lstat(directory).catch(() => null)
    // `valid/` is required; `invalid/` is absent for contests without published invalid findings.
    if (!stat && status === "invalid") continue
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("A valid/invalid finding directory is missing")
    }
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue
      // `report.md` is the aggregated contest report page, not a single finding.
      if (entry.name.toLowerCase() === "report.md") continue
      const findingPath = path.join(directory, entry.name)
      const fileStat = await fs.lstat(findingPath)
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue
      const markdown = await fs.readFile(findingPath, "utf8")
      const parsed = parseFindingHeading(markdown, path.basename(entry.name, path.extname(entry.name)))
      findings.push(parsed)
    }
  }
  return findings
}

function parseFindingHeading(markdown: string, fallbackId: string): { findingId: string; title: string } {
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1]?.trim()
    if (heading === undefined) continue
    const linkedLabel = heading.match(/^\[(.*)\]\([^)]+\)$/)?.[1] ?? heading
    const idMatch = linkedLabel.match(/^\[([^\]]+)\]\s*/)
    return {
      findingId: idMatch?.[1] ?? fallbackId,
      title: idMatch === null ? linkedLabel : linkedLabel.slice(idMatch[0].length).trim(),
    }
  }
  throw new Error("Finding markdown is missing a heading")
}

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/")
  const segments = normalized.split("/")
  return (
    normalized.length > 0 &&
    !path.isAbsolute(value) &&
    !/^[A-Za-z]:/.test(normalized) &&
    segments.some((segment) => segment !== "" && segment !== ".") &&
    !segments.includes("..")
  )
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (process.env.CORPUS_VERIFY_DEBUG === "1") console.error(error)
    console.error("Corpus verification failed.")
    process.exitCode = 1
  })
}
