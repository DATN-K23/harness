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

export const requireLocalServerPassword = (password: string | undefined): string => {
  if (!password?.trim() || /[\x00-\x1f\x7f]/.test(password))
    throw new Error("HARNESS_SERVER_PASSWORD must be set to a non-empty password without control characters")
  return password
}

export const localAuthorization = (password: string): string =>
  `Basic ${Buffer.from(`harness:${password}`, "utf8").toString("base64")}`

export const isAuthorizedLocalRequest = (request: Request, password: string): boolean => {
  if (!password?.trim()) return false
  const authorization = request.headers.get("authorization") ?? ""
  const match = /^Basic +([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)
  if (!match) return false
  const actual = Buffer.from(match[1])
  const expected = Buffer.from(localAuthorization(password).slice("Basic ".length))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export const localAuthenticationRequired = () => Response.json(
  { error: { code: "unauthorized", message: "Authentication required" } },
  { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Harness", charset="UTF-8"' } },
)
