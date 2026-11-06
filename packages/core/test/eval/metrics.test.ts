import { describe, expect, test } from "bun:test"
import {
  calculateClassificationMetrics,
  calculateComparisonDeltas,
  calculateDelta,
  calculateF1,
  calculateF1FromMatrix,
  calculateMetricComparison,
  calculatePrecision,
  calculateRecall,
  evaluateRq1Gates,
  filterFindingsBySplit,
  validateContestSplit,
  type ClassificationMetrics,
  type ConfusionMatrix,
  type ContestCorpusManifest,
  type CorpusFinding,
} from "../../src/eval"

describe("Precision calculation", () => {
  test("calculates precision correctly when true positives and false positives are present", () => {
    // P = 8 / (8 + 2) = 0.8
    expect(calculatePrecision(8, 2)).toBeCloseTo(0.8, 5)
  })

  test("returns 1.0 when false positives are zero", () => {
    expect(calculatePrecision(10, 0)).toBe(1.0)
  })

  test("returns 0.0 when true positives are zero", () => {
    expect(calculatePrecision(0, 5)).toBe(0.0)
  })

  test("handles zero denominator safely by returning 0.0", () => {
    expect(calculatePrecision(0, 0)).toBe(0.0)
  })
})

describe("Recall calculation", () => {
  test("calculates recall correctly when true positives and false negatives are present", () => {
    // R = 8 / (8 + 2) = 0.8
    expect(calculateRecall(8, 2)).toBeCloseTo(0.8, 5)
  })

  test("returns 1.0 when false negatives are zero", () => {
    expect(calculateRecall(10, 0)).toBe(1.0)
  })

  test("returns 0.0 when true positives are zero", () => {
    expect(calculateRecall(0, 5)).toBe(0.0)
  })

  test("handles zero denominator safely by returning 0.0", () => {
    expect(calculateRecall(0, 0)).toBe(0.0)
  })
})

describe("F1 calculation", () => {
  test("calculates harmonic mean of precision and recall", () => {
    // P = 0.8, R = 0.8 => F1 = 0.8
    expect(calculateF1(0.8, 0.8)).toBeCloseTo(0.8, 5)

    // P = 1.0, R = 0.5 => 2 * (1.0 * 0.5) / (1.5) = 1.0 / 1.5 = 2/3
    expect(calculateF1(1.0, 0.5)).toBeCloseTo(2 / 3, 5)
  })

  test("returns 0.0 when both precision and recall are zero", () => {
    expect(calculateF1(0.0, 0.0)).toBe(0.0)
  })

  test("calculates F1 directly from confusion matrix", () => {
    const matrix: ConfusionMatrix = {
      truePositives: 8,
      falsePositives: 2,
      falseNegatives: 2,
    }
    // F1 = (2 * 8) / (2 * 8 + 2 + 2) = 16 / 20 = 0.8
    expect(calculateF1FromMatrix(matrix)).toBeCloseTo(0.8, 5)
  })

  test("handles empty confusion matrix returning 0.0", () => {
    const empty: ConfusionMatrix = {
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
    }
    expect(calculateF1FromMatrix(empty)).toBe(0.0)
  })
})

describe("Classification metrics composite", () => {
  test("computes precision, recall, and F1 from confusion matrix", () => {
    const matrix: ConfusionMatrix = {
      truePositives: 9,
      falsePositives: 1,
      falseNegatives: 3,
    }
    const metrics = calculateClassificationMetrics(matrix)

    expect(metrics.precision).toBeCloseTo(0.9, 5)
    expect(metrics.recall).toBeCloseTo(0.75, 5)
    expect(metrics.f1).toBeCloseTo((2 * 0.9 * 0.75) / (0.9 + 0.75), 5)
    expect(metrics.accuracy).toBeUndefined()
  })

  test("includes accuracy when true negatives are provided", () => {
    const matrix: ConfusionMatrix = {
      truePositives: 10,
      falsePositives: 5,
      falseNegatives: 5,
      trueNegatives: 80,
    }
    const metrics = calculateClassificationMetrics(matrix)

    // Accuracy = (10 + 80) / (10 + 5 + 5 + 80) = 90 / 100 = 0.9
    expect(metrics.accuracy).toBeCloseTo(0.9, 5)
  })
})

