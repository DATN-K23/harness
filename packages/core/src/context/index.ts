// Adapted from OpenCode packages/core/src/session/index.ts @ 3f393d78bf (MIT License). See NOTICE.
export {
  FakeContextEngineLabel,
  estimateTokens,
  estimateItemTokens,
} from "./token-estimator"

export {
  FakeContextEngine,
  PassThroughContextEngine,
  ProductionContextEngine,
} from "./context-engine"
export type {
  PrepareInput,
  ShapeInput,
  RecordInput,
} from "./context-engine"

export { createO200kTokenizer } from "./o200k-tokenizer"
export type { TokenizerPort } from "./o200k-tokenizer"

export {
  ThresholdContextEngine,
  ScriptedContextEngine,
} from "./compaction"
export type {
  ScriptedPrepareEntry,
  ScriptedPrepareResult,
} from "./compaction"
