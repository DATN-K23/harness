function safeSnapshotId(snapshotId: string): string | undefined {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(snapshotId) ? snapshotId : undefined
}

function safeRelativePath(relativePath: string): string | undefined {
  const normalized = relativePath.replaceAll("\\", "/")
  if (/^(?:\/|[A-Za-z]:|file:\/\/)/i.test(normalized)) return undefined
  const segments = normalized.split("/").filter((segment) => segment !== "" && segment !== ".")
  if (segments.includes("..")) return undefined
  return segments.join("/")
}

export class InvalidSnapshotIdError extends Error {
  readonly snapshotId: string | undefined

  constructor(snapshotId: string) {
    super("Invalid snapshot ID")
    this.name = "InvalidSnapshotIdError"
    this.snapshotId = safeSnapshotId(snapshotId)
  }
}
export class SnapshotExistsError extends Error {
  constructor(snapshotId: string) {
    super("Snapshot \"" + snapshotId + "\" already exists with different content")
    this.name = "SnapshotExistsError"
  }
}
export class SnapshotIntegrityError extends Error {
  readonly relativePath: string | undefined

  constructor(relativePath: string) {
    const safePath = safeRelativePath(relativePath)
    super(
      safePath === undefined
        ? "Snapshot integrity check failed"
        : "Snapshot integrity check failed for \"" + safePath + "\"",
    )
    this.name = "SnapshotIntegrityError"
    this.relativePath = safePath
  }
}
export class SnapshotInUseError extends Error {
  constructor(snapshotId: string) {
    super("Snapshot \"" + snapshotId + "\" is referenced by an active run")
    this.name = "SnapshotInUseError"
  }
}
