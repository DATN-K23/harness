// Adapted from OpenCode packages/core/src/step/parallel-tool-dispatcher.ts @ 3f393d78bf (MIT License). See NOTICE.
// Backward compatibility re-export shim. Canonical implementation is at ../tool/dispatcher.
export {
  NextStepMarker,
  ParallelToolDispatcher,
  SecurityRuleIds,
  ToolFailureKinds,
  describeArguments,
} from "../tool/dispatcher"
export type {
  DispatchInput,
  DispatchOutcome,
  DispatchedCall,
  SettleResult,
  ToolDispatcherOptions,
  ToolFailureKind,
} from "../tool/dispatcher"
