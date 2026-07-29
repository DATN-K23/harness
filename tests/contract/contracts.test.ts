import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  FindingSchema,
  JudgeInputSchema,
  JudgeVerdictSchema,
  ModelEventSchema,
  ProviderRequestSchema,
  RunConfigSnapshotSchema,
  RunEventSchema,
  RunSchema,
  StopReasonSchema,
  ToolCallSchema,
  ToolDefinitionSchema,
  ToolErrorSchema,
  ToolResultSchema,
  VerificationResultSchema,
  toDraft7JsonSchema,
} from "../../packages/contracts/src/index.js";

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/slice1/", import.meta.url),
);
const timestamp = "2026-07-29T01:00:00.000Z";
const hash = `sha256:${"0".repeat(64)}`;

async function readFixture(relativePath: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve(fixtureRoot, relativePath), "utf8"),
  ) as unknown;
}

function createConfigSnapshot() {
  return {
    schema_version: 1,
    mode: "judge",
    model: {
      provider: "fake",
      model: "slice1-scripted",
    },
    prompt_manifest: {
      schema_version: 1,
      components: [
        {
          id: "harness-policy",
          version: "1.0.0",
          content_hash: hash,
        },
      ],
      aggregate_hash: hash,
    },
    enabled_tool_ids: ["read_file"],
    enabled_skill_ids: [],
    feature_flags: {
      tools: true,
      skills: false,
      context_compaction: false,
      session_note: false,
      long_term_memory: false,
      verification: false,
      retry: false,
      no_progress_detection: false,
    },
    limits: {
      max_steps: 4,
      max_input_tokens: 10_000,
      max_output_tokens: 2_000,
      max_cost_usd: 0,
      wall_clock_timeout_ms: 30_000,
    },
    pricing_catalog_hash: null,
    created_at: timestamp,
  };
}

function createVerdict(classification: "valid" | "invalid" | "uncertain") {
  return {
    classification,
    severity: classification === "valid" ? "high" : "unknown",
    reasoning_summary: `Representative ${classification} verdict.`,
    evidence_refs: ["contracts/Vault.sol:28"],
  };
}

function createRunEvent() {
  return {
    event_id: "event_001",
    run_id: "run_001",
    sequence: 1,
    occurred_at: timestamp,
    schema_version: 1,
    type: "run_created",
    payload: {
      status: "queued",
      config_snapshot: createConfigSnapshot(),
    },
  };
}

function createJsonSchemaValidator() {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats.default(ajv);
  return ajv;
}

