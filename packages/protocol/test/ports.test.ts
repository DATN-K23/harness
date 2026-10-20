import { describe, expect, test } from "bun:test"
import type { ContextItem } from "../src/context"
import type { TrajectoryEvent } from "../src/events"
import type { ModelAttemptRequest, ModelAttemptResponse } from "../src/model-gateway"
import type {
  CancellationPort,
  CandidateFinding,
  ClaimResult,
  ClockPort,
  IngestionPort,
  IngestionResult,
  NewTrajectoryEvent,
  RandomPort,
  RunClaim,
  RunStorePort,
  SandboxPort,
  SandboxResult,
  SanitizerPort,
  SanitizerResult,
  SecurityFilterPort,
  SleepPort,
  SnapshotReadResult,
  SourceSnapshotPort,
  StateProbeResult,
  ToolDefinition,
  ToolExecutionResult,
  ToolRegistryPort,
} from "../src/ports"
import type { StepOutcome } from "../src/step-outcome"
import type { JudgeVerdict } from "../src/verdict"
import { digest } from "./fixtures"

type Expect<T extends true> = T

type DeepKeys<T> = T extends readonly (infer Item)[]
  ? DeepKeys<Item>
  : T extends object
    ? { [Key in keyof T & string]: Key | DeepKeys<T[Key]> }[keyof T & string]
    : never

type ForbiddenField =
  | "label"
  | "labels"
  | "groundTruth"
  | "ground_truth"
  | "adjudication"
  | "adjudicationReport"
  | "score"
  | "scores"
  | "scorerMetadata"

type HasNoForbiddenField<T> = [Extract<DeepKeys<T>, ForbiddenField>] extends [never] ? true : false

type MutatingVerb = "write" | "delete" | "remove" | "rename" | "exec" | "run" | "create" | "set" | "put" | "append"

type MutatingName = `${string}${MutatingVerb}${string}`

type HasNoMutatingMember<T> = [Extract<Lowercase<keyof T & string>, MutatingName>] extends [never] ? true : false

type AgentVisible = [
  CandidateFinding,
  ToolDefinition,
  ToolExecutionResult,
  IngestionResult,
  SanitizerResult,
  SandboxResult,
  StateProbeResult,
  SnapshotReadResult,
  ModelAttemptRequest,
  ModelAttemptResponse,
  ContextItem,
  JudgeVerdict,
  StepOutcome,
]

type _GroundTruthFree = Expect<HasNoForbiddenField<AgentVisible>>
// @ts-expect-error the guard flags a type that carries a label field
type _LabelDetected = Expect<HasNoForbiddenField<{ nested: { label: string }[] }>>
// @ts-expect-error the guard flags a type that carries an adjudication field
type _AdjudicationDetected = Expect<HasNoForbiddenField<ToolExecutionResult & { adjudication: string }>>

type _SnapshotReadOnly = Expect<HasNoMutatingMember<SourceSnapshotPort>>
// @ts-expect-error the guard flags a snapshot port that gained a mutating member
type _MutationDetected = Expect<HasNoMutatingMember<SourceSnapshotPort & { writeFile(): void }>>

const claim: RunClaim = { runId: "run-1", claimToken: "token-1", claimVersion: 1 }

const newEvent: NewTrajectoryEvent = {
  eventId: "event-1",
  type: "run.accepted",
  schemaVersion: 1,
  payload: {},
  payloadDigest: digest("e"),
  occurredAt: "2026-10-11T08:30:00.000Z",
}

class RecordingStore implements RunStorePort {
  calls: string[] = []

  async claim(): Promise<ClaimResult> {
    this.calls.push("claim")
    return { kind: "claimed", claim, state: "running", stateVersion: 3 }
  }

  async appendEvent(input: { claim: RunClaim; expectedStateVersion: number; event: NewTrajectoryEvent }) {
    this.calls.push(`append:${input.claim.claimToken}:${input.expectedStateVersion}`)
    const event: TrajectoryEvent = { ...input.event, runId: input.claim.runId, sequence: 1 }
    return { kind: "appended", event } as const
  }

  async transition(input: { claim: RunClaim; expectedStateVersion: number; nextState: string }) {
    this.calls.push(`transition:${input.nextState}`)
    return { kind: "stale", reason: "state_changed" } as const
  }

  async loadRun() {
    return undefined
  }

  async loadEvents() {
    return []
  }
}

describe("RunStorePort", () => {
  test("every mutation requires the claim and the expected state version", async () => {
    const store: RunStorePort = new RecordingStore()
    // @ts-expect-error append without a claim does not typecheck
    const withoutClaim = store.appendEvent({ expectedStateVersion: 3, event: newEvent })
    // @ts-expect-error append without an expected state version does not typecheck
    const withoutVersion = store.appendEvent({ claim, event: newEvent })
    // @ts-expect-error transition without a claim does not typecheck
    const transitionWithoutClaim = store.transition({
      expectedState: "running",
      expectedStateVersion: 3,
      nextState: "completed",
    })
    // @ts-expect-error transition without an expected state version does not typecheck
    const transitionWithoutVersion = store.transition({ claim, expectedState: "running", nextState: "completed" })
    await Promise.allSettled([withoutClaim, withoutVersion, transitionWithoutClaim, transitionWithoutVersion])

    const appended = await store.appendEvent({ claim, expectedStateVersion: 3, event: newEvent })
    expect(appended.kind === "appended" && appended.event.runId).toBe("run-1")
    const moved = await store.transition({
      claim,
      expectedState: "running",
      expectedStateVersion: 3,
      nextState: "completed",
    })
    expect(moved.kind).toBe("stale")
  })

  test("reads need no claim and accept an abort signal", async () => {
    const store: RunStorePort = new RecordingStore()
    const controller = new AbortController()
    expect(await store.loadRun("run-1", controller.signal)).toBeUndefined()
    expect(await store.loadEvents({ runId: "run-1", afterSequence: 0 }, controller.signal)).toEqual([])
  })
})

