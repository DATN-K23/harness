export const AdapterErrorCode = {
  invalidEvent: "INVALID_EVENT",
  eventSequenceConflict: "EVENT_SEQUENCE_CONFLICT",
  duplicateEvent: "DUPLICATE_EVENT",
  invalidClockValue: "INVALID_CLOCK_VALUE",
  invalidAdvance: "INVALID_CLOCK_ADVANCE",
  invalidIdSeed: "INVALID_ID_SEED",
} as const;

export type AdapterErrorCode =
  (typeof AdapterErrorCode)[keyof typeof AdapterErrorCode];

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;

  constructor(code: AdapterErrorCode, message: string) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
  }
}
