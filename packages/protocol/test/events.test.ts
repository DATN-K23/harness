import { describe, expect, test } from "bun:test"
import {
  AbsolutePathRedactedPlaceholder,
  EventPayloadSchemas,
  EventTypes,
  RunStates,
  TerminalRunStates,
  TrajectoryEventSchema,
  type EventType,
} from "../src/events"
import { contextItem, digest, legacySnapshot, snapshot, verdict } from "./fixtures"

const blueprintTypes = [
  "run.accepted",
  "run.queued",
  "run.started",
  "context.allocated",
  "context.transformed",
  "provider.attempted",
  "provider.failed",
  "model.responded",
  "tool.requested",
  "tool.completed",
  "tool.failed",
  "security.blocked",
  "finding.discovered",
  "finding.validated",
  "verdict.validation_failed",
  "run.cancel_requested",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.budget_exhausted",
]

const additions = ["context.item_added", "context.compacted", "stage.started", "stage.finished", "step.started"]

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }

const telemetry = {
  tokenizer: "o200k_base",
  policyVersion: "v1",
  estimatedInputTokens: 100,
  estimatedSafetyTokens: 110,
  windowLimitTokens: 1000,
  outputReserveTokens: 100,
  tokensSaved: 0,
  budgetRemainingTokens: 900,
  contentDigest: digest("c"),
}

const payloads: Record<EventType, Record<string, unknown>> = {
  "run.accepted": {},
  "run.queued": {},
  "run.started": {
    snapshot: legacySnapshot(),
    snapshotDigest: digest("d"),
  },
  "context.allocated": { stepIndex: 1, telemetry },
  "context.transformed": {
    action: "masked",
    targetItemId: "item-1",
    tokensBefore: 500,
    tokensAfter: 12,
    replacementNote: "[read_file result hidden]",
  },
  "provider.attempted": {
    stepIndex: 1,
    attemptIndex: 0,
    profileId: "openai-responses-gpt-4o",
    usage,
    costUsd: 0.002,
    latencyMs: 420,
    errorCategory: "rate_limit",
    retryDecision: "retry",
    backoffMs: 2300,
  },
  "provider.failed": {},
  "model.responded": { stepIndex: 1, attemptIndex: 0, finishReason: "tool_calls", toolCallCount: 2 },
  "tool.requested": { callIndex: 0, callId: "call-1", toolName: "read_file", arguments: { path: "src/A.sol" } },
  "tool.completed": {
    callIndex: 0,
    callId: "call-1",
    toolName: "read_file",
    durationMs: 3,
    isTruncated: false,
    itemId: "item-4",
  },
  "tool.failed": { callIndex: 1, callId: "call-2", toolName: "grep", durationMs: 1, message: "pattern is invalid" },
  "security.blocked": { ruleId: "path-outside-snapshot", input: "../etc/passwd", toolName: "read_file" },
  "finding.discovered": {},
  "finding.validated": {},
  "verdict.validation_failed": {
    attempt: 1,
    issues: [{ reason: "VALID_REQUIRES_EVIDENCE", path: ["citesEvidence"] }],
  },
  "run.cancel_requested": {},
  "run.completed": { verdict: verdict() },
  "run.failed": { reason: "schema_repair_exhausted", message: "verdict repair attempts exhausted" },
  "run.cancelled": { reason: "cancelled_by_user", boundary: "before_provider_call" },
  "run.budget_exhausted": { reason: "max_steps", observedLimits: ["max_steps", "no_progress"] },
  "context.item_added": { item: contextItem() },
  "context.compacted": {
    replacedItemIds: ["item-2", "item-3"],
    summaryItem: contextItem({ id: "summary-1", type: "compaction_summary", content: "summary" }),
    usage: { ...usage, costUsd: 0.001 },
  },
  "stage.started": { stage: "ingestion" },
  "stage.finished": { stage: "ingestion", outcome: "ok", durationMs: 4 },
  "step.started": { stepIndex: 1, toolsDisabled: false },
}

const event = (overrides: Record<string, unknown> = {}) => ({
  eventId: "event-1",
  runId: "run-1",
  sequence: 1,
  type: "run.accepted",
  schemaVersion: 1,
  payload: {},
  payloadDigest: digest("e"),
  occurredAt: "2026-10-11T08:30:00.000Z",
  ...overrides,
})

const failure = (input: unknown) => {
  const result = TrajectoryEventSchema.safeParse(input)
  if (result.success) throw new Error("expected parsing to fail")
  return result.error.issues
}

