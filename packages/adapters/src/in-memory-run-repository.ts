import type { RunId } from "@audit-harness/contracts";
import type { RunRepository } from "@audit-harness/application";
import type { RunState } from "@audit-harness/domain";

export class InMemoryRunRepository implements RunRepository {
  readonly #runs = new Map<RunId, RunState>();

  save(state: RunState): Promise<void> {
    this.#runs.set(state.run.run_id, state);
    return Promise.resolve();
  }

  findById(runId: RunId): Promise<RunState | null> {
    return Promise.resolve(this.#runs.get(runId) ?? null);
  }
}
