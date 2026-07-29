import {
  InMemoryEventStore,
  InMemoryRunRepository,
} from "../../packages/adapters/src/index.js";
import { eventStoreContract } from "./suites/event-store.contract.js";
import { runRepositoryContract } from "./suites/run-repository.contract.js";

runRepositoryContract(
  "InMemoryRunRepository",
  () => new InMemoryRunRepository(),
);
eventStoreContract("InMemoryEventStore", () => new InMemoryEventStore());
