import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FilesystemSourceWorkspace } from "../../packages/adapters/src/index.js";
import { ToolExecutionError } from "../../packages/tools-skills/src/index.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  createReadFileRegistry,
  createToolRequest,
} from "../helpers/tool-registry.js";

const temporaryRoots: string[] = [];

async function createBoundaryFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "audit-harness-tool-"));
  temporaryRoots.push(root);
  const sourceRoot = path.join(root, "source");
  const outsideRoot = path.join(root, "expected");
  await mkdir(sourceRoot);
  await mkdir(outsideRoot);
  await writeFile(path.join(sourceRoot, "Safe.sol"), "contract Safe {}\n");
  await writeFile(path.join(outsideRoot, "verdict.json"), '{"valid":true}\n');
  await symlink(outsideRoot, path.join(sourceRoot, "hidden"), "junction");
  return {
    root,
    workspace: await FilesystemSourceWorkspace.create(sourceRoot),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("read_file workspace boundary", () => {
  it.each([
    ["C:\\Windows\\win.ini"],
    ["/etc/passwd"],
    ["../expected/verdict.json"],
    ["hidden/verdict.json"],
  ])(
    "maps denied path %s to a safe permission error",
    async (requestedPath) => {
      const { root, workspace } = await createBoundaryFixture();
      const registry = createReadFileRegistry();

      await expect(
        registry.execute(createToolRequest(workspace, { path: requestedPath })),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(ToolExecutionError);
        const toolError = (error as ToolExecutionError).error;
        expect(toolError).toMatchObject({
          category: "permission_denied",
          retryable: false,
          code: "WORKSPACE_PATH_DENIED",
        });
        expect(toolError.model_message).not.toContain(root);
        expect(toolError.model_message).not.toContain("at ");
        expect(toolError.model_message).not.toContain("stack");
        expect(toolError.model_message).not.toContain("..\\");
        return true;
      });
    },
  );
});
