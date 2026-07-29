export const ConfigurationErrorCode = {
  invalidSource: "INVALID_CONFIG_SOURCE",
  invalidResolvedConfig: "INVALID_RESOLVED_CONFIG",
  unsupportedMode: "UNSUPPORTED_MODE",
  invalidPromptInput: "INVALID_PROMPT_INPUT",
} as const;

export type ConfigurationErrorCode =
  (typeof ConfigurationErrorCode)[keyof typeof ConfigurationErrorCode];

export class ConfigurationError extends Error {
  readonly code: ConfigurationErrorCode;
  readonly details: Readonly<Record<string, string | number>>;

  constructor(
    code: ConfigurationErrorCode,
    message: string,
    details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
