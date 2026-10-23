// Secret formats adapted from OpenCode packages/http-recorder/src/redaction.ts (SECRET_PATTERNS) @ 3f393d78bf
// (MIT License, Copyright (c) 2025 opencode). See NOTICE.
import type { SecurityFilterPort, SecurityFilterResult } from "@harness/protocol"

export const Redacted = "[REDACTED]"
/**
 * Whole PEM blocks and `*PRIVATE_KEY=` assignments (harness), plus the upstream token formats: bearer tokens, OpenAI
 * and Anthropic keys (`sk-` covers `sk-ant-`), Google API keys, AWS access keys and every GitHub token prefix.
 */
export const DefaultSecretPatterns: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/,
  /\b[A-Z0-9_]*PRIVATE_KEY[A-Z0-9_]*\s*[=:]\s*["']?[^\s"']+["']?/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /sk-[A-Za-z0-9_-]{16,}/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
]

/** The patterns with the global flag, so `String.replace` masks every occurrence. */
export const globalSecretPatterns = (patterns: readonly RegExp[] = DefaultSecretPatterns): RegExp[] =>
  patterns.map((pattern) => (pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`)))

/** Canonical secret filter for production composition and tests. */
export class ProductionSecurityFilter implements SecurityFilterPort {
  private readonly patterns: readonly RegExp[]
  constructor(patterns: readonly RegExp[] = DefaultSecretPatterns) {
    this.patterns = globalSecretPatterns(patterns)
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
