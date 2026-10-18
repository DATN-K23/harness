export class InvalidSnapshotIdError extends Error {
  constructor(snapshotId: string) {
    super("Invalid snapshot ID \"" + snapshotId + "\"")
    this.name = "InvalidSnapshotIdError"
  }
}
export class SnapshotExistsError extends Error {
  constructor(snapshotId: string) {
    super("Snapshot \"" + snapshotId + "\" already exists with different content")
    this.name = "SnapshotExistsError"
  }
}
export class SnapshotIntegrityError extends Error {
  constructor(relativePath: string) {
    super("Snapshot integrity check failed for \"" + relativePath + "\"")
    this.name = "SnapshotIntegrityError"
  }
}
export class SnapshotInUseError extends Error {
  constructor(snapshotId: string) {
    super("Snapshot \"" + snapshotId + "\" is referenced by an active run")
    this.name = "SnapshotInUseError"
  }
}
