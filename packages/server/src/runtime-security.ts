// Adapted from OpenCode packages/server/src/auth.ts @ 3f393d78bf (MIT License). See NOTICE.
import { timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"

export const isLoopbackHost = (host: string): boolean => {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized === "localhost") return true
  if (isIP(normalized) === 4) return normalized.startsWith("127.")
  return normalized === "::1"
}

export const isAuthorizedLocalRequest = (request: Request, credential: string): boolean => {
  if (!credential) return false
  const authorization = request.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(.+)$/i.exec(authorization)
  if (!match) return false
  const actual = Buffer.from(match[1])
  const expected = Buffer.from(credential)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
