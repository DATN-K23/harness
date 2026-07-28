import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface RootPackage {
  private: boolean;
  packageManager: string;
  engines: {
    node: string;
    pnpm: string;
  };
  scripts: Record<string, string>;
}

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readRootFile(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

describe("workspace contract", () => {
  it("pins the Node.js and pnpm runtime families", async () => {
    const nodeVersion = (await readRootFile("../../.node-version")).trim();
    const packageJson = JSON.parse(
      await readRootFile("../../package.json"),
    ) as RootPackage;

    expect(nodeVersion).toBe("24");
    expect(packageJson.private).toBe(true);
    expect(packageJson.packageManager).toBe("pnpm@11.17.0");
    expect(packageJson.engines).toEqual({
      node: ">=24 <25",
      pnpm: ">=11 <12",
    });
    expect(process.versions.node.split(".")[0]).toBe("24");
  });

  it("defines every quality command implemented in WP1", async () => {
    const packageJson = JSON.parse(
      await readRootFile("../../package.json"),
    ) as RootPackage;

    expect(packageJson.scripts).toHaveProperty("check");
    expect(packageJson.scripts).toHaveProperty("test");
    expect(packageJson.scripts).toHaveProperty("test:e2e:slice1");
    expect(packageJson.scripts).toHaveProperty("verify");
  });

  it("keeps root config outside domain and runtime packages", () => {
    expect(
      repositoryRoot.endsWith("harness\\") ||
        repositoryRoot.endsWith("harness/"),
    ).toBe(true);
  });
});
