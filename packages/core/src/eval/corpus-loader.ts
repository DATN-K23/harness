/** Dataset split assignment for contest-level partitioning (Rule R3). */
export type DatasetSplit = "train" | "validation" | "test"

/** Contamination classification relative to model training knowledge cutoff date. */
export type ContaminationBucket = "pre_cutoff" | "post_cutoff" | "unknown"

/** Ground truth label information reserved strictly for the Scorer process (isolated from agent context). */
export interface ScorerGroundTruthLabel {
  readonly isTruePositive: boolean
  readonly verifiedVulnerability?: boolean
  readonly canonicalFindingId?: string
  readonly adjudicatorNotes?: string
}

/** Finding entry within an audited contest corpus. */
export interface CorpusFinding {
  readonly findingId: string
  readonly contestId: string
  readonly sourceSnapshotId: string
  readonly title: string
  readonly severity: string
  readonly reportMarkdown?: string
  readonly targetFiles?: readonly string[]
  /**
   * Ground truth annotation: strictly for offline scoring.
   * INVARIANT: Never passed to candidate finding inputs or agent tools.
   */
  readonly groundTruth?: ScorerGroundTruthLabel
}

/** Metadata and split allocation for a single competitive audit contest. */
export interface ContestManifestEntry {
  readonly contestId: string
  readonly split: DatasetSplit
  /** Family identifier grouping forks, clones, or shared codebases to prevent cross-split leakage. */
  readonly sourceFamilyId?: string
  readonly sourceRevision?: string
  readonly sourceDigest?: string
  readonly publicationDate?: string
  readonly cutoffContamination?: ContaminationBucket
  readonly findingCount?: number
  readonly ingestion?: {
    readonly dataRepoCommit: string
    readonly contestDir: string
    readonly includeRoots: readonly string[]
    readonly ingestionPolicyVersion: string
    readonly snapshotId?: string
    readonly treeDigest?: string
  }
  /** Scorer-only path to valid/invalid finding markdown files. */
  readonly findingsDir?: string
}

/** Complete corpus manifest governing contest-level partitioning and freeze state. */
export interface ContestCorpusManifest {
  readonly manifestVersion: string
  readonly frozen: boolean
  readonly manifestDigest?: string
  readonly contests: readonly ContestManifestEntry[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Specific violation codes for split validation under Rule R3. */
export type SplitViolationCode =
  | "SPLIT_CONFLICT"
  | "FAMILY_SPLIT_CONFLICT"
  | "FINDING_SPLIT_LEAKAGE"
  | "UNASSIGNED_CONTEST"

export interface SplitValidationIssue {
  readonly code: SplitViolationCode
  readonly message: string
  readonly contestId?: string
  readonly sourceFamilyId?: string
  readonly findingId?: string
}

export interface SplitValidationResult {
  readonly valid: boolean
  readonly issues: readonly SplitValidationIssue[]
}

/**
 * Validates that contest assignments and findings adhere strictly to Rule R3:
 * 1. Contest-level split: every contest is assigned to exactly one split (train, validation, or test).
 * 2. Family integrity: all contests in a sourceFamilyId share the same split.
 * 3. Finding integrity: findings cannot cross-split or partition within a contest.
 */
export const validateContestSplit = (
  manifest: ContestCorpusManifest,
  findings?: readonly CorpusFinding[],
): SplitValidationResult => {
  const issues: SplitValidationIssue[] = []
  const contestSplitMap = new Map<string, DatasetSplit>()
  const familySplitMap = new Map<string, { split: DatasetSplit; contestId: string }>()

  for (const contest of manifest.contests) {
    const existingSplit = contestSplitMap.get(contest.contestId)
    if (existingSplit !== undefined && existingSplit !== contest.split) {
      issues.push({
        code: "SPLIT_CONFLICT",
        message: `Contest '${contest.contestId}' is assigned to multiple conflicting splits: '${existingSplit}' and '${contest.split}' (violates Rule R3)`,
        contestId: contest.contestId,
      })
    } else {
      contestSplitMap.set(contest.contestId, contest.split)
    }

    if (contest.sourceFamilyId !== undefined && contest.sourceFamilyId.length > 0) {
      const existingFamily = familySplitMap.get(contest.sourceFamilyId)
      if (existingFamily !== undefined && existingFamily.split !== contest.split) {
        issues.push({
          code: "FAMILY_SPLIT_CONFLICT",
          message: `Source family '${contest.sourceFamilyId}' spans multiple splits: contest '${existingFamily.contestId}' in '${existingFamily.split}' vs contest '${contest.contestId}' in '${contest.split}' (violates Rule R3)`,
          contestId: contest.contestId,
          sourceFamilyId: contest.sourceFamilyId,
        })
      } else if (existingFamily === undefined) {
        familySplitMap.set(contest.sourceFamilyId, { split: contest.split, contestId: contest.contestId })
      }
    }
  }

  if (findings !== undefined) {
    for (const finding of findings) {
      if (!contestSplitMap.has(finding.contestId)) {
        issues.push({
          code: "UNASSIGNED_CONTEST",
          message: `Finding '${finding.findingId}' references contest '${finding.contestId}' which is not registered in the manifest`,
          contestId: finding.contestId,
          findingId: finding.findingId,
        })
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

/** Filters corpus findings to include only those assigned to the specified split. */
export const filterFindingsBySplit = (
  manifest: ContestCorpusManifest,
  findings: readonly CorpusFinding[],
  targetSplit: DatasetSplit,
): readonly CorpusFinding[] => {
  const splitContests = new Set(
    manifest.contests.filter((c) => c.split === targetSplit).map((c) => c.contestId),
  )
  return findings.filter((f) => splitContests.has(f.contestId))
}
