// Adapted from OpenCode packages/server/src/auth.ts @ 3f393d78bf (MIT License). See NOTICE.
import { timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"

export const ApiCompatibility = {
  apiVersion: 1,
} as const

export type ApiCompatibilityResult =
  | { compatible: true }
  | {
      compatible: false
      reason: "api_version_mismatch"
      expectedApiVersion: number
      receivedApiVersion: number
    }
export const validateApiCompatibility = (
  received: { apiVersion: number },
  expected: { apiVersion: number },
): ApiCompatibilityResult => {
  if (received.apiVersion !== expected.apiVersion)
    return {
      compatible: false,
      reason: "api_version_mismatch",
      expectedApiVersion: expected.apiVersion,
      receivedApiVersion: received.apiVersion,
    }
  return { compatible: true }
}

export const assertApiCompatibility = (received: { apiVersion: number }, expected = ApiCompatibility): void => {
  const result = validateApiCompatibility(received, expected)
  if (!result.compatible) throw new Error(`Incompatible API version: expected ${result.expectedApiVersion}, received ${result.receivedApiVersion}`)
}

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
