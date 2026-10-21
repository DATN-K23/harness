// Adapted from OpenCode packages/server/src/index.ts @ 3f393d78bf (MIT License). See NOTICE.
export const SERVER_VERSION = 1

export { ApiCompatibility, isAuthorizedLocalRequest, isLoopbackHost, validateApiCompatibility } from "./runtime-security"
export type { ApiCompatibilityResult } from "./runtime-security"
export { createKeychainCredentialProvider } from "./keychain-credential"
export type { KeychainCredentialProvider } from "./keychain-credential"
