import { globalSecretPatterns } from "@harness/core"

export const RedactedPlaceholder = "***"
export const RedactedSecretPlaceholder = "[REDACTED]"

const DEFAULT_SECRET_PATTERNS = globalSecretPatterns()

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
