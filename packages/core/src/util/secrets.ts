import { globalSecretPatterns } from "../security-filter"

const RedactedPlaceholder = "<redacted>"

const defaultSecretPatterns = globalSecretPatterns()

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
