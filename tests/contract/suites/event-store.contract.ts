import type { EventStore } from "../../../packages/application/src/index.js";
import { describe, expect, it } from "vitest";
import { createRunEvent } from "../../helpers/slice1-builders.js";

export type EventStoreFactory = () => EventStore;

export function eventStoreContract(
  name: string,
  createStore: EventStoreFactory,
): void {
  describe(`${name} EventStore contract`, () => {
    it("returns an empty event list for an unknown run", async () => {
      const store = createStore();

      await expect(store.listByRunId("run_missing")).resolves.toEqual([]);
    });

    it("keeps append order within each run", async () => {
      const store = createStore();
      const first = createRunEvent(1);
      const second = createRunEvent(2);

      await store.append(first);
      await store.append(second);

      await expect(store.listByRunId("run_001")).resolves.toEqual([
        first,
        second,
      ]);
    });

    it("isolates event streams by run", async () => {
      const store = createStore();
      const firstRun = createRunEvent(1);
      const secondRun = createRunEvent(1, {
        event_id: "event_other",
        run_id: "run_002",
      });

      await store.append(firstRun);
      await store.append(secondRun);

      await expect(store.listByRunId("run_001")).resolves.toEqual([firstRun]);
      await expect(store.listByRunId("run_002")).resolves.toEqual([secondRun]);
    });

    it("does not expose mutable stored event objects", async () => {
      const store = createStore();
      await store.append(createRunEvent(1));

      const firstRead = await store.listByRunId("run_001");
      const mutableCopy = firstRead[0];
      if (mutableCopy === undefined) {
        throw new Error("Contract fixture must contain one event.");
      }
      mutableCopy.sequence = 99;

      const secondRead = await store.listByRunId("run_001");
      expect(secondRead).toEqual([createRunEvent(1)]);
      expect(secondRead).not.toBe(firstRead);
    });
  });
}
