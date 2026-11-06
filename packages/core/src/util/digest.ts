import { createHash } from "node:crypto"
import { canonicalize } from "@harness/protocol"

export const canonicalJson = canonicalize

export const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")

export const digestOf = (value: unknown) => `sha256:${sha256Hex(canonicalJson(value))}`

/** Digest of the exact text bytes (no JSON quoting), e.g. evidence lines joined with `
` or a prompt file. */
export const textDigest = (text: string) => `sha256:${sha256Hex(text)}`