describe("contracts schema v0", () => {
  it("parses the Slice 1 findings and verdicts", async () => {
    const validFinding = await readFixture("inputs/valid-reentrancy.json");
    const invalidFinding = await readFixture(
      "inputs/invalid-access-control.json",
    );
    const validVerdict = await readFixture(
      "expected/valid-reentrancy-verdict.json",
    );
    const invalidVerdict = await readFixture(
      "expected/invalid-access-control-verdict.json",
    );

    expect(FindingSchema.parse(validFinding).finding_id).toBe(
      "finding_slice1_valid_reentrancy",
    );
    expect(FindingSchema.parse(invalidFinding).finding_id).toBe(
      "finding_slice1_invalid_access_control",
    );
    expect(JudgeVerdictSchema.parse(validVerdict).classification).toBe("valid");
    expect(JudgeVerdictSchema.parse(invalidVerdict).classification).toBe(
      "invalid",
    );
  });

  it("rejects missing required fields and invalid enums", async () => {
    const finding = (await readFixture(
      "inputs/valid-reentrancy.json",
    )) as Record<string, unknown>;
    const withoutTitle = { ...finding };
    delete withoutTitle["title"];

    expect(FindingSchema.safeParse(withoutTitle).success).toBe(false);
    expect(
      FindingSchema.safeParse({ ...finding, severity: "blocker" }).success,
    ).toBe(false);
    expect(
      JudgeVerdictSchema.safeParse({
        ...createVerdict("valid"),
        classification: "probably_valid",
      }).success,
    ).toBe(false);
  });

  it("round-trips representative boundary values without data loss", async () => {
    const finding = FindingSchema.parse(
      await readFixture("inputs/valid-reentrancy.json"),
    );
    const configSnapshot = RunConfigSnapshotSchema.parse(
      createConfigSnapshot(),
    );
    const run = RunSchema.parse({
      schema_version: 1,
      run_id: "run_001",
      parent_run_id: null,
      finding_id: finding.finding_id,
      mode: "judge",
      status: "queued",
      config_snapshot: configSnapshot,
      created_at: timestamp,
      started_at: null,
      completed_at: null,
    });
    const judgeInput = JudgeInputSchema.parse({
      run_id: run.run_id,
      finding,
      workspace: {
        source_ref: "fixture:slice1/source",
        source_hash: hash,
      },
    });
    const values = [
      [RunSchema, run],
      [JudgeInputSchema, judgeInput],
      [RunEventSchema, createRunEvent()],
      [
        VerificationResultSchema,
        {
          schema_version: 1,
          verification_id: "verification_001",
          finding_id: finding.finding_id,
          status: "unverified",
          reason: "environment_unavailable",
          summary: "Verification is not implemented in Slice 1.",
          evidence_refs: [],
          exit_code: null,
          started_at: timestamp,
          completed_at: timestamp,
        },
      ],
    ] as const;

    for (const [schema, value] of values) {
      const parsed = schema.parse(value);
      const decoded = JSON.parse(JSON.stringify(parsed)) as unknown;

      expect(schema.parse(decoded)).toEqual(parsed);
    }
  });

  it("accepts legacy snapshots and additive WP5 policy fields", () => {
    const legacy = createConfigSnapshot();
    expect(RunConfigSnapshotSchema.safeParse(legacy).success).toBe(true);

    expect(
      RunConfigSnapshotSchema.safeParse({
        ...legacy,
        recovery_limits: {
          max_repair_attempts: 2,
        },
        policy: {
          workspace: {
            read_only: true,
            relative_paths_only: true,
            deny_path_traversal: true,
            deny_symlink_escape: true,
          },
          tools: {
            allowed_capabilities: ["read_workspace"],
            network_allowed: false,
          },
        },
      }).success,
    ).toBe(true);
  });

  it("defines serializable provider, model-event and tool contracts", () => {
    const toolDefinition = ToolDefinitionSchema.parse({
      id: "read_file",
      version: "1.0.0",
      description: "Read a bounded range of lines from the source workspace.",
      capability: "read_workspace",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    });
    const providerRequest = ProviderRequestSchema.parse({
      provider_attempt_id: "provider_attempt_001",
      run_id: "run_001",
      turn_id: "turn_001",
      model: {
        provider: "fake",
        model: "slice1-scripted",
      },
      system_context: "Judge the supplied finding.",
      messages: [
        {
          message_id: "message_001",
          role: "user",
          content: "Inspect the finding.",
        },
      ],
      visible_tools: [toolDefinition],
      structured_output_schema: toDraft7JsonSchema(JudgeVerdictSchema),
      generation: {
        max_output_tokens: 2_000,
        temperature: null,
      },
      provider_options: {},
    });
    const modelEvent = ModelEventSchema.parse({
      provider_attempt_id: "provider_attempt_001",
      type: "tool_call",
      provider_tool_call_id: "provider_call_001",
      tool_id: "read_file",
      input: {
        path: "contracts/Vault.sol",
      },
    });
    const toolCall = ToolCallSchema.parse({
      tool_call_id: "tool_call_001",
      run_id: "run_001",
      turn_id: "turn_001",
      tool_id: "read_file",
      tool_version: "1.0.0",
      raw_input: {
        path: "contracts/Vault.sol",
      },
      requested_at: timestamp,
      status: "completed",
      validated_input: {
        path: "contracts/Vault.sol",
      },
      started_at: timestamp,
      settled_at: timestamp,
      result: {
        title: "contracts/Vault.sol",
        model_output: "28: (bool success, ) = msg.sender.call...",
        artifact_refs: [],
        metadata: {
          start_line: 28,
          end_line: 28,
        },
      },
    });

    expect(providerRequest.visible_tools).toEqual([toolDefinition]);
    expect(modelEvent.type).toBe("tool_call");
    expect(toolCall.status).toBe("completed");
  });

  it("keeps Zod and native JSON Schema semantics aligned", () => {
    const ajv = createJsonSchemaValidator();
    const cases = [
      {
        schema: JudgeVerdictSchema,
        valid: createVerdict("valid"),
        invalid: {
          ...createVerdict("valid"),
          classification: "probably_valid",
        },
      },
      {
        schema: RunEventSchema,
        valid: createRunEvent(),
        invalid: {
          ...createRunEvent(),
          sequence: 0,
        },
      },
    ];

    for (const testCase of cases) {
      const validate = ajv.compile(toDraft7JsonSchema(testCase.schema));

      expect(testCase.schema.safeParse(testCase.valid).success).toBe(true);
      expect(validate(testCase.valid)).toBe(true);
      expect(testCase.schema.safeParse(testCase.invalid).success).toBe(false);
      expect(validate(testCase.invalid)).toBe(false);
    }
  });

  it("converts every public WP2 boundary schema to valid JSON Schema", () => {
    const ajv = createJsonSchemaValidator();
    const schemas = [
      FindingSchema,
      JudgeInputSchema,
      JudgeVerdictSchema,
      ModelEventSchema,
      ProviderRequestSchema,
      RunConfigSnapshotSchema,
      RunEventSchema,
      RunSchema,
      StopReasonSchema,
      ToolCallSchema,
      ToolDefinitionSchema,
      ToolErrorSchema,
      ToolResultSchema,
      VerificationResultSchema,
    ];

    for (const schema of schemas) {
      expect(() => ajv.compile(toDraft7JsonSchema(schema))).not.toThrow();
    }
  });

  it("rejects a payload belonging to another RunEvent type", () => {
    const event = createRunEvent();
    const mismatched = {
      ...event,
      type: "run_started",
    };

    expect(RunEventSchema.safeParse(mismatched).success).toBe(false);
  });

  it.each(["valid", "invalid", "uncertain"] as const)(
    "preserves the %s Judge classification",
    (classification) => {
      const verdict = JudgeVerdictSchema.parse(createVerdict(classification));

      expect(verdict.classification).toBe(classification);
    },
  );
});
