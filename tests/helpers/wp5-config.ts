import { fileURLToPath } from "node:url";
import { YamlRunConfigSource } from "../../packages/adapters/src/index.js";
import {
  createRunConfiguration,
  type RunConfigSources,
} from "../../packages/application/src/index.js";

export const configRoot = fileURLToPath(
  new URL("../../config/", import.meta.url),
);
export const wp5CreatedAt = "2026-07-29T02:00:00.000Z";
export const wp5WorkspaceMetadata = {
  source_label: "slice1-source",
  language: "solidity",
  file_count: 1,
} as const;

export async function loadWp5Sources(): Promise<RunConfigSources> {
  return new YamlRunConfigSource(configRoot).loadJudgeSources();
}

export async function createWp5RunConfiguration() {
  return createRunConfiguration({
    sources: await loadWp5Sources(),
    workspace: wp5WorkspaceMetadata,
    created_at: wp5CreatedAt,
  });
}
