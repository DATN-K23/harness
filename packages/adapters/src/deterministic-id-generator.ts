import type { IdGenerator, IdKind } from "@audit-harness/application";
import { AdapterError, AdapterErrorCode } from "./adapter-error.js";

const idPrefixes = {
  run: "run",
  turn: "turn",
  message: "message",
  tool_call: "tool_call",
  event: "event",
  provider_attempt: "provider_attempt",
} as const satisfies Readonly<Record<IdKind, string>>;

export class DeterministicIdGenerator implements IdGenerator {
  readonly #counters = new Map<IdKind, number>();
  readonly #seed: number;

  constructor(seed = 1) {
    if (!Number.isSafeInteger(seed) || seed < 1) {
      throw new AdapterError(
        AdapterErrorCode.invalidIdSeed,
        "ID seed must be a positive safe integer.",
      );
    }
    this.#seed = seed;
  }

  next(kind: IdKind): string {
    const current = this.#counters.get(kind) ?? this.#seed;
    this.#counters.set(kind, current + 1);
    return `${idPrefixes[kind]}_${current.toString().padStart(6, "0")}`;
  }
}
