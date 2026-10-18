const RedactedPlaceholder = "<redacted>"

const defaultSecretPatterns: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Z0-9_]*PRIVATE_KEY[A-Z0-9_]*\s*[=:]\s*["']?[^\s"']+["']?/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
]

const connectionUrlCredentials = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s]+):([^@\s]+)@/g

export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  if (!text) return text

  let result = text.replace(connectionUrlCredentials, (_match, protocol: string) => {
    return `${protocol}${RedactedPlaceholder}:${RedactedPlaceholder}@`
  })

  for (const secret of secrets) {
    if (secret && secret.length >= 1) result = result.replaceAll(secret, RedactedPlaceholder)
  }

  for (const pattern of defaultSecretPatterns) {
    result = result.replace(pattern, RedactedPlaceholder)
  }

  return result
}
