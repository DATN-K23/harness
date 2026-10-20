import type {
  BceSlice,
  CandidateFinding,
  DeconstructedClaim,
  ContextItem,
  SandboxPort,
  SanitizerPort,
  SanitizerResult,
  StageInput,
  ToolCall,
  ToolDefinition,
  ToolExecutionResult,
  ToolRegistryPort,
} from "@harness/protocol"
import { NextStepMarker, describeArguments } from "../step/parallel-tool-dispatcher"
import type { IdGenerator } from "../util/id"

/**
 * Tier 1: the submitter's PoC asserts something, and the model judges whether the assertions prove a violation.
 * Tier 2: it asserts nothing, and the model may measure state changes with the loop-owned `run_state_probe` tool.
 */
export type AdjudicationTier = 1 | 2

export type SanitizedPoc = Extract<SanitizerResult, { kind: "ok" }>

export const RunStateProbeToolName = "run_state_probe"

const MaxFailedTraceChars = 2_000

export const selectTier = (sanitized: Pick<SanitizedPoc, "hasSubmitterAssertions">): AdjudicationTier =>
  sanitized.hasSubmitterAssertions ? 1 : 2

/** Probe runs used in this run. One object per run, owned by the runner (restored from history on recovery). */
export interface ProbeCounter {
  used: number
}

export const createProbeCounter = (used = 0): ProbeCounter => ({ used })

export interface StateProbeOptions {
  sanitized: SanitizedPoc
  claim?: DeconstructedClaim
  stage: StageInput
  sanitizer: SanitizerPort
  sandbox: SandboxPort
  maxProbeRuns: number
  counter: ProbeCounter
  evidence?: Map<string, { before: string; after: string }>
}

export interface StateProbe {
  definition: ToolDefinition
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolExecutionResult>
  evidence?: Map<string, { before: string; after: string }>
}

const failure = (message: string, args: Record<string, unknown>, nextStep: string): ToolExecutionResult => ({
  content: `${message}\nArguments: ${describeArguments(args)}\n${NextStepMarker} ${nextStep}`,
  isError: true,
})

const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ")

const isVariableList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length === 1 &&
  value.every((entry) => typeof entry === "string" && entry.trim() !== "")

/**
 * The Tier 2 probe tool, or `undefined` in Tier 1 or when the run allows no probe runs. Each execution injects
 * probes through the sanitizer port and re-runs the PoC through the sandbox port; it is not a model attempt. The
 * limit is checked and reserved before the first await, so concurrent calls from one response cannot exceed it.
 */
export const stateProbeFor = (options: StateProbeOptions): StateProbe | undefined => {
  if (selectTier(options.sanitized) === 1 || options.maxProbeRuns <= 0 || options.claim === undefined) return undefined
  const { counter, maxProbeRuns } = options
  const evidence = options.evidence ?? new Map<string, { before: string; after: string }>()
  return {
    definition: {
      name: RunStateProbeToolName,
      description: `Inject state probes for the named state variables into the submitted PoC, re-run it in the sandbox and return each variable's value before and after the exploit (post minus pre). At most ${maxProbeRuns} runs per adjudication.`,
      parameters: {
        type: "object",
        properties: { stateVariables: { type: "array", items: { type: "string" } } },
        required: ["stateVariables"],
        additionalProperties: false,
      },
    },
    execute: async (args, signal) => {
      const { stateVariables } = args
      if (!isVariableList(stateVariables))
        return failure(
          "Invalid arguments for run_state_probe: stateVariables must contain exactly one state variable expression.",
          args,
          'call run_state_probe with {"stateVariables": ["totalSupply"]}.',
        )
      const target = stateVariables[0]!
      if (options.claim === undefined || (!options.claim.claimedState.includes(target) && !options.claim.claimedImpact.includes(target)))
        return failure("Invalid target for run_state_probe: the expression is not present in the deconstructed claim.", args, "probe only an exact state expression named in the claim.")
      if (counter.used >= maxProbeRuns)
        return failure(
          `run_state_probe was not run: the limit of ${maxProbeRuns} state probe runs for this adjudication is reached.`,
          args,
          "decide from the state deltas already measured and reply with your final JSON verdict.",
        )
      counter.used += 1
      const run = counter.used
      const { probedTestFile } = await options.sanitizer.injectStateProbes(
        options.sanitized.stitchedTestFile,
        stateVariables,
        signal,
      )
      const probe = await options.sandbox.runStateProbe({ ...options.stage, probedTestFile }, signal)
      evidence.clear()
      if (probe.exitCode !== 0) {
        const trace =
          probe.trace.length > MaxFailedTraceChars ? `...${probe.trace.slice(-MaxFailedTraceChars)}` : probe.trace
        return failure(
          `State probe run ${run} of ${maxProbeRuns} failed: the probed PoC exited with code ${probe.exitCode}, so no state delta was measured.\nTrace tail:\n${trace}`,
          args,
          "probe fewer or different state variables, or decide from the evidence already gathered.",
        )
      }
      for (const delta of probe.stateDeltas) evidence.set(delta.variable, { before: delta.before, after: delta.after })
      const rows = probe.stateDeltas.map(
        (delta) => `| ${cell(delta.variable)} | ${cell(delta.before)} | ${cell(delta.after)} |`,
      )
      const table =
        rows.length === 0
          ? "The probe reported no state values."
          : ["| variable | before | after |", "| --- | --- | --- |", ...rows].join("\n")
      return {
        content: `State probe run ${run} of ${maxProbeRuns} (exit code 0). State delta, post minus pre:\n${table}`,
        isError: false,
      }
    },
    evidence,
  }
}

