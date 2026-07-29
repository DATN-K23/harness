import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  ConfigurationErrorCode,
  createRunConfiguration,
  resolveRunConfiguration,
} from "../../packages/application/src/index.js";
import type { ConfigurationError } from "../../packages/application/src/index.js";
import { describe, expect, it } from "vitest";
import {
  createWp5RunConfiguration,
  loadWp5Sources,
  wp5CreatedAt,
  wp5WorkspaceMetadata,
} from "../helpers/wp5-config.js";

const goldenPromptPath = fileURLToPath(
  new URL("../fixtures/prompts/judge-v0-system-context.txt", import.meta.url),
);

describe("WP5 run configuration", () => {
  it("matches the Judge v0 golden prompt and pinned manifest", async () => {
    const configuration = await createWp5RunConfiguration();
    const golden = (await readFile(goldenPromptPath, "utf8")).trimEnd();

    expect(configuration.prompt.system_context).toBe(golden);
    expect(
      configuration.prompt.manifest.components.map(({ id }) => id),
    ).toEqual([
      "harness-policy",
      "judge-instruction",
      "workspace-metadata",
      "enabled-skill-summary",
      "run-budget",
      "judge-output-contract",
    ]);
    expect(configuration.prompt.manifest.aggregate_hash).toBe(
      "sha256:6eb29ecc7cf60ac4e2cb355294bf621c99d85ab621ea78727c90ece181f541fd",
    );
  });

  it("stores the complete prompt manifest, policy and recovery limit", async () => {
    const configuration = await createWp5RunConfiguration();

    expect(configuration.snapshot.prompt_manifest).toEqual(
      configuration.prompt.manifest,
    );
    expect(configuration.snapshot.recovery_limits).toEqual({
      max_repair_attempts: 2,
    });
    expect(configuration.snapshot.policy).toEqual(
      configuration.resolved.policy,
    );
  });

  it("recreates the same snapshot and prompt hash from the same input", async () => {
    const first = await createWp5RunConfiguration();
    const second = await createWp5RunConfiguration();

    expect(second.snapshot).toEqual(first.snapshot);
    expect(second.prompt.manifest.aggregate_hash).toBe(
      first.prompt.manifest.aggregate_hash,
    );
  });

  it("applies experiment before explicit run override", async () => {
    const sources = await loadWp5Sources();
    const resolved = resolveRunConfiguration({
      ...sources,
      experiment: {
        limits: { max_steps: 6 },
        model: { model: "experiment-model" },
      },
      override: {
        limits: { max_steps: 8 },
      },
    });

    expect(resolved.limits.max_steps).toBe(8);
    expect(resolved.model.model).toBe("experiment-model");
  });

  it("rejects invalid config before a snapshot can be created", async () => {
    const sources = await loadWp5Sources();
    const invalidSources = {
      ...sources,
      runtime: {
        ...(sources.runtime as Record<string, unknown>),
        limits: {
          max_steps: 0,
          max_input_tokens: 10_000,
          max_output_tokens: 2_000,
          max_cost_usd: 0,
          wall_clock_timeout_ms: 30_000,
        },
      },
    };

    expect(() =>
      createRunConfiguration({
        sources: invalidSources,
        workspace: wp5WorkspaceMetadata,
        created_at: wp5CreatedAt,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: ConfigurationErrorCode.invalidSource,
      }) as ConfigurationError,
    );
  });

  it("deep-freezes the resolved configuration and snapshot", async () => {
    const configuration = await createWp5RunConfiguration();

    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.snapshot)).toBe(true);
    expect(Object.isFrozen(configuration.snapshot.limits)).toBe(true);
    expect(Object.isFrozen(configuration.snapshot.policy?.workspace)).toBe(
      true,
    );
    const mutableLimits = configuration.snapshot.limits as {
      max_steps: number;
    };
    expect(() => {
      mutableLimits.max_steps = 99;
    }).toThrow(TypeError);
  });

  it("does not include tool implementation, host path or oracle data", async () => {
    const configuration = await createWp5RunConfiguration();
    const prompt = configuration.prompt.system_context;

    expect(prompt).not.toContain("function read_file");
    expect(prompt).not.toContain("F:\\DATN");
    expect(prompt).not.toContain("valid-reentrancy-verdict.json");
    expect(prompt).not.toContain("The external call occurs before balance");
    expect(prompt).not.toContain("contracts/Vault.sol");
  });
});