describe("event vocabulary", () => {
  test("includes every blueprint type and the five TV1 additions, once each", () => {
    expect<string[]>([...EventTypes].sort()).toEqual([...blueprintTypes, ...additions].sort())
    expect(new Set(EventTypes).size).toBe(EventTypes.length)
  })

  test("has a payload schema for every type", () => {
    expect(Object.keys(EventPayloadSchemas).sort()).toEqual([...EventTypes].sort())
  })

  test("run states split into three non-terminal and four terminal", () => {
    expect([...RunStates]).toEqual([
      "accepted",
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
      "budget_exhausted",
    ])
    expect([...TerminalRunStates]).toEqual(["completed", "failed", "cancelled", "budget_exhausted"])
  })
})

describe("TrajectoryEventSchema envelope", () => {
  test("accepts a well-formed event", () => {
    expect(TrajectoryEventSchema.safeParse(event()).success).toBe(true)
  })

  test("rejects an event type outside the vocabulary", () => {
    const issues = failure(event({ type: "run.exploded" }))
    expect(issues[0].path).toEqual(["type"])
  })

  test("rejects occurredAt without the Z suffix or with an offset", () => {
    expect(failure(event({ occurredAt: "2026-10-11T08:30:00" }))[0].path).toEqual(["occurredAt"])
    expect(failure(event({ occurredAt: "2026-10-11T08:30:00+00:00" }))[0].path).toEqual(["occurredAt"])
    expect(failure(event({ occurredAt: "2026-10-11" }))[0].path).toEqual(["occurredAt"])
    expect(TrajectoryEventSchema.safeParse(event({ occurredAt: "2026-10-11T08:30:00Z" })).success).toBe(true)
  })

  test("sequence is an integer starting at 1", () => {
    expect(failure(event({ sequence: 0 }))[0].path).toEqual(["sequence"])
    expect(failure(event({ sequence: 1.5 }))[0].path).toEqual(["sequence"])
    expect(TrajectoryEventSchema.safeParse(event({ sequence: 42 })).success).toBe(true)
  })

  test("payloadDigest must be sha256 with 64 lowercase hex digits", () => {
    expect(failure(event({ payloadDigest: "abc" }))[0].path).toEqual(["payloadDigest"])
    expect(failure(event({ payloadDigest: digest("E") }))[0].path).toEqual(["payloadDigest"])
  })

  test("requires every envelope field", () => {
    const { schemaVersion: _omitted, ...rest } = event()
    expect(failure(rest)[0].path).toEqual(["schemaVersion"])
  })
})

