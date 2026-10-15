// Adapted from OpenCode packages/core/src/eval/metrics.ts @ 3f393d78bf (MIT License). See NOTICE.

/** Binary confusion matrix counts for classification outcomes. */
export interface ConfusionMatrix {
  readonly truePositives: number
  readonly falsePositives: number
  readonly falseNegatives: number
  readonly trueNegatives?: number
}

/** Computed classification metrics. */
export interface ClassificationMetrics {
  readonly precision: number
  readonly recall: number
  readonly f1: number
  readonly accuracy?: number
}

/** Comparison between harness (candidate Y) and baseline (direct-model X). */
export interface MetricComparison {
  /** Baseline value (X) from the direct-model reference arm. */
  readonly baseline: number
  /** Harness value (Y) from the evaluated orchestration arm. */
  readonly harness: number
  /** Delta (Y - X): positive means harness exceeds baseline. */
  readonly delta: number
  /** Percentage change relative to baseline: ((Y - X) / X) * 100 if baseline > 0. */
  readonly percentageChange?: number
}

/** Comprehensive comparison report between harness and direct-model baseline. */
export interface EvaluationComparisonReport {
  readonly precision: MetricComparison
  readonly recall: MetricComparison
  readonly f1: MetricComparison
  readonly costUsd?: MetricComparison
  readonly latencyMs?: MetricComparison
}

/** Predeclared RQ1 evaluation gates for confirmatory benchmark conclusion. */
export interface Rq1GateThresholds {
  /** Minimum precision delta (Y - X) required to claim precision improvement. */
  readonly minPrecisionGain: number
  /** Maximum allowable recall loss (-delta) under non-inferiority margin. */
  readonly maxRecallLoss: number
}

export interface Rq1GateEvaluation {
  readonly pass: boolean
  readonly precisionGainSatisfied: boolean
  readonly recallNonInferioritySatisfied: boolean
}

/**
 * Calculates Precision: P = TP / (TP + FP).
 * Returns 0 when the denominator is 0.
 */
export const calculatePrecision = (truePositives: number, falsePositives: number): number => {
  const denominator = truePositives + falsePositives
  if (denominator <= 0) return 0
  return truePositives / denominator
}

/**
 * Calculates Recall: R = TP / (TP + FN).
 * Returns 0 when the denominator is 0.
 */
export const calculateRecall = (truePositives: number, falseNegatives: number): number => {
  const denominator = truePositives + falseNegatives
  if (denominator <= 0) return 0
  return truePositives / denominator
}

/**
 * Calculates F1 score: F1 = 2 * (P * R) / (P + R).
 * Returns 0 when (P + R) is 0.
 */
export const calculateF1 = (precision: number, recall: number): number => {
  const denominator = precision + recall
  if (denominator <= 0) return 0
  return (2 * precision * recall) / denominator
}

/**
 * Calculates F1 score directly from a confusion matrix: 2*TP / (2*TP + FP + FN).
 */
export const calculateF1FromMatrix = (matrix: ConfusionMatrix): number => {
  const denominator = 2 * matrix.truePositives + matrix.falsePositives + matrix.falseNegatives
  if (denominator <= 0) return 0
  return (2 * matrix.truePositives) / denominator
}

/**
 * Computes precision, recall, and F1 from a confusion matrix.
 */
export const calculateClassificationMetrics = (matrix: ConfusionMatrix): ClassificationMetrics => {
  const precision = calculatePrecision(matrix.truePositives, matrix.falsePositives)
  const recall = calculateRecall(matrix.truePositives, matrix.falseNegatives)
  const f1 = calculateF1(precision, recall)

  if (matrix.trueNegatives !== undefined) {
    const total = matrix.truePositives + matrix.falsePositives + matrix.falseNegatives + matrix.trueNegatives
    const accuracy = total > 0 ? (matrix.truePositives + matrix.trueNegatives) / total : 0
    return { precision, recall, f1, accuracy }
  }

  return { precision, recall, f1 }
}

/**
 * Calculates Delta (Y - X) between harness output (Y) and baseline (X).
 */
export const calculateDelta = (harnessValue: number, baselineValue: number): number => {
  return harnessValue - baselineValue
}

/**
 * Constructs a MetricComparison for a single metric with Delta (Y - X) and relative change.
 */
export const calculateMetricComparison = (harnessValue: number, baselineValue: number): MetricComparison => {
  const delta = calculateDelta(harnessValue, baselineValue)
  const percentageChange = baselineValue > 0 ? (delta / baselineValue) * 100 : undefined
  return {
    baseline: baselineValue,
    harness: harnessValue,
    delta,
    ...(percentageChange !== undefined ? { percentageChange } : {}),
  }
}

/**
 * Computes the full comparison report comparing harness vs direct-model baseline across metrics.
 */
export const calculateComparisonDeltas = (
  harness: ClassificationMetrics & { costUsd?: number; latencyMs?: number },
  baseline: ClassificationMetrics & { costUsd?: number; latencyMs?: number },
): EvaluationComparisonReport => {
  return {
    precision: calculateMetricComparison(harness.precision, baseline.precision),
    recall: calculateMetricComparison(harness.recall, baseline.recall),
    f1: calculateMetricComparison(harness.f1, baseline.f1),
    ...(harness.costUsd !== undefined && baseline.costUsd !== undefined
      ? { costUsd: calculateMetricComparison(harness.costUsd, baseline.costUsd) }
      : {}),
    ...(harness.latencyMs !== undefined && baseline.latencyMs !== undefined
      ? { latencyMs: calculateMetricComparison(harness.latencyMs, baseline.latencyMs) }
      : {}),
  }
}

/**
 * Evaluates whether harness results satisfy predeclared RQ1 gates against baseline.
 */
export const evaluateRq1Gates = (
  comparison: EvaluationComparisonReport,
  thresholds: Rq1GateThresholds,
): Rq1GateEvaluation => {
  const precisionGainSatisfied = comparison.precision.delta >= thresholds.minPrecisionGain
  // Recall loss must not exceed maxRecallLoss; i.e. delta >= -maxRecallLoss
  const recallNonInferioritySatisfied = comparison.recall.delta >= -thresholds.maxRecallLoss

  return {
    pass: precisionGainSatisfied && recallNonInferioritySatisfied,
    precisionGainSatisfied,
    recallNonInferioritySatisfied,
  }
}
