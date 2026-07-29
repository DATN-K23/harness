export const WorkspaceErrorCode = {
  invalidPath: "INVALID_PATH",
  pathOutsideWorkspace: "PATH_OUTSIDE_WORKSPACE",
  symlinkOutsideWorkspace: "SYMLINK_OUTSIDE_WORKSPACE",
  fileNotFound: "FILE_NOT_FOUND",
  notAFile: "NOT_A_FILE",
  readFailed: "READ_FAILED",
  cancelled: "CANCELLED",
  invalidRoot: "INVALID_WORKSPACE_ROOT",
} as const;

export type WorkspaceErrorCode =
  (typeof WorkspaceErrorCode)[keyof typeof WorkspaceErrorCode];

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}
