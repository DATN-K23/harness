import type { SecurityFilterPort, SecurityFilterResult } from "@harness/protocol"

export const Redacted = "[REDACTED]"
export const DefaultSecretPatterns: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/,
  /\b[A-Z0-9_]*PRIVATE_KEY[A-Z0-9_]*\s*[=:]\s*["']?[^\s"']+["']?/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{36}\b/,
]

/** Canonical secret filter for production composition and tests. */
export class ProductionSecurityFilter implements SecurityFilterPort {
  private readonly patterns: readonly RegExp[]
  constructor(patterns: readonly RegExp[] = DefaultSecretPatterns) {
    this.patterns = patterns.map((pattern) => pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`))
  }

  async filterSecrets(content: string, signal?: AbortSignal): Promise<SecurityFilterResult> {
    signal?.throwIfAborted()
    let redactionCount = 0
    const filtered = this.patterns.reduce((text, pattern) => text.replace(pattern, () => {
      redactionCount++
      return Redacted
    }), content)
    return { content: filtered, redactionCount }
  }
}
