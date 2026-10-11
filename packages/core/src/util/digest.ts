import { createHash } from "node:crypto"
import { canonicalize } from "@harness/protocol"

export const canonicalJson = canonicalize

export const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")

export const digestOf = (value: unknown) => `sha256:${sha256Hex(canonicalJson(value))}`
