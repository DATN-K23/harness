import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DefaultsConfigSchema,
  FlagsConfigSchema,
  JudgePolicyConfigSchema,
  RuntimeConfigSchema,
  type RunConfigSources,
} from "@audit-harness/application";
import { parse } from "yaml";

export const ConfigSourceErrorCode = {
  unavailable: "CONFIG_SOURCE_UNAVAILABLE",
  invalidYaml: "INVALID_CONFIG_YAML",
  invalidShape: "INVALID_CONFIG_SHAPE",
} as const;

export type ConfigSourceErrorCode =
  (typeof ConfigSourceErrorCode)[keyof typeof ConfigSourceErrorCode];

export class ConfigSourceError extends Error {
  readonly code: ConfigSourceErrorCode;

  constructor(code: ConfigSourceErrorCode, message: string) {
    super(message);
    this.name = "ConfigSourceError";
    this.code = code;
  }
}

interface ConfigFile {
  readonly relativePath: string;
  readonly schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: unknown }
      | { success: false; error: { issues: readonly unknown[] } };
  };
}

const configFiles = {
  defaults: {
    relativePath: "defaults.yaml",
    schema: DefaultsConfigSchema,
  },
  flags: {
    relativePath: "flags.yaml",
    schema: FlagsConfigSchema,
  },
  runtime: {
    relativePath: "runtime.yaml",
    schema: RuntimeConfigSchema,
  },
  mode_policy: {
    relativePath: "policies/judge.yaml",
    schema: JudgePolicyConfigSchema,
  },
} as const satisfies Readonly<Record<string, ConfigFile>>;

export class YamlRunConfigSource {
  readonly #configRoot: string;

  constructor(configRoot: string) {
    this.#configRoot = path.resolve(configRoot);
  }

  async loadJudgeSources(): Promise<RunConfigSources> {
    const defaults = await this.readConfigFile(configFiles.defaults);
    const flags = await this.readConfigFile(configFiles.flags);
    const runtime = await this.readConfigFile(configFiles.runtime);
    const modePolicy = await this.readConfigFile(configFiles.mode_policy);
    return {
      defaults,
      flags,
      runtime,
      mode_policy: modePolicy,
    };
  }

  private async readConfigFile(definition: ConfigFile): Promise<unknown> {
    let content: string;
    try {
      content = await readFile(
        path.resolve(this.#configRoot, definition.relativePath),
        "utf8",
      );
    } catch {
      throw new ConfigSourceError(
        ConfigSourceErrorCode.unavailable,
        `Required configuration "${definition.relativePath}" is unavailable.`,
      );
    }

    let value: unknown;
    try {
      value = parse(content);
    } catch {
      throw new ConfigSourceError(
        ConfigSourceErrorCode.invalidYaml,
        `Configuration "${definition.relativePath}" is not valid YAML.`,
      );
    }

    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      throw new ConfigSourceError(
        ConfigSourceErrorCode.invalidShape,
        `Configuration "${definition.relativePath}" has an invalid shape.`,
      );
    }
    return parsed.data;
  }
}