describe("Delta (Y - X) baseline vs harness comparison", () => {
  test("calculates delta Y - X accurately where Y is harness and X is baseline", () => {
    const baselinePrecision = 0.6
    const harnessPrecision = 0.85

    // Delta = Y - X = 0.85 - 0.60 = +0.25
    expect(calculateDelta(harnessPrecision, baselinePrecision)).toBeCloseTo(0.25, 5)
  })

  test("reflects negative delta when harness regresses against baseline", () => {
    const baselineRecall = 0.85
    const harnessRecall = 0.7

    // Delta = Y - X = 0.70 - 0.85 = -0.15
    expect(calculateDelta(harnessRecall, baselineRecall)).toBeCloseTo(-0.15, 5)
  })

  test("constructs metric comparison with relative percentage change", () => {
    const comparison = calculateMetricComparison(0.75, 0.5)

    expect(comparison.baseline).toBe(0.5)
    expect(comparison.harness).toBe(0.75)
    expect(comparison.delta).toBeCloseTo(0.25, 5)
    // ((0.75 - 0.5) / 0.5) * 100 = +50%
    expect(comparison.percentageChange).toBeCloseTo(50.0, 5)
  })

  test("generates comprehensive comparison report with cost and latency deltas", () => {
    const baseline: ClassificationMetrics & { costUsd: number; latencyMs: number } = {
      precision: 0.5,
      recall: 0.7,
      f1: 0.5833,
      costUsd: 0.12,
      latencyMs: 1500,
    }
    const harness: ClassificationMetrics & { costUsd: number; latencyMs: number } = {
      precision: 0.8,
      recall: 0.75,
      f1: 0.7742,
      costUsd: 0.35,
      latencyMs: 4200,
    }

    const report = calculateComparisonDeltas(harness, baseline)

    expect(report.precision.delta).toBeCloseTo(0.3, 5)
    expect(report.recall.delta).toBeCloseTo(0.05, 5)
    expect(report.f1.delta).toBeCloseTo(0.7742 - 0.5833, 4)
    expect(report.costUsd?.delta).toBeCloseTo(0.23, 5)
    expect(report.latencyMs?.delta).toBe(2700)
  })
})

describe("RQ1 evaluation gates", () => {
  const gates = {
    minPrecisionGain: 0.15,
    maxRecallLoss: 0.05,
  }

  test("passes when precision gain exceeds threshold and recall non-inferiority holds", () => {
    const comparison = calculateComparisonDeltas(
      { precision: 0.85, recall: 0.78, f1: 0.81 },
      { precision: 0.65, recall: 0.8, f1: 0.72 },
    )
    // precision delta = +0.20 >= 0.15
    // recall delta = -0.02 >= -0.05
    const evaluation = evaluateRq1Gates(comparison, gates)

    expect(evaluation.pass).toBe(true)
    expect(evaluation.precisionGainSatisfied).toBe(true)
    expect(evaluation.recallNonInferioritySatisfied).toBe(true)
  })

  test("fails when precision gain does not meet the minimum threshold", () => {
    const comparison = calculateComparisonDeltas(
      { precision: 0.72, recall: 0.8, f1: 0.76 },
      { precision: 0.65, recall: 0.8, f1: 0.72 },
    )
    // precision delta = +0.07 < 0.15
    const evaluation = evaluateRq1Gates(comparison, gates)

    expect(evaluation.pass).toBe(false)
    expect(evaluation.precisionGainSatisfied).toBe(false)
    expect(evaluation.recallNonInferioritySatisfied).toBe(true)
  })

  test("fails when recall collapses beyond non-inferiority margin", () => {
    const comparison = calculateComparisonDeltas(
      { precision: 0.9, recall: 0.6, f1: 0.72 },
      { precision: 0.65, recall: 0.8, f1: 0.72 },
    )
    // precision delta = +0.25 >= 0.15 (ok)
    // recall delta = -0.20 < -0.05 (failed)
    const evaluation = evaluateRq1Gates(comparison, gates)

    expect(evaluation.pass).toBe(false)
    expect(evaluation.precisionGainSatisfied).toBe(true)
    expect(evaluation.recallNonInferioritySatisfied).toBe(false)
  })
})