/** The run's tool registry: the snapshot tools, plus `run_state_probe` when a Tier 2 probe is given. */
export const composeTools = (registry: ToolRegistryPort, probe?: StateProbe): ToolRegistryPort => {
  if (probe === undefined) return registry
  return {
    definitions: () => [...registry.definitions(), probe.definition],
    execute: (call: ToolCall, signal?: AbortSignal) =>
      call.toolName === probe.definition.name ? probe.execute(call.arguments, signal) : registry.execute(call, signal),
  }
}

export interface InitialContextInput {
  runId: string
  snapshotId: string
  finding: CandidateFinding
  pocCode: string
  claim?: DeconstructedClaim
  bceSlices: readonly BceSlice[]
  tier: AdjudicationTier
  maxProbeRuns: number
  /** The Judge system prompt, which also states the verdict format. */
  systemPrompt: string
  /** Definitions of the composed registry, in its order. */
  tools: readonly ToolDefinition[]
  /** Verdict schema text the model sees after the tool descriptions, when it is not part of the system prompt. */
  verdictSchema?: string
  /** The execution trace after the security filter and `shapeToolResult`. */
  shapedTrace: string
  ids: IdGenerator
}

const tierLine = (tier: AdjudicationTier, maxProbeRuns: number) =>
  tier === 1
    ? "tier: 1 (the PoC contains assertions: judge whether they prove an unauthorized invariant violation)"
    : `tier: 2 (the PoC has no assertions: measure the state change with ${RunStateProbeToolName}, at most ${maxProbeRuns} runs)`

/**
 * The initial context in the seven-layer cache order of design 3.4. Layer 1 (system prompt, tool descriptions,
 * verdict schema, then the case header) is a fixed prefix for the whole run; layers 2 and 3 (finding, PoC, BCE
 * slices) are pinned; layers 4 to 6 (compaction summary, history, session note) do not exist yet; layer 7 is the
 * shaped execution trace. Every initial item is pinned, so the context engine never masks or compacts it.
 */
export const buildInitialContext = (input: InitialContextInput): ContextItem[] => {
  const pinned = (type: ContextItem["type"], content: string): ContextItem => ({
    id: input.ids.next("itm_"),
    turn: 0,
    type,
    isPinned: true,
    content,
  })
  const header = [
    "Case header",
    `runId: ${input.runId}`,
    `findingId: ${input.finding.findingId}`,
    `snapshotId: ${input.snapshotId}`,
    tierLine(input.tier, input.maxProbeRuns),
  ].join("\n")
  return [
    pinned("system_prompt", input.systemPrompt),
    ...input.tools.map((tool) =>
      pinned(
        "tool_description",
        `${tool.name}: ${tool.description}\nParameters (JSON Schema): ${JSON.stringify(tool.parameters)}`,
      ),
    ),
    ...(input.verdictSchema === undefined ? [] : [pinned("system_prompt", input.verdictSchema)]),
    pinned("system_prompt", header),
    pinned("candidate_finding", input.finding.reportMarkdown),
    ...(input.pocCode === "" ? [] : [pinned("submitter_poc", input.pocCode)]),
    ...(input.claim === undefined ? [] : [pinned("candidate_finding", `Claim decomposition\n${JSON.stringify(input.claim)}`)]),
    ...input.bceSlices.map((slice) =>
      pinned(
        "bce_sliced_ast",
        `${slice.filePath}${slice.lineRange === undefined ? "" : ` (lines ${slice.lineRange[0]}-${slice.lineRange[1]})`}\n${slice.content}`,
      ),
    ),
    pinned("execution_trace", input.shapedTrace),
  ]
}
