import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ConfigSourceErrorCode,
  YamlRunConfigSource,
} from "../../packages/adapters/src/index.js";
import type { ConfigSourceError } from "../../packages/adapters/src/index.js";
import { afterEach, describe, expect, it } from "vitest";
import { configRoot } from "../helpers/wp5-config.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("YamlRunConfigSource", () => {
  it("loads and validates every required WP5 source", async () => {
    const sources = await new YamlRunConfigSource(
      configRoot,
    ).loadJudgeSources();

    expect(sources).toMatchObject({
      defaults: { mode: "judge" },
      flags: { prompt_variant: "judge-v0" },
      runtime: { recovery_limits: { max_repair_attempts: 2 } },
      mode_policy: { mode: "judge" },
    });
  });

  it("returns a typed safe error for malformed YAML", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit-harness-config-"));
    temporaryRoots.push(root);
    await cp(configRoot, root, { recursive: true, force: true });
    await writeFile(path.join(root, "defaults.yaml"), "mode: [", "utf8");

    await expect(
      new YamlRunConfigSource(root).loadJudgeSources(),
    ).rejects.toEqual(
      expect.objectContaining({
        code: ConfigSourceErrorCode.invalidYaml,
      }) as ConfigSourceError,
    );
  });
});
