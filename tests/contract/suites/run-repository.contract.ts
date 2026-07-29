import type { RunRepository } from "../../../packages/application/src/index.js";
import { describe, expect, it } from "vitest";
import { createQueuedRunState } from "../../helpers/slice1-builders.js";

export type RunRepositoryFactory = () => RunRepository;

export function runRepositoryContract(
  name: string,
  createRepository: RunRepositoryFactory,
): void {
  describe(`${name} RunRepository contract`, () => {
    it("returns null for an unknown run", async () => {
      const repository = createRepository();

      await expect(repository.findById("run_missing")).resolves.toBeNull();
    });

    it("persists and retrieves a run by identifier", async () => {
      const repository = createRepository();
      const state = createQueuedRunState();

      await repository.save(state);

      const stored = await repository.findById(state.run.run_id);
      expect(stored?.run).toEqual(state.run);
    });

    it("replaces the stored state for the same run", async () => {
      const repository = createRepository();
      const queued = createQueuedRunState();
      const running = queued.start("2026-07-29T01:00:01.000Z");

      await repository.save(queued);
      await repository.save(running);

      await expect(repository.findById("run_001")).resolves.toMatchObject({
        run: { status: "running" },
      });
    });
  });
}
