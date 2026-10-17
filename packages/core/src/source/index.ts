// Adapted from OpenCode packages/core/src/source/index.ts @ 3f393d78bf (MIT License). See NOTICE.
export {
  checkSnapshotPath,
  comparePaths,
  globToRegExp,
  normalizeFiles,
  splitLines,
} from "./source-snapshot"
export type {
  SnapshotPathCheck,
  SnapshotReadResult,
  SourceSnapshotOptions,
  SourceSnapshotPort,
} from "./source-snapshot"
export { InMemorySnapshot } from "./in-memory-snapshot"
export type { InMemorySnapshotOptions, SnapshotReadRecord } from "./in-memory-snapshot"
export { DiskSourceSnapshot } from "./disk-source-snapshot"
export type { DiskSourceSnapshotOptions } from "./disk-source-snapshot"
export { SnapshotManager } from "./snapshot-manager"
export type { IngestRepositoryOptions, IngestResult } from "./snapshot-manager"
export { parseManifest, serializeManifest, validateManifest } from "./manifest"
export type { SnapshotFileEntry, SnapshotManifest } from "./manifest"
export { DEFAULT_DENIED_PREFIXES, isDeniedSourceFile } from "./source-snapshot"
