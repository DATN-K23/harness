// Adapted from OpenCode packages/server/src/index.ts @ 3f393d78bf (MIT License). See NOTICE.
export const SERVER_VERSION = 1

export { ApiCompatibility, isAuthorizedLocalRequest, isLoopbackHost, validateApiCompatibility } from "./runtime-security"
export type { ApiCompatibilityResult } from "./runtime-security"
export { createKeychainCredentialProvider } from "./keychain-credential"
export type { KeychainCredentialProvider } from "./keychain-credential"
export { createJudgeApi } from "./judge-api"
export type { JudgeSubmissionService } from "./judge-api"
export { createJudgeSubmissionService, loadAdmittedJudgeInput } from "./judge-submission-service"
export type { JudgeSubmissionServiceDeps } from "./judge-submission-service"
export { createOutboxWorker } from "./outbox-worker"
export type { OutboxWorkerDeps } from "./outbox-worker"
export type { JudgeQueryStore } from "./judge-api"
export { listenLocal } from "./local-server"
export { startLocalRuntime } from "./local-runtime"
export type { LocalRuntimeOptions } from "./local-runtime"
export type { AdmissionResult, RunAdmission } from "@harness/protocol"
