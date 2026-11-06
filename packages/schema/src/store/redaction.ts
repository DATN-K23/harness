export const RedactedSecretPlaceholder = "[REDACTED]"
export const RedactedPlaceholder = "***"

const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Z0-9_]*PRIVATE_KEY[A-Z0-9_]*\s*[=:]\s*["']?[^\s"']+["']?/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
  // Bearer handled separately below to preserve prefix
]

const CONNECTION_URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s]+):([^@\s]+)@/g

const SENSITIVE_KEY_PATTERN = /^(api[-_]?key|password|secret|auth|authorization|token|credential|private[-_]?key)$/i

export const redactSecrets = (text: string, explicitSecrets: readonly string[] = []): string => {
  if (!text) return text
  let result = text

  result = result.replace(CONNECTION_URL_CREDENTIALS, (_match, protocol: string) => {
    return `${protocol}${RedactedPlaceholder}:${RedactedPlaceholder}@`
  })
  result = result.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${RedactedSecretPlaceholder}`)

  for (const secret of explicitSecrets) {
    if (secret && secret.length >= 4) {
      result = result.replaceAll(secret, RedactedSecretPlaceholder)
    }
  }

  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    result = result.replace(pattern, RedactedSecretPlaceholder)
  }

  return result
}

export const sanitizeSecrets = (value: unknown): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === "string") return redactSecrets(value)
  if (typeof value === "number" || typeof value === "boolean") return value

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSecrets(item))
  }

  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && typeof val === "string") {
        sanitized[key] = RedactedSecretPlaceholder
      } else {
        sanitized[key] = sanitizeSecrets(val)
      }
    }
    return sanitized
  }

  return value
}
