import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  WorkspaceError,
  WorkspaceErrorCode,
  type Workspace,
  type WorkspaceFile,
} from "@audit-harness/application";

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function validateRelativePath(value: string): string {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new WorkspaceError(
      WorkspaceErrorCode.invalidPath,
      "Workspace path must be a non-empty relative path.",
    );
  }
  if (
    path.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[a-zA-Z]:/u.test(value)
  ) {
    throw new WorkspaceError(
      WorkspaceErrorCode.invalidPath,
      "Absolute paths are not allowed in the source workspace.",
    );
  }

  const segments = value.split(/[\\/]+/u);
  if (segments.includes("..")) {
    throw new WorkspaceError(
      WorkspaceErrorCode.pathOutsideWorkspace,
      "Workspace path cannot leave the source root.",
    );
  }

  const normalized = segments.filter((segment) => segment !== ".").join("/");
  if (normalized.length === 0) {
    throw new WorkspaceError(
      WorkspaceErrorCode.invalidPath,
      "Workspace path must identify a file.",
    );
  }
  return normalized;
}

function filesystemCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

export class FilesystemSourceWorkspace implements Workspace {
  readonly #root: string;

  private constructor(canonicalRoot: string) {
    this.#root = canonicalRoot;
  }

  static async create(root: string): Promise<FilesystemSourceWorkspace> {
    try {
      const canonicalRoot = await realpath(root);
      const rootStat = await stat(canonicalRoot);
      if (!rootStat.isDirectory()) {
        throw new WorkspaceError(
          WorkspaceErrorCode.invalidRoot,
          "Source workspace root must be a directory.",
        );
      }
      return new FilesystemSourceWorkspace(canonicalRoot);
    } catch (error: unknown) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceError(
        WorkspaceErrorCode.invalidRoot,
        "Source workspace root is unavailable.",
      );
    }
  }

  async readFile(
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceFile> {
    if (signal?.aborted === true) {
      throw new WorkspaceError(
        WorkspaceErrorCode.cancelled,
        "Workspace read was cancelled.",
      );
    }

    const normalized = validateRelativePath(relativePath);
    const lexicalCandidate = path.resolve(this.#root, ...normalized.split("/"));
    if (!isInside(this.#root, lexicalCandidate)) {
      throw new WorkspaceError(
        WorkspaceErrorCode.pathOutsideWorkspace,
        "Workspace path cannot leave the source root.",
      );
    }

    let canonicalCandidate: string;
    try {
      canonicalCandidate = await realpath(lexicalCandidate);
    } catch (error: unknown) {
      const code = filesystemCode(error);
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new WorkspaceError(
          WorkspaceErrorCode.fileNotFound,
          `"${normalized}" does not exist in the source workspace.`,
        );
      }
      throw new WorkspaceError(
        WorkspaceErrorCode.readFailed,
        `"${normalized}" could not be read from the source workspace.`,
      );
    }

    if (!isInside(this.#root, canonicalCandidate)) {
      throw new WorkspaceError(
        WorkspaceErrorCode.symlinkOutsideWorkspace,
        "Workspace symlink resolves outside the source root.",
      );
    }

    try {
      const fileStat = await lstat(canonicalCandidate);
      if (!fileStat.isFile()) {
        throw new WorkspaceError(
          WorkspaceErrorCode.notAFile,
          `"${normalized}" is not a file in the source workspace.`,
        );
      }
      const content = await readFile(canonicalCandidate, {
        encoding: "utf8",
        signal,
      });
      return { path: normalized, content };
    } catch (error: unknown) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      if (filesystemCode(error) === "ABORT_ERR") {
        throw new WorkspaceError(
          WorkspaceErrorCode.cancelled,
          "Workspace read was cancelled.",
        );
      }
      throw new WorkspaceError(
        WorkspaceErrorCode.readFailed,
        `"${normalized}" could not be read from the source workspace.`,
      );
    }
  }
}
