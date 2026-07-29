import {
  AdapterErrorCode,
  DeterministicClock,
  DeterministicIdGenerator,
} from "../../../packages/adapters/src/index.js";
import type { AdapterError } from "../../../packages/adapters/src/index.js";
import { describe, expect, it } from "vitest";

describe("DeterministicClock", () => {
  it("returns the seeded time and advances only when instructed", () => {
    const clock = new DeterministicClock("2026-07-29T01:00:00.000Z");

    expect(clock.now()).toBe("2026-07-29T01:00:00.000Z");
    expect(clock.now()).toBe("2026-07-29T01:00:00.000Z");

    clock.advanceBy(1_500);
    expect(clock.now()).toBe("2026-07-29T01:00:01.500Z");
  });

  it("rejects invalid timestamps and advances", () => {
    expect(() => new DeterministicClock("not-a-timestamp")).toThrowError(
      expect.objectContaining({
        code: AdapterErrorCode.invalidClockValue,
      }) as AdapterError,
    );
    const clock = new DeterministicClock("2026-07-29T01:00:00.000Z");
    expect(() => clock.advanceBy(-1)).toThrowError(
      expect.objectContaining({
        code: AdapterErrorCode.invalidAdvance,
      }) as AdapterError,
    );
  });
});

describe("DeterministicIdGenerator", () => {
  it("keeps an independent deterministic sequence for each ID kind", () => {
    const ids = new DeterministicIdGenerator();

    expect(ids.next("run")).toBe("run_000001");
    expect(ids.next("event")).toBe("event_000001");
    expect(ids.next("run")).toBe("run_000002");
  });

  it("accepts an explicit seed and rejects invalid seeds", () => {
    expect(new DeterministicIdGenerator(7).next("turn")).toBe("turn_000007");
    expect(() => new DeterministicIdGenerator(0)).toThrowError(
      expect.objectContaining({
        code: AdapterErrorCode.invalidIdSeed,
      }) as AdapterError,
    );
  });
});
