import { describe, expect, test } from "bun:test"
import { ContextFlagNames, ResolvedFlagNames, RunConfigSnapshotSchema, type ResolvedFlagName } from "@harness/protocol"
import { digestOf } from "../../src/util/digest"
import { createWorld, runInput, verdictText } from "../helpers/runner-world"
import { flags, policy } from "../runner/judge-step-harness"

// Task 7.4. Behavioral differences, one test per state, live next to the code they exercise:
//   enableSchemaRepair          test/runner/judge-step.test.ts "JudgeStep: verdict validation and repair"
//   enableMaxStepsForcing       test/runner/judge-step.test.ts "JudgeStep: step-limit forcing"
//   enableNoProgressDetection   test/runner/stop-conditions.test.ts "enableNoProgressDetection on/off"
//   enableInfraRetry            test/runner/retry-policy.test.ts "enableInfraRetry"
//   enableParallelToolDispatch  test/step/parallel-tool-dispatcher.test.ts "with parallel dispatch on/off"
//   enableToolTruncation, enableLlmCompaction  test/testing/fake-context-engines.test.ts and judge-runner.test.ts
// This file adds, for all eleven flags, the recorded value and digest in run.started and (for the six context
// flags) the unchanged hand-over to the context engine.
const runWith = async (name: ResolvedFlagName, value: boolean) => {
  const resolved = { ...flags, [name]: value }
  const contextFlags = Object.fromEntries(ContextFlagNames.map((flag) => [flag, resolved[flag]])) as typeof policy.flags
  const world = createWorld()
  const w = world.worker({ script: [verdictText] })
  await w.start("worker-a", runInput({ flags: resolved, policy: { ...policy, flags: contextFlags } }))
  const [started] = await world.events("run.started")
  const snapshot = RunConfigSnapshotSchema.parse(started.payload.snapshot)
  return { w, snapshot, digest: started.payload.snapshotDigest }
}

describe("flag matrix: the resolved value is recorded and reaches its consumer", () => {
  test.each([...ResolvedFlagNames])("%s on and off", async (name) => {
    const on = await runWith(name, true)
    const off = await runWith(name, false)

    expect([on.snapshot.flags[name], off.snapshot.flags[name]]).toEqual([true, false])
    expect(on.digest).toBe(digestOf(on.snapshot))
    expect(off.digest).toBe(digestOf(off.snapshot))
    expect(on.digest).not.toBe(off.digest)

    const contextFlag = ContextFlagNames.find((flag) => flag === name)
    if (contextFlag === undefined) return
    const seen = (run: typeof on) => run.w.engine.prepareCalls.map((call) => call.policy.flags[contextFlag])
    expect(seen(on)).toEqual([true])
    expect(seen(off)).toEqual([false])
  })
})
