import {
  composeJudgePrompt,
  createPromptManifest,
  normalizePromptContent,
} from "../../../packages/application/src/index.js";
import { describe, expect, it } from "vitest";
import {
  createWp5RunConfiguration,
  wp5WorkspaceMetadata,
} from "../../helpers/wp5-config.js";

describe("prompt hashing", () => {
  it("normalizes BOM, Unicode and line endings before hashing", () => {
    const lf = createPromptManifest([
      {
        id: "component",
        version: "1.0.0",
        content: "café\nsecond line\n",
      },
    ]);
    const crlf = createPromptManifest([
      {
        id: "component",
        version: "1.0.0",
        content: "\uFEFFcafe\u0301\r\nsecond line\r\n",
      },
    ]);

    expect(crlf).toEqual(lf);
    expect(normalizePromptContent("a\rb\r\nc")).toBe("a\nb\nc");
  });

  it("changes aggregate hash when component content changes", () => {
    const original = createPromptManifest([
      { id: "one", version: "1.0.0", content: "original" },
    ]);
    const changed = createPromptManifest([
      { id: "one", version: "1.0.0", content: "changed" },
    ]);

    expect(changed.aggregate_hash).not.toBe(original.aggregate_hash);
  });

  it("changes aggregate hash when component order changes", () => {
    const components = [
      { id: "one", version: "1.0.0", content: "first" },
      { id: "two", version: "1.0.0", content: "second" },
    ] as const;

    const forward = createPromptManifest(components);
    const reversed = createPromptManifest([...components].reverse());

    expect(reversed.aggregate_hash).not.toBe(forward.aggregate_hash);
  });

  it("rejects workspace labels that could carry a host path", async () => {
    const configuration = await createWp5RunConfiguration();

    expect(() =>
      composeJudgePrompt({
        prompt_variant: configuration.resolved.prompt_variant,
        output_contract_version: configuration.resolved.output_contract_version,
        workspace: {
          ...wp5WorkspaceMetadata,
          source_label: "F:\\secret\\source",
        },
        enabled_skill_ids: [],
        limits: configuration.resolved.limits,
        recovery_limits: configuration.resolved.recovery_limits,
        policy: configuration.resolved.policy,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_PROMPT_INPUT" }) as Error,
    );
  });
});
