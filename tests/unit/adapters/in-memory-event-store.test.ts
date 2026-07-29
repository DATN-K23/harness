import {
  AdapterErrorCode,
  InMemoryEventStore,
} from "../../../packages/adapters/src/index.js";
import type { AdapterError } from "../../../packages/adapters/src/index.js";
import { describe, expect, it } from "vitest";
import { createRunEvent } from "../../helpers/slice1-builders.js";

describe("InMemoryEventStore invariants", () => {
  it("rejects a sequence gap", async () => {
    const store = new InMemoryEventStore();

    await expect(store.append(createRunEvent(2))).rejects.toEqual(
      expect.objectContaining({
        code: AdapterErrorCode.eventSequenceConflict,
      }) as AdapterError,
    );
  });

  it("rejects a duplicate event identifier", async () => {
    const store = new InMemoryEventStore();
    await store.append(createRunEvent(1));

    await expect(
      store.append(createRunEvent(2, { event_id: "event_1" })),
    ).rejects.toEqual(
      expect.objectContaining({
        code: AdapterErrorCode.duplicateEvent,
      }) as AdapterError,
    );
  });

  it("keeps event identifiers unique across runs", async () => {
    const store = new InMemoryEventStore();
    await store.append(createRunEvent(1));

    await expect(
      store.append(
        createRunEvent(1, {
          event_id: "event_1",
          run_id: "run_002",
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: AdapterErrorCode.duplicateEvent,
      }) as AdapterError,
    );
  });
});
