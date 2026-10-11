import type { SecurityFilterPort, SecurityFilterResult } from "@harness/protocol"

export const Redacted = "[REDACTED]"

/** Order matters: wider shapes first, so a key assigned to `PRIVATE_KEY` is counted once, not once per shape. */
export const DefaultSecretPatterns: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/,
  /\b[A-Z0-9_]*PRIVATE_KEY[A-Z0-9_]*\s*[=:]\s*["']?[^\s"']+["']?/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{36}\b/,
]

const globally = (pattern: RegExp) => (pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`))

/** A stand-in for the real filter: replaces anything matching a secret pattern with `[REDACTED]` and counts the hits. */
export class RegexSecurityFilter implements SecurityFilterPort {
  callCount = 0
  private readonly patterns: readonly RegExp[]

  constructor(patterns: readonly RegExp[] = DefaultSecretPatterns) {
    this.patterns = patterns.map(globally)
  }

  async filterSecrets(content: string, signal?: AbortSignal): Promise<SecurityFilterResult> {
    signal?.throwIfAborted()
    this.callCount += 1
    let redactionCount = 0
    const filtered = this.patterns.reduce(
      (text, pattern) =>
        text.replace(pattern, () => {
          redactionCount += 1
          return Redacted
        }),
      content,
    )
    return { content: filtered, redactionCount }
  }
}
