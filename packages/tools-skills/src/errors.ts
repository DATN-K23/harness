import {
  ToolErrorSchema,
  type JsonObject,
  type ToolError,
} from "@audit-harness/contracts";

export const RegistryErrorCode = {
  duplicateToolId: "DUPLICATE_TOOL_ID",
  invalidDefinition: "INVALID_TOOL_DEFINITION",
} as const;

export type RegistryErrorCode =
  (typeof RegistryErrorCode)[keyof typeof RegistryErrorCode];

export class RegistryError extends Error {
  readonly code: RegistryErrorCode;

  constructor(code: RegistryErrorCode, message: string) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
  }
}

export class ToolExecutionError extends Error {
  readonly error: ToolError;

  constructor(value: ToolError) {
    const error = ToolErrorSchema.parse(value);
    super(error.message);
    this.name = "ToolExecutionError";
    this.error = error;
  }
}

export function createToolError(
  value: Omit<ToolError, "details"> & { details?: JsonObject },
): ToolExecutionError {
  return new ToolExecutionError({
    ...value,
    details: value.details ?? {},
  } as ToolError);
}
