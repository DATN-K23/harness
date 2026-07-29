import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FilesystemSourceWorkspace } from "../../packages/adapters/src/index.js";
import {
  WorkspaceError,
  WorkspaceErrorCode,
} from "../../packages/application/src/index.js";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "audit-harness-workspace-"));
  temporaryRoots.push(root);
  const sourceRoot = path.join(root, "source");
  await mkdir(path.join(sourceRoot, "contracts"), { recursive: true });
  await writeFile(
    path.join(sourceRoot, "contracts", "Vault.sol"),
    "contract Vault {}\n",
    "utf8",
  );
  return {
    root,
    sourceRoot,
    workspace: await FilesystemSourceWorkspace.create(sourceRoot),
  };
}

function expectedWorkspaceError(code: WorkspaceErrorCode): WorkspaceError {
  return expect.objectContaining({ code }) as WorkspaceError;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FilesystemSourceWorkspace", () => {
  it("reads UTF-8 content and returns only a normalized relative path", async () => {
    const { workspace } = await createFixture();

    await expect(workspace.readFile("contracts\\Vault.sol")).resolves.toEqual({
      path: "contracts/Vault.sol",
      content: "contract Vault {}\n",
    });
  });

  it.each([
    ["/etc/passwd"],
    ["C:\\Windows\\win.ini"],
    ["\\\\server\\share\\secret.txt"],
  ])("rejects absolute path %s", async (requestedPath) => {
    const { workspace } = await createFixture();

    await expect(workspace.readFile(requestedPath)).rejects.toEqual(
      expectedWorkspaceError(WorkspaceErrorCode.invalidPath),
    );
  });

  it.each([["../secret.txt"], ["contracts/../../secret.txt"]])(
    "rejects traversal path %s",
    async (requestedPath) => {
      const { workspace } = await createFixture();

      await expect(workspace.readFile(requestedPath)).rejects.toEqual(
        expectedWorkspaceError(WorkspaceErrorCode.pathOutsideWorkspace),
      );
    },
  );

  it("rejects a symlink that resolves outside the source root", async () => {
    const { root, sourceRoot, workspace } = await createFixture();
    const outside = path.join(root, "ground-truth");
    await mkdir(outside);
    await writeFile(path.join(outside, "expected.json"), "secret", "utf8");
    await symlink(outside, path.join(sourceRoot, "hidden"), "junction");

    await expect(workspace.readFile("hidden/expected.json")).rejects.toEqual(
      expectedWorkspaceError(WorkspaceErrorCode.symlinkOutsideWorkspace),
    );
  });

  it("uses typed errors without exposing the host source root", async () => {
    const { sourceRoot, workspace } = await createFixture();

    try {
      await workspace.readFile("contracts/Missing.sol");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(error).toEqual(
        expectedWorkspaceError(WorkspaceErrorCode.fileNotFound),
      );
      expect((error as Error).message).not.toContain(sourceRoot);
      return;
    }
    throw new Error("Expected a missing-file workspace error.");
  });

  it("rejects directories and honours cancellation", async () => {
    const { workspace } = await createFixture();
    await expect(workspace.readFile("contracts")).rejects.toEqual(
      expectedWorkspaceError(WorkspaceErrorCode.notAFile),
    );

    const controller = new AbortController();
    controller.abort();
    await expect(
      workspace.readFile("contracts/Vault.sol", controller.signal),
    ).rejects.toEqual(expectedWorkspaceError(WorkspaceErrorCode.cancelled));
  });
});