describe("Rule R3: Contest-level split validation", () => {
  test("accepts cleanly partitioned contests and source families", () => {
    const manifest: ContestCorpusManifest = {
      manifestVersion: "1.0.0",
      frozen: true,
      contests: [
        { contestId: "contest-a", split: "train", sourceFamilyId: "uniswap-v2-forks" },
        { contestId: "contest-b", split: "train", sourceFamilyId: "uniswap-v2-forks" },
        { contestId: "contest-c", split: "validation" },
        { contestId: "contest-d", split: "test" },
      ],
    }

    const findings: CorpusFinding[] = [
      {
        findingId: "f1",
        contestId: "contest-a",
        sourceSnapshotId: "snap-a",
        title: "Reentrancy",
        severity: "HIGH",
      },
      {
        findingId: "f2",
        contestId: "contest-d",
        sourceSnapshotId: "snap-d",
        title: "Access control",
        severity: "CRITICAL",
      },
    ]

    const result = validateContestSplit(manifest, findings)
    expect(result.valid).toBe(true)
    expect(result.issues).toEqual([])
  })

  test("detects SPLIT_CONFLICT when the same contest is assigned to different splits", () => {
    const manifest: ContestCorpusManifest = {
      manifestVersion: "1.0.0",
      frozen: false,
      contests: [
        { contestId: "contest-a", split: "train" },
        { contestId: "contest-a", split: "test" },
      ],
    }

    const result = validateContestSplit(manifest)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.code === "SPLIT_CONFLICT")).toBe(true)
    expect(result.issues[0].contestId).toBe("contest-a")
  })

  test("detects FAMILY_SPLIT_CONFLICT when contests in the same family cross splits", () => {
    const manifest: ContestCorpusManifest = {
      manifestVersion: "1.0.0",
      frozen: true,
      contests: [
        { contestId: "compound-fork-1", split: "train", sourceFamilyId: "compound-core" },
        { contestId: "compound-fork-2", split: "test", sourceFamilyId: "compound-core" },
      ],
    }

    const result = validateContestSplit(manifest)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.code === "FAMILY_SPLIT_CONFLICT")).toBe(true)
  })

  test("detects UNASSIGNED_CONTEST when a finding references an unregistered contest", () => {
    const manifest: ContestCorpusManifest = {
      manifestVersion: "1.0.0",
      frozen: true,
      contests: [{ contestId: "contest-registered", split: "train" }],
    }

    const findings: CorpusFinding[] = [
      {
        findingId: "f-orphan",
        contestId: "contest-unregistered",
        sourceSnapshotId: "snap-x",
        title: "Oracle manipulation",
        severity: "CRITICAL",
      },
    ]

    const result = validateContestSplit(manifest, findings)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.code === "UNASSIGNED_CONTEST")).toBe(true)
    expect(result.issues[0].findingId).toBe("f-orphan")
  })

  test("filters corpus findings strictly by assigned split", () => {
    const manifest: ContestCorpusManifest = {
      manifestVersion: "1.0.0",
      frozen: true,
      contests: [
        { contestId: "c-train", split: "train" },
        { contestId: "c-test", split: "test" },
      ],
    }

    const findings: CorpusFinding[] = [
      { findingId: "f1", contestId: "c-train", sourceSnapshotId: "s1", title: "T1", severity: "HIGH" },
      { findingId: "f2", contestId: "c-test", sourceSnapshotId: "s2", title: "T2", severity: "MEDIUM" },
    ]

    const trainFindings = filterFindingsBySplit(manifest, findings, "train")
    expect(trainFindings).toHaveLength(1)
    expect(trainFindings[0].findingId).toBe("f1")

    const testFindings = filterFindingsBySplit(manifest, findings, "test")
    expect(testFindings).toHaveLength(1)
    expect(testFindings[0].findingId).toBe("f2")
  })
})