describe("event payloads", () => {
  test.each(EventTypes.map((type) => [type]))("%s accepts its documented payload", (type) => {
    const result = TrajectoryEventSchema.safeParse(event({ type, payload: payloads[type] }))
    expect(result.error?.issues).toBeUndefined()
    expect(result.success).toBe(true)
  })

  test("a payload that violates its type schema is reported under the payload path", () => {
    const issues = failure(event({ type: "tool.requested", payload: { callIndex: 0, callId: "call-1" } }))
    expect(issues.map((issue) => issue.path)).toContainEqual(["payload", "toolName"])
    expect(issues.map((issue) => issue.path)).toContainEqual(["payload", "arguments"])
  })

  test("run.started must carry a valid snapshot and its digest", () => {
    const { snapshotDigest: _omitted, ...rest } = payloads["run.started"]
    expect(failure(event({ type: "run.started", payload: rest }))[0].path).toEqual(["payload", "snapshotDigest"])
    const broken = { ...payloads["run.started"], snapshot: { ...snapshot(), maxProbeRuns: -1 } }
    expect(failure(event({ type: "run.started", payload: broken }))[0].path).toEqual([
      "payload",
      "snapshot",
      "maxProbeRuns",
    ])
  })

  test("accepts old run.started snapshots without optional toolLimits", () => {
    const payload = { ...payloads["run.started"] }
    expect(TrajectoryEventSchema.safeParse(event({ type: "run.started", payload })).success).toBe(true)
  })

  test("run.started records optional provider profile and cost-budget enforcement", () => {
    const payload = {
      ...payloads["run.started"],
      costBudgetEnforced: false,
      providerProfile: {
        outputTokensField: "max_completion_tokens",
        inputCostPerMTok: 2,
        outputCostPerMTok: 8,
      },
    }
    expect(TrajectoryEventSchema.safeParse(event({ type: "run.started", payload })).success).toBe(true)
  })

  test("run.completed records output truncation without requiring a judge verdict", () => {
    expect(
      TrajectoryEventSchema.safeParse(
        event({ type: "run.completed", payload: { output: "partial answer", outputTruncated: true } }),
      ).success,
    ).toBe(true)
  })


  test("tool.requested can retain malformed raw arguments for crash recovery", () => {
    const payload = {
      ...payloads["tool.requested"],
      rawArguments: '{"path":',
      argumentsError: "Unexpected end of JSON input",
    }
    expect(TrajectoryEventSchema.safeParse(event({ type: "tool.requested", payload })).success).toBe(true)
  })

  test("tool.failed accepts the invalid_arguments failure kind", () => {
    const payload = {
      ...payloads["tool.failed"],
      failureKind: "invalid_arguments",
    }
    expect(TrajectoryEventSchema.safeParse(event({ type: "tool.failed", payload })).success).toBe(true)
    expect(
      TrajectoryEventSchema.safeParse(
        event({ type: "tool.failed", payload: { ...payload, failureKind: "invalid_provider_output" } }),
      ).success,
    ).toBe(false)
  })

  test("context.item_added carries the full context item", () => {
    const payload = { item: { ...contextItem(), type: "not_a_type" } }
    expect(failure(event({ type: "context.item_added", payload }))[0].path).toEqual(["payload", "item", "type"])
  })

  test("provider.attempted rejects an unknown retry decision and error category", () => {
    const base = payloads["provider.attempted"]
    const decision = failure(event({ type: "provider.attempted", payload: { ...base, retryDecision: "maybe" } }))
    expect(decision[0].path).toEqual(["payload", "retryDecision"])
    const category = failure(event({ type: "provider.attempted", payload: { ...base, errorCategory: "ghost" } }))
    expect(category[0].path).toEqual(["payload", "errorCategory"])
  })

  test("provider.attempted allows success without an error category", () => {
    const { errorCategory: _omitted, ...rest } = payloads["provider.attempted"]
    const payload = { ...rest, retryDecision: "none", backoffMs: 0 }
    expect(TrajectoryEventSchema.safeParse(event({ type: "provider.attempted", payload })).success).toBe(true)
  })


  test("provider.attempted preserves the attempt pricing status", () => {
    const base = payloads["provider.attempted"]
    const payload = { ...base, usage: { ...usage, pricing: "unpriced" } }
    expect(TrajectoryEventSchema.safeParse(event({ type: "provider.attempted", payload })).success).toBe(true)
  })

  test("provider.attempted purpose defaults to reasoning for older events and rejects an unknown purpose", () => {
    const base = payloads["provider.attempted"]
    expect(EventPayloadSchemas["provider.attempted"].parse(base).purpose).toBe("reasoning")
    const unknown = failure(event({ type: "provider.attempted", payload: { ...base, purpose: "chat" } }))
    expect(unknown[0].path).toEqual(["payload", "purpose"])
  })

  test("run.budget_exhausted uses blueprint budget reasons, not stop-reason names", () => {
    const payload = { reason: "max_steps_exceeded", observedLimits: ["max_steps"] }
    expect(failure(event({ type: "run.budget_exhausted", payload }))[0].path).toEqual(["payload", "reason"])
  })

  test("verdict.validation_failed carries paths only, never messages", () => {
    const payload = {
      attempt: 1,
      issues: [{ reason: "SCHEMA_VIOLATION", path: ["reasoning"], message: "model text leaked here" }],
    }
    expect(failure(event({ type: "verdict.validation_failed", payload }))[0].path).toEqual(["payload", "issues", 0])
  })

  test("verdict.validation_failed accepts the harness evidence reason with an index path", () => {
    const payload = { attempt: 2, issues: [{ reason: "EVIDENCE_UNRESOLVED", path: ["citesEvidence", 0, "filePath"] }] }
    expect(TrajectoryEventSchema.safeParse(event({ type: "verdict.validation_failed", payload })).success).toBe(true)
  })

  test("context.allocated telemetry carries the content digest", () => {
    const { contentDigest: _omitted, ...rest } = telemetry
    const payload = { stepIndex: 1, telemetry: rest }
    expect(failure(event({ type: "context.allocated", payload })).some((issue) =>
      JSON.stringify(issue.path) === JSON.stringify(["payload", "telemetry", "contentDigest"]),
    )).toBe(true)
  })

  test("legacy context allocation payloads remain valid and additive request telemetry is validated", () => {
    expect(EventPayloadSchemas["context.allocated"].safeParse({ stepIndex: 1, telemetry }).success).toBe(true)
    const extended = {
      stepIndex: 1,
      telemetry: {
        ...telemetry,
        requestDigest: `sha256:${"a".repeat(64)}`,
        estimatedOutputTokens: 4096,
        actualUsage: null,
        usageDelta: null,
      },
    }
    expect(EventPayloadSchemas["context.allocated"].safeParse(extended).success).toBe(true)
    expect(EventPayloadSchemas["context.allocated"].safeParse({
      ...extended,
      telemetry: { ...extended.telemetry, estimatedInputTokens: 1.5 },
    }).success).toBe(false)
    expect(EventPayloadSchemas["context.allocated"].safeParse({
      ...extended,
      telemetry: { ...extended.telemetry, requestDigest: "prompt/tool raw text" },
    }).success).toBe(false)
  })
})