describe("stage ports", () => {
  test("ingestion, sanitizer and sandbox results are tagged and carry the ruled fields", async () => {
    const finding: CandidateFinding = { findingId: "finding-1", reportMarkdown: "# report" }
    const ingestion: IngestionPort = {
      async ingest(): Promise<IngestionResult> {
        const bceSlices = [{ filePath: "src/A.sol", content: "contract A {}" }]
        return { kind: "ok", pocCode: "contract T {}", bceSlices }
      },
    }
    const sanitizer: SanitizerPort = {
      async sanitize(): Promise<SanitizerResult> {
        return {
          kind: "ok",
          stitchedTestFile: "contract T {}",
          hasSubmitterAssertions: false,
          antiCheatReport: { rulesChecked: ["vm.ffi"], findings: [] },
        }
      },
      async injectStateProbes(stitchedTestFile, stateVariables) {
        return { probedTestFile: `${stitchedTestFile}// probes ${stateVariables.join(",")}` }
      },
    }
    const sandbox: SandboxPort = {
      async runSingleShot(): Promise<SandboxResult> {
        return { exitCode: 0, trace: "trace", durationMs: 5 }
      },
      async runStateProbe(): Promise<StateProbeResult> {
        return { exitCode: 0, trace: "probe", stateDeltas: [{ variable: "totalSupply", before: "1", after: "2" }] }
      },
    }
    const input = { runId: "run-1", snapshotId: "snap-1" }
    const ingested = await ingestion.ingest({ ...input, finding })
    expect(ingested.kind).toBe("ok")
    const sanitized = await sanitizer.sanitize({ ...input, pocCode: "contract T {}" })
    expect(sanitized.kind === "ok" && sanitized.hasSubmitterAssertions).toBe(false)
    const probed = await sanitizer.injectStateProbes("file;", ["totalSupply"])
    expect(probed.probedTestFile).toBe("file;// probes totalSupply")
    const probe = await sandbox.runStateProbe({ ...input, probedTestFile: probed.probedTestFile })
    expect(probe.stateDeltas[0]).toEqual({ variable: "totalSupply", before: "1", after: "2" })
    expect((await sandbox.runSingleShot({ ...input, testFile: "x" })).exitCode).toBe(0)
  })

  test("a missing PoC and a detected cheat are expressible as results", () => {
    const missing: IngestionResult = { kind: "missing_poc" }
    const cheat: SanitizerResult = {
      kind: "cheat_detected",
      findings: [{ ruleId: "vm.ffi", message: "ffi call", line: 12 }],
    }
    expect([missing.kind, cheat.kind]).toEqual(["missing_poc", "cheat_detected"])
  })

  test("narrative-only ingestion carries typed claims without PoC", () => {
    const narrative: IngestionResult = { kind: "ok", bceSlices: [], claim: { targetContracts: ["Vault"], targetFunctions: ["withdraw"], rootCause: "bad auth", attackScenario: "attacker calls", callerAssumptions: [], claimedImpact: "fund loss", claimedState: "balance reduced" } }
    expect(narrative.kind === "ok" && narrative.pocCode).toBeUndefined()
  })
})

describe("tool, filter, snapshot and runtime ports", () => {
  test("fakes implement the remaining ports with optional abort signals", async () => {
    const tools: ToolRegistryPort = {
      definitions: () => [{ name: "read_file", description: "Read a file", parameters: { type: "object" } }],
      async execute(call): Promise<ToolExecutionResult> {
        return { content: `read ${String(call.arguments.path)}`, isError: false }
      },
    }
    const filter: SecurityFilterPort = {
      async filterSecrets(content) {
        return { content: content.replaceAll("sk-secret", "[redacted]"), redactionCount: 1 }
      },
    }
    const snapshotPort: SourceSnapshotPort = {
      async readLines(): Promise<SnapshotReadResult> {
        return { kind: "ok", lines: ["line"] }
      },
      async listFiles() {
        return ["src/A.sol"]
      },
    }
    const clock: ClockPort = { nowMs: () => 1_700_000_000_000 }
    const random: RandomPort = { next: () => 0.5 }
    const sleep: SleepPort = { sleep: async () => undefined }
    const cancellation: CancellationPort = { isRequested: async () => false }

    expect(tools.definitions()[0].name).toBe("read_file")
    const call = { runId: "run-1", callId: "c", toolName: "read_file", arguments: { path: "a" } }
    expect((await tools.execute(call)).content).toBe("read a")
    expect((await filter.filterSecrets("key sk-secret")).content).toBe("key [redacted]")
    const read = await snapshotPort.readLines({ snapshotId: "snap-1", path: "src/A.sol", startLine: 1, endLine: 1 })
    expect(read).toEqual({ kind: "ok", lines: ["line"] })
    expect(await snapshotPort.listFiles({ snapshotId: "snap-1" })).toEqual(["src/A.sol"])
    expect(clock.nowMs()).toBe(1_700_000_000_000)
    expect(random.next()).toBe(0.5)
    await sleep.sleep(10, new AbortController().signal)
    expect(await cancellation.isRequested("run-1")).toBe(false)
  })
})
