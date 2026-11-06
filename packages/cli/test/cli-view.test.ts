import { describe, expect, test } from "bun:test"
import { executeViewCommand } from "../src/commands/view"
import { InMemoryRunStore } from "@harness/core/testing"
import { digestOf } from "@harness/core"

describe("executeViewCommand", () => {
  test("fails when id flag is missing", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const { exitCode, output } = await executeViewCommand({ id: "" }, { store })

    expect(exitCode).toBe(1)
    expect(output).toContain("Error: --id <runId> is required")
  })

  test("reports error when run is not found in store", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const { exitCode, output } = await executeViewCommand({ id: "run-unknown-999" }, { store })

    expect(exitCode).toBe(1)
    expect(output).toContain("Error: Run 'run-unknown-999' not found")
  })

  test("displays run details and chronological trajectory events for existing run", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const runId = "run-test-101"
    const workerId = "test-worker"

    // Set up existing run and events in store
    store.seedRun(runId, "queued")
    const claimResult = await store.claim({ runId, workerId })
    if (claimResult.kind !== "claimed") throw new Error("claim failed")

    const eventPayload = { prompt: "Test prompt inspection" }
    await store.appendEvent({
      claim: claimResult.claim,
      expectedStateVersion: claimResult.stateVersion,
      event: {
        eventId: "evt-101",
        type: "run.queued",
        schemaVersion: 1,
        payload: eventPayload,
        payloadDigest: digestOf(eventPayload),
        occurredAt: new Date(1700000000000).toISOString(),
      },
    })
    await store.transition({
      claim: claimResult.claim,
      expectedState: "queued",
      expectedStateVersion: claimResult.stateVersion,
      nextState: "completed",
    })
    const { exitCode, output } = await executeViewCommand({ id: runId }, { store })

    expect(exitCode).toBe(0)
    expect(output).toContain("Run Inspection Record")
    expect(output).toContain(`Run ID:       ${runId}`)
    expect(output).toContain("State:        completed")
    expect(output).toContain("run.queued")
    expect(output).toContain("Test prompt inspection")
  })

  test("displays rich run record with all metadata and redacts secrets", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const runId = "run-rich-202"
    const secretKey = "super-secret-key-999"

    store.seedRun(runId, "queued")
    const claimResult = await store.claim({ runId, workerId: "test-worker" })
    if (claimResult.kind !== "claimed") throw new Error("claim failed")

    await store.transition({
      claim: claimResult.claim,
      expectedState: "queued",
      expectedStateVersion: claimResult.stateVersion,
      nextState: "completed",
      terminalReason: "wall_clock",
      modelProfile: "claude-3-5-sonnet",
      latencyMs: 1250,
      costUsd: 0.0035,
      promptTokens: 150,
      completionTokens: 80,
      totalTokens: 230,
      prompt: `Analyze this contract with ${secretKey}`,
      resultContent: `Contract analysis report with ${secretKey}`,
    })

    const { exitCode, output } = await executeViewCommand({ id: runId }, { store, secrets: [secretKey] })

    expect(exitCode).toBe(0)
    expect(output).toContain(`Run ID:       ${runId}`)
    expect(output).toContain("State:        completed")
    expect(output).toContain("Version:      2")
    expect(output).toContain("Terminal:     wall_clock")
    expect(output).toContain("Model:        claude-3-5-sonnet")
    expect(output).toContain("Latency:      1250ms")
    expect(output).toContain("Cost:         $0.003500")
    expect(output).toContain("Tokens:       230 (prompt: 150, completion: 80)")
    expect(output).toContain("Prompt:")
    expect(output).toContain("Model Output:")
    expect(output).not.toContain(secretKey)
    expect(output).toContain("[REDACTED]")
  })

  test("multi-turn JSON retains prompt digest but omits raw prompt", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const runId = "run-json-prompt-digest"
    const prompt = "sk-sensitive-looking-prompt-marker-123"
    store.seedRun(runId, "queued", prompt, "snapshot-json")

    const { exitCode, output } = await executeViewCommand({ id: runId, json: true }, { store })
    const json = JSON.parse(output)

    expect(exitCode).toBe(0)
    expect(json.promptDigest).toBe(digestOf(prompt))
    expect(json).not.toHaveProperty("prompt")
    expect(output).not.toContain(prompt)
  })

  test("displays rich run record for failed run with error and category redacted", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const runId = "run-failed-303"
    const secretToken = "ghp_leakedSecretToken"

    store.seedRun(runId, "queued")
    const claimResult = await store.claim({ runId, workerId: "test-worker" })
    if (claimResult.kind !== "claimed") throw new Error("claim failed")

    await store.transition({
      claim: claimResult.claim,
      expectedState: "queued",
      expectedStateVersion: claimResult.stateVersion,
      nextState: "failed",
      terminalReason: "provider_permanent",
      errorCategory: "authentication",
      errorMessage: `Failed using token ${secretToken}`,
    })

    const { exitCode, output } = await executeViewCommand({ id: runId }, { store, secrets: [secretToken] })

    expect(exitCode).toBe(0)
    expect(output).toContain(`Run ID:       ${runId}`)
    expect(output).toContain("State:        failed")
    expect(output).toContain("Terminal:     provider_permanent")
    expect(output).toContain("Error (authentication):")
    expect(output).not.toContain(secretToken)
    expect(output).toContain("[REDACTED]")
  })

  test("displays structured Judge verdict and evidence citations", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const runId = "run-judge-view-404"
    const findingId = "finding-view-test"

    store.seedRun(runId, "queued")
    const claimResult = await store.claim({ runId, workerId: "test-worker" })
    if (claimResult.kind !== "claimed") throw new Error("claim failed")

    const verdict = {
      runId,
      findingId,
      validity: "unverified" as const,
      verificationStatus: "UNVERIFIED" as const,
      confidence: "MEDIUM" as const,
      reasonCode: "UNRESOLVED" as const,
      summary: "Claimed reentrancy could not be verified by dynamic PoC execution.",
      reasoning: "Static analysis identified balance check pattern but runtime exploit witness was not executed.",
      citesEvidence: [
        {
          filePath: "src/Vault.sol",
          startLine: 15,
          endLine: 25,
          explanation: "Function withdraw state modification before external call",
          contentDigest: "sha256:abc123def456",
        },
      ],
    }

    await store.appendEvent({
      claim: claimResult.claim,
      expectedStateVersion: claimResult.stateVersion,
      event: {
        eventId: "evt-completed",
        type: "run.completed",
        schemaVersion: 1,
        payload: { verdict },
        payloadDigest: digestOf({ verdict }),
        occurredAt: new Date().toISOString(),
      },
    })

    await store.transition({
      claim: claimResult.claim,
      expectedState: "queued",
      expectedStateVersion: claimResult.stateVersion,
      nextState: "completed",
    })

    const { exitCode, output } = await executeViewCommand({ id: runId }, { store })
    expect(exitCode).toBe(0)
    expect(output).toContain("Judge Run Inspection Record")
    expect(output).toContain("Judge Verdict:")
    expect(output).toContain("Validity:          unverified")
    expect(output).toContain("Status:            UNVERIFIED")
    expect(output).toContain("Reason Code:       UNRESOLVED")
    expect(output).toContain("src/Vault.sol:15-25 (digest: sha256:abc123def456)")

    const jsonView = await executeViewCommand({ id: runId, json: true }, { store })
    expect(jsonView.exitCode).toBe(0)
    const parsedJson = JSON.parse(jsonView.output)
    expect(parsedJson.runId).toBe(runId)
    expect(parsedJson.verdict.validity).toBe("unverified")
    expect(parsedJson.verdict.verificationStatus).toBe("UNVERIFIED")
  })

  test("shows a Judge run that ended without a verdict, with its events and terminal payload", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const runId = "run-judge-no-verdict"
    store.seedRun(runId, "queued")
    const claimResult = await store.claim({ runId, workerId: "test-worker" })
    if (claimResult.kind !== "claimed") throw new Error("claim failed")
    const append = async (eventId: string, type: "stage.started" | "run.failed", payload: Record<string, unknown>) =>
      store.appendEvent({
        claim: claimResult.claim,
        expectedStateVersion: claimResult.stateVersion,
        event: { eventId, type, schemaVersion: 1, payload, payloadDigest: digestOf(payload), occurredAt: new Date(1000).toISOString() },
      })
    await append("evt-stage", "stage.started", { stage: "ingestion" })
    await append("evt-failed", "run.failed", { reason: "provider_permanent", message: "malformed function call" })

    const { exitCode, output } = await executeViewCommand({ id: runId }, { store })
    expect(exitCode).toBe(0)
    expect(output).toContain("Judge Run Inspection Record")
    expect(output).toContain("Judge Verdict:       (none)")
    expect(output).toContain("| run.failed |")
    expect(output).toContain("malformed function call")
    expect(JSON.parse((await executeViewCommand({ id: runId, json: true }, { store })).output).verdict).toBeNull()
  })
})
