import { TimestampSchema } from "@audit-harness/contracts";
import type { Clock } from "@audit-harness/application";
import { AdapterError, AdapterErrorCode } from "./adapter-error.js";

export class DeterministicClock implements Clock {
  #epochMilliseconds: number;

  constructor(initialTimestamp: string) {
    const parsed = TimestampSchema.safeParse(initialTimestamp);
    if (!parsed.success) {
      throw new AdapterError(
        AdapterErrorCode.invalidClockValue,
        "Deterministic clock requires an ISO-8601 timestamp with timezone.",
      );
    }
    this.#epochMilliseconds = Date.parse(parsed.data);
  }

  now(): string {
    return new Date(this.#epochMilliseconds).toISOString();
  }

  advanceBy(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new AdapterError(
        AdapterErrorCode.invalidAdvance,
        "Clock advance must be a non-negative safe integer in milliseconds.",
      );
    }
    this.#epochMilliseconds += milliseconds;
  }
}
