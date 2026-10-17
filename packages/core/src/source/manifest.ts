export interface SnapshotFileEntry {
  digest: string
  lineCount: number
  byteSize: number
}

export interface SnapshotManifest {
  snapshotId: string
  createdAt: string
  treeDigest: string
  files: Record<string, SnapshotFileEntry>
}

const sha256Pattern = /^sha256:[a-f0-9]{64}$/

export function validateManifest(data: unknown): SnapshotManifest {
  if (typeof data !== "object" || data === null) {
    throw new Error("Manifest must be an object")
  }
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
  if (typeof obj.files !== "object" || obj.files === null) {
    throw new Error("Invalid or missing files in manifest")
  }

  const filesRecord = obj.files as Record<string, unknown>
  const validatedFiles: Record<string, SnapshotFileEntry> = {}

  for (const [filePath, entry] of Object.entries(filesRecord)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Invalid entry for file "${filePath}" in manifest`)
    }
    const e = entry as Record<string, unknown>
    if (typeof e.digest !== "string" || !sha256Pattern.test(e.digest)) {
      throw new Error(`Invalid digest for file "${filePath}" in manifest`)
    }
    if (typeof e.lineCount !== "number" || !Number.isInteger(e.lineCount) || e.lineCount < 0) {
      throw new Error(`Invalid lineCount for file "${filePath}" in manifest`)
    }
    if (typeof e.byteSize !== "number" || !Number.isInteger(e.byteSize) || e.byteSize < 0) {
      throw new Error(`Invalid byteSize for file "${filePath}" in manifest`)
    }
    validatedFiles[filePath] = {
      digest: e.digest,
      lineCount: e.lineCount,
      byteSize: e.byteSize,
    }
  }

  return {
    snapshotId: obj.snapshotId,
    createdAt: obj.createdAt,
    treeDigest: obj.treeDigest,
    files: validatedFiles,
  }
}

export function serializeManifest(manifest: SnapshotManifest): string {
  // Canonical formatting: sort keys for determinism
  const sortedFiles: Record<string, SnapshotFileEntry> = {}
  for (const path of Object.keys(manifest.files).sort()) {
    sortedFiles[path] = manifest.files[path]!
  }

  return JSON.stringify(
    {
      snapshotId: manifest.snapshotId,
      createdAt: manifest.createdAt,
      treeDigest: manifest.treeDigest,
      files: sortedFiles,
    },
    null,
    2,
  )
}

export function parseManifest(rawJson: string): SnapshotManifest {
  const parsed = JSON.parse(rawJson)
  return validateManifest(parsed)
}
