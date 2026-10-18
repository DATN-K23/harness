import * as path from "node:path"
import type { ContestManifestEntry } from "./corpus-loader"
import { SnapshotManager, type IngestResult } from "../source/snapshot-manager"

export interface IngestContestForEvaluationInput {
  entry: ContestManifestEntry
  dataRoot: string
  storageDir: string
}

/** Ingests a manifest-scoped contest source tree into harness-owned snapshot storage. */
export async function ingestContestForEvaluation({
  entry,
  dataRoot,
  storageDir,
}: IngestContestForEvaluationInput): Promise<IngestResult> {
  const ingestion = entry.ingestion
  const includeRoots = ingestion?.includeRoots
  if (
    includeRoots === undefined ||
    includeRoots.length === 0 ||
    includeRoots.some((root) => !isSafeIncludeRoot(root))
  ) {
    throw new Error("Evaluation ingestion requires non-empty relative includeRoots")
  }
  if (ingestion === undefined || !isSafeRelativePath(ingestion.contestDir)) {
    throw new Error("Evaluation ingestion requires a relative contestDir")
  }

  const resolvedDataRoot = path.resolve(dataRoot)
  const resolvedStorageDir = path.resolve(storageDir)
  const storageRelative = path.relative(resolvedDataRoot, resolvedStorageDir)
  if (isInsideDataRoot(storageRelative)) throw new Error("Snapshot storage must be outside dataRoot")

  const sourceDir = path.resolve(resolvedDataRoot, ingestion.contestDir, "src")
  const relativeSource = path.relative(resolvedDataRoot, sourceDir)
  if (relativeSource === ".." || relativeSource.startsWith(".." + path.sep) || path.isAbsolute(relativeSource)) {
    throw new Error("Evaluation source directory must remain inside dataRoot")
  }

  return SnapshotManager.ingestRepository({
    sourceDir,
    storageDir,
    includeRoots: [...new Set([...includeRoots, "foundry.toml", "remappings.txt"])],
  })
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

function isSafeIncludeRoot(value: string): boolean {
  return isSafeRelativePath(value)
}

function isInsideDataRoot(relativePath: string): boolean {
  return relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(".." + path.sep) && !path.isAbsolute(relativePath))
}
