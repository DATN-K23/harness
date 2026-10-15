// Adapted from OpenCode packages/core/src/session/index.ts @ 3f393d78bf (MIT License). See NOTICE.
export {
  FakeContextEngineLabel,
  estimateTokens,
  estimateItemTokens,
} from "./token-estimator"

export {
  FakeContextEngine,
  PassThroughContextEngine,
} from "./context-engine"
export type {
  PrepareInput,
  ShapeInput,
  RecordInput,
} from "./context-engine"

export {
  ThresholdContextEngine,
  ScriptedContextEngine,
} from "./compaction"
export type {
  ScriptedPrepareEntry,
  ScriptedPrepareResult,
} from "./compaction"
