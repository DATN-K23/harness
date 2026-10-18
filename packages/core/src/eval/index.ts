// Adapted from OpenCode packages/core/src/eval/index.ts @ 3f393d78bf (MIT License). See NOTICE.
export {
  calculateClassificationMetrics,
  calculateComparisonDeltas,
  calculateDelta,
  calculateF1,
  calculateF1FromMatrix,
  calculateMetricComparison,
  calculatePrecision,
  calculateRecall,
  evaluateRq1Gates,
} from "./metrics"
export type {
  ClassificationMetrics,
  ConfusionMatrix,
  EvaluationComparisonReport,
  MetricComparison,
  Rq1GateEvaluation,
  Rq1GateThresholds,
} from "./metrics"
export {
  filterFindingsBySplit,
  validateContestSplit,
} from "./corpus-loader"
export type {
  ContaminationBucket,
  ContestCorpusManifest,
  ContestManifestEntry,
  CorpusFinding,
  DatasetSplit,
  ScorerGroundTruthLabel,
  SplitValidationIssue,
  SplitValidationResult,
  SplitViolationCode,
} from "./corpus-loader"

export { ingestContestForEvaluation } from "./evaluation-ingest"
export type { IngestContestForEvaluationInput } from "./evaluation-ingest"
export { checkSnapshotContamination } from "./contamination"
export type {
  SnapshotContaminationInput,
  SnapshotContaminationLeak,
  SnapshotContaminationResult,
  SnapshotFindingTitle,
} from "./contamination"
