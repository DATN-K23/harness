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
