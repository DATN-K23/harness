// Adapted from OpenCode packages/opencode/src/tool/truncate.ts @ 3f393d78bf (MIT License). See NOTICE.

export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024

export interface TruncateOptions {
  maxLines?: number
  maxBytes?: number
  direction?: "head" | "tail"
  customHint?: string
}

export interface TruncateResult {
  content: string
  truncated: boolean
  removedCount?: number
  unit?: "lines" | "bytes"
}

/**
 * Truncates text exceeding line or byte limits, appending or prepending an informative marker.
 * Faithful port of OpenCode's Truncate.output logic without Effect dependency.
 */
export function truncateText(text: string, options: TruncateOptions = {}): TruncateResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const direction = options.direction ?? "head"
  const lines = text.split("\n")
  const totalBytes = Buffer.byteLength(text, "utf-8")

  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false }
  }

  const out: string[] = []
  let bytes = 0
  let hitBytes = false

  if (direction === "head") {
    for (let i = 0; i < lines.length && i < maxLines; i++) {
      const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
      if (bytes + size > maxBytes) {
        hitBytes = true
        break
      }
      out.push(lines[i])
      bytes += size
    }
  } else {
    for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
      if (bytes + size > maxBytes) {
        hitBytes = true
        break
      }
      out.unshift(lines[i])
      bytes += size
    }
  }

  const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
  const unit = hitBytes ? "bytes" : "lines"
  const preview = out.join("\n")
  const hint = options.customHint ? `\n\n${options.customHint}` : ""

  const marker = `...${removed} ${unit} truncated...`
  const formattedContent =
    direction === "head" ? `${preview}\n\n${marker}${hint}` : `${marker}${hint}\n\n${preview}`

  return {
    content: formattedContent,
    truncated: true,
    removedCount: removed,
    unit,
  }
}
