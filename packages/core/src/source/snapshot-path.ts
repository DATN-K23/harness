import * as path from "node:path"
import { InvalidSnapshotIdError } from "./snapshot-errors"

const snapshotIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** Resolves a valid snapshot ID to a direct child of the resolved storage directory. */
export function resolveSnapshotDir(storageDir: string, snapshotId: string): string {
  if (!snapshotIdPattern.test(snapshotId)) throw new InvalidSnapshotIdError(snapshotId)
  const storageRoot = path.resolve(storageDir)
  const snapshotDir = path.resolve(storageRoot, snapshotId)
  if (path.dirname(snapshotDir) !== storageRoot) throw new InvalidSnapshotIdError(snapshotId)
  return snapshotDir
}
