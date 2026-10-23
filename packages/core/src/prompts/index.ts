import { readFileSync } from "node:fs"
import { join } from "node:path"
import { textDigest } from "../util/digest"

export type PromptName =
  | "judge-system.v1"
  | "judge-system.v2"
  | "max-steps.v1"
  | "forward-verification.v1"
  | "backward-verification.v1"
  | "forward-verification.v2"
  | "backward-verification.v2"
  | "structured-output.v1"
  | "claim-extraction.v1"
  | "claim-extraction.v2"
  | "verification-limit.v1"
  | "verdict-limit.v1"

export interface LoadedPrompt {
  text: string
  digest: string
}

const defaultDirectory = import.meta.dir

// Prompt files may open with `//` attribution lines; they are not part of the text the model sees or the digest.
const stripLeadingComments = (text: string) => {
  const lines = text.split("\n")
  const body = lines.findIndex((line) => !line.startsWith("//"))
  if (body <= 0) return text
  return lines
    .slice(body)
    .join("\n")
    .replace(/^\n+/, "")
}

export const loadPrompt = (name: PromptName, directory = defaultDirectory): LoadedPrompt => {
  const path = join(directory, `${name}.txt`)
  const raw = readFileSync(path, "utf8").replaceAll("\r\n", "\n")
  const text = stripLeadingComments(raw)
  return { text, digest: textDigest(text) }
}