describe("payload content rules", () => {
  const systemPayload = (key: string) => ({ nested: [{ [key]: "x" }] })

  test("rejects ground-truth, scorer and credential keys at any depth of a system-authored payload", () => {
    const keys = ["groundTruth", "label", "adjudicationReport", "score", "scorerMetadata", "hostPath", "apiKey"]
    keys.forEach((key) => {
      const issues = failure(event({ type: "run.accepted", payload: systemPayload(key) }))
      expect(issues[0].path).toEqual(["payload", "nested", 0, key])
    })
  })

  test("normalizes key spelling before matching (case, hyphen, underscore)", () => {
    const keys = ["api_key", "API-KEY", "Ground-Truth", "groundTruth", "ground_truth", "SCORER_METADATA", "Host-Path"]
    keys.forEach((key) => {
      expect(failure(event({ type: "run.accepted", payload: systemPayload(key) }))[0].path).toEqual([
        "payload",
        "nested",
        0,
        key,
      ])
    })
  })

  test("rejects the credential key family in a system-authored payload", () => {
    const keys = [
      "token",
      "accessToken",
      "access_token",
      "refreshToken",
      "authorization",
      "bearer",
      "password",
      "privateKey",
      "private_key",
      "secret",
    ]
    keys.forEach((key) => {
      expect(failure(event({ type: "run.accepted", payload: systemPayload(key) }))[0].path).toEqual([
        "payload",
        "nested",
        0,
        key,
      ])
    })
  })

  test("does not mistake ordinary keys for forbidden ones", () => {
    const payload = { nested: { path: "src/A.sol", pattern: "labelled", totalTokens: 3, promptTokens: 1 } }
    expect(TrajectoryEventSchema.safeParse(event({ type: "run.accepted", payload })).success).toBe(true)
  })

  test("tool.requested arguments are model-supplied data and stay recordable with any key names", () => {
    const args = { label: "a", score: 3, nested: [{ token: "t", groundTruth: "g", api_key: "k" }] }
    const payload = { ...payloads["tool.requested"], arguments: args }
    expect(TrajectoryEventSchema.safeParse(event({ type: "tool.requested", payload })).success).toBe(true)
  })

  test("the model-supplied exemption covers only tool.requested arguments, not its system fields", () => {
    const payload = { ...payloads["tool.requested"], label: "x" }
    expect(failure(event({ type: "tool.requested", payload }))[0].path).toEqual(["payload", "label"])
  })
})

describe("security.blocked input", () => {
  const blocked = (input: string) => event({ type: "security.blocked", payload: { ruleId: "r", input } })

  test("accepts relative inputs, including a recorded traversal attempt", () => {
    expect(TrajectoryEventSchema.safeParse(blocked("src/A.sol")).success).toBe(true)
    expect(TrajectoryEventSchema.safeParse(blocked("../../etc/passwd")).success).toBe(true)
    expect(TrajectoryEventSchema.safeParse(blocked("..\\secrets.txt")).success).toBe(true)
  })

  test("accepts the absolute-path-redacted placeholder", () => {
    expect(AbsolutePathRedactedPlaceholder).toBe("<absolute path redacted>")
    expect(TrajectoryEventSchema.safeParse(blocked(AbsolutePathRedactedPlaceholder)).success).toBe(true)
  })

  test.each([
    ["posix absolute", "/home/dev/project/src/A.sol"],
    ["root slash", "/"],
    ["leading backslash", "\\Users\\dev\\A.sol"],
    ["drive letter with backslash", "C:\\Users\\dev\\A.sol"],
    ["drive letter with slash", "d:/work/A.sol"],
    ["bare drive letter", "C:"],
    ["UNC", "\\\\server\\share\\A.sol"],
    ["file url", "file:///home/dev/A.sol"],
    ["upper-case file url", "FILE://host/A.sol"],
  ])("rejects an absolute host path (%s)", (_name, input) => {
    expect(failure(blocked(input))[0].path).toEqual(["payload", "input"])
  })
})
