import { ProductionSecurityFilter, DefaultSecretPatterns, Redacted } from "../security-filter"
import type { SecurityFilterPort } from "@harness/protocol"
export { DefaultSecretPatterns, Redacted }

/** A stand-in for the real filter: replaces anything matching a secret pattern with `[REDACTED]` and counts the hits. */
export class RegexSecurityFilter extends ProductionSecurityFilter implements SecurityFilterPort {
  callCount = 0
  constructor(patterns: readonly RegExp[] = DefaultSecretPatterns) {
    super(patterns)
  }
  override async filterSecrets(content: string, signal?: AbortSignal) {
    this.callCount += 1
    return super.filterSecrets(content, signal)
  }
}
