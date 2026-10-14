// Adapted from OpenCode packages/core/src/redaction.ts @ 3f393d78bf (MIT License). See NOTICE.

export const RedactedPlaceholder = "***"
export const RedactedSecretPlaceholder = "[REDACTED]"

const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Z0-9_]*PRIVATE_KEY[A-Z0-9_]*\s*[=:]\s*["']?[^\s"']+["']?/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
]

// Regex to capture user:password in URI/database connection URLs
// e.g. postgresql://user:password@host:5432/db or mongodb://user:pass@host
const CONNECTION_URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s]+):([^@\s]+)@/g

/**
 * Redacts database connection strings and secret tokens from a given text.
 * - Masks user credentials in database URLs (e.g. postgresql://user:password@host -> postgresql://***:***@host)
 * - Masks any explicit secret strings provided in `secrets` array
 * - Masks standard API key patterns (OpenAI, AWS, GitHub tokens, private keys)
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  if (!text) return text

  let result = text

  // 1. Scrub database URL user credentials
  result = result.replace(CONNECTION_URL_CREDENTIALS, (_match, protocol: string) => {
    return `${protocol}${RedactedPlaceholder}:${RedactedPlaceholder}@`
  })

  // 2. Redact explicit secrets passed in
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      result = result.replaceAll(secret, RedactedSecretPlaceholder)
    }
  }

  // 3. Redact known secret regex patterns
  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    result = result.replace(pattern, RedactedSecretPlaceholder)
  }

  return result
}
