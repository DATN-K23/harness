import {
  RunEventSchema,
  type RunEvent,
  type RunId,
} from "@audit-harness/contracts";
import type { EventStore } from "@audit-harness/application";
import { AdapterError, AdapterErrorCode } from "./adapter-error.js";

export class InMemoryEventStore implements EventStore {
  readonly #eventsByRun = new Map<RunId, RunEvent[]>();
  readonly #eventIds = new Set<string>();

  append(value: RunEvent): Promise<void> {
    return Promise.resolve().then(() => {
      const parsed = RunEventSchema.safeParse(value);
      if (!parsed.success) {
        throw new AdapterError(
          AdapterErrorCode.invalidEvent,
          "Run event does not satisfy the frozen contract.",
        );
      }

      const event = structuredClone(parsed.data);
      const current = this.#eventsByRun.get(event.run_id) ?? [];
      if (this.#eventIds.has(event.event_id)) {
        throw new AdapterError(
          AdapterErrorCode.duplicateEvent,
          "An event with this identifier already exists in the run.",
        );
      }

      const expectedSequence = current.length + 1;
      if (event.sequence !== expectedSequence) {
        throw new AdapterError(
          AdapterErrorCode.eventSequenceConflict,
          `Expected event sequence ${expectedSequence}, received ${event.sequence}.`,
        );
      }

      current.push(event);
      this.#eventIds.add(event.event_id);
      this.#eventsByRun.set(event.run_id, current);
    });
  }

  listByRunId(runId: RunId): Promise<readonly RunEvent[]> {
    return Promise.resolve(structuredClone(this.#eventsByRun.get(runId) ?? []));
  }
}
