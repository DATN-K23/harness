import type { SourceSnapshotPort } from "@harness/protocol"

export interface SnapshotFindingTitle {
  findingId: string
  title: string
}

export interface SnapshotContaminationInput {
  snapshot: SourceSnapshotPort
  snapshotId: string
  findings: Array<SnapshotFindingTitle>
}

export interface SnapshotContaminationLeak {
  findingId: string
  paths: string[]
}

export interface SnapshotContaminationResult {
  clean: boolean
  leaks: SnapshotContaminationLeak[]
}

/** Scorer-side preflight: finding titles are compared only against snapshot text and returned as IDs and paths. */
export async function checkSnapshotContamination({
  snapshot,
  snapshotId,
  findings,
}: SnapshotContaminationInput): Promise<SnapshotContaminationResult> {
  const paths = await snapshot.listFiles({ snapshotId })
  const normalizedFiles = new Map<string, string>()

  for (const filePath of paths) {
    const firstRead = await snapshot.readLines({
      snapshotId,
      path: filePath,
      startLine: 1,
      endLine: Number.MAX_SAFE_INTEGER,
    })
    let lines: string[]
    if (firstRead.kind === "ok") {
      lines = firstRead.lines
    } else if (firstRead.kind === "out_of_range") {
      if (firstRead.lineCount === 0) {
        lines = []
      } else {
        const completeRead = await snapshot.readLines({
          snapshotId,
          path: filePath,
          startLine: 1,
          endLine: firstRead.lineCount,
        })
        if (completeRead.kind !== "ok") throw new Error("Could not read snapshot file for contamination check")
        lines = completeRead.lines
      }
    } else {
      throw new Error("Could not read snapshot file for contamination check")
    }
    normalizedFiles.set(filePath, normalizeForSearch(lines.join("\n")))
  }

  const leaks: SnapshotContaminationLeak[] = []
  for (const finding of findings) {
    const normalizedTitle = normalizeForSearch(finding.title)
    if (normalizedTitle.length < 12) continue
    const matches = [...normalizedFiles.entries()]
      .filter(([, content]) => content.includes(normalizedTitle))
      .map(([filePath]) => filePath)
    if (matches.length > 0) leaks.push({ findingId: finding.findingId, paths: matches })
  }

  return { clean: leaks.length === 0, leaks }
}

function normalizeForSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}
