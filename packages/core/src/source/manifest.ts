export interface SnapshotFileEntry {
  digest: string
  lineCount: number
  byteSize: number
}
export interface SnapshotSkippedEntry {
  path: string
  reason: "denied" | "symlink" | "too_large" | "binary"
}
export interface SnapshotWarningEntry {
  path: string
  reason: "report_like_name"
}
export interface SnapshotManifest {
  snapshotId: string
  createdAt: string
  treeDigest: string
  ingestionPolicyVersion?: string
  files: Record<string, SnapshotFileEntry>
  skipped?: SnapshotSkippedEntry[]
  warnings?: SnapshotWarningEntry[]
}

const sha256Pattern = /^sha256:[a-f0-9]{64}$/

export function validateManifest(data: unknown): SnapshotManifest {
  if (typeof data !== "object" || data === null) throw new Error("Manifest must be an object")
  const obj = data as Record<string, unknown>
  if (typeof obj.snapshotId !== "string" || obj.snapshotId.length === 0) {
    throw new Error("Invalid or missing snapshotId in manifest")
  }
  if (typeof obj.createdAt !== "string" || Number.isNaN(Date.parse(obj.createdAt))) {
    throw new Error("Invalid or missing createdAt in manifest")
  }
  if (typeof obj.treeDigest !== "string" || !sha256Pattern.test(obj.treeDigest)) {
    throw new Error("Invalid or missing treeDigest in manifest (expected sha256:<64 hex>)")
  }
  if (typeof obj.files !== "object" || obj.files === null) throw new Error("Invalid or missing files in manifest")

  if (
    obj.ingestionPolicyVersion !== undefined &&
    (typeof obj.ingestionPolicyVersion !== "string" || obj.ingestionPolicyVersion.length === 0)
  ) {
    throw new Error("Invalid ingestionPolicyVersion in manifest")
  }

  const validatedFiles: Record<string, SnapshotFileEntry> = {}
  for (const [filePath, entry] of Object.entries(obj.files as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Invalid entry for file \"" + filePath + "\" in manifest")
    }
    const e = entry as Record<string, unknown>
    if (typeof e.digest !== "string" || !sha256Pattern.test(e.digest)) {
      throw new Error("Invalid digest for file \"" + filePath + "\" in manifest")
    }
    if (typeof e.lineCount !== "number" || !Number.isInteger(e.lineCount) || e.lineCount < 0) {
      throw new Error("Invalid lineCount for file \"" + filePath + "\" in manifest")
    }
    if (typeof e.byteSize !== "number" || !Number.isInteger(e.byteSize) || e.byteSize < 0) {
      throw new Error("Invalid byteSize for file \"" + filePath + "\" in manifest")
    }
    validatedFiles[filePath] = { digest: e.digest, lineCount: e.lineCount, byteSize: e.byteSize }
  }

  const skipped = validatePathEntries(obj.skipped, "skipped", ["denied", "symlink", "too_large", "binary"] as const)
  const warnings = validatePathEntries(obj.warnings, "warnings", ["report_like_name"] as const)
  return {
    snapshotId: obj.snapshotId,
    createdAt: obj.createdAt,
    treeDigest: obj.treeDigest,
    ...(obj.ingestionPolicyVersion !== undefined
      ? { ingestionPolicyVersion: obj.ingestionPolicyVersion as string }
      : {}),
    files: validatedFiles,
    ...(skipped !== undefined ? { skipped } : {}),
    ...(warnings !== undefined ? { warnings } : {}),
  }
}

function validatePathEntries<const TReason extends string>(
  value: unknown,
  field: string,
  allowedReasons: readonly TReason[],
): Array<{ path: string; reason: TReason }> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("Invalid " + field + " in manifest")
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Invalid " + field + "[" + index + "] in manifest")
    }
    const item = entry as Record<string, unknown>
    if (typeof item.path !== "string" || item.path.length === 0) {
      throw new Error("Invalid path in " + field + "[" + index + "] in manifest")
    }
    if (typeof item.reason !== "string" || !allowedReasons.includes(item.reason as TReason)) {
      throw new Error("Invalid reason in " + field + "[" + index + "] in manifest")
    }
    return { path: item.path, reason: item.reason as TReason }
  })
}

export function serializeManifest(manifest: SnapshotManifest): string {
  const sortedFiles: Record<string, SnapshotFileEntry> = {}
  for (const filePath of Object.keys(manifest.files).sort()) sortedFiles[filePath] = manifest.files[filePath]!
  return JSON.stringify(
    {
      snapshotId: manifest.snapshotId,
      createdAt: manifest.createdAt,
      treeDigest: manifest.treeDigest,
      ...(manifest.ingestionPolicyVersion !== undefined
        ? { ingestionPolicyVersion: manifest.ingestionPolicyVersion }
        : {}),
      files: sortedFiles,
      ...(manifest.skipped !== undefined ? { skipped: manifest.skipped } : {}),
      ...(manifest.warnings !== undefined ? { warnings: manifest.warnings } : {}),
    },
    null,
    2,
  )
}
export function parseManifest(rawJson: string): SnapshotManifest {
  return validateManifest(JSON.parse(rawJson))
}
