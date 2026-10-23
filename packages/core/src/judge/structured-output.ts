// Adapted from OpenCode packages/opencode/src/session/prompt.ts (createStructuredOutputTool, STRUCTURED_OUTPUT_DESCRIPTION)
// @ 3f393d78bf (MIT License, Copyright (c) 2025 opencode). See NOTICE.
import {
  verdictSubmissionJsonSchema,
  type ModelToolCall,
  type ToolDefinition,
  type ToolRegistryPort,
} from "@harness/protocol"
import { loadPrompt } from "../prompts/index"

export const SubmitVerdictToolName = "submit_verdict"
export const SubmitVerificationToolName = "submit_verification"

const SubmissionToolNames: readonly string[] = [SubmitVerdictToolName, SubmitVerificationToolName]

const SubmissionRules = `IMPORTANT:
- Call this tool exactly once, at the end of your work, and no other tool in the same reply
- The arguments must be valid JSON matching the required schema
- Complete all necessary reading and probing BEFORE calling this tool
- The harness validates the submission; if it is rejected you are told why and may submit again`

/** The verification result submission; also the only tool a direction keeps once its step budget is used up. */
export const submitVerificationTool = (): ToolDefinition => ({
  name: SubmitVerificationToolName,
  description: `Submit the result of the current verification direction (forward: reachability; backward: reconstruction).\n\n${SubmissionRules}`,
  parameters: {
    type: "object",
    properties: {
      reachability: { type: "string", enum: ["reachable", "blocked", "incomplete"] },
      reconstruction: { type: "string", enum: ["reconstructed", "blocked", "incomplete"] },
      explanation: { type: "string" },
    },
    required: ["explanation"],
    additionalProperties: false,
  },
})

/** The submission tools, offered after the snapshot tools so the cached prefix of the read tools is unchanged. */
export const submissionTools = (): ToolDefinition[] => [
  submitVerificationTool(),
  {
    name: SubmitVerdictToolName,
    description: `Submit your final verdict in the verdict format from your instructions.\n\n${SubmissionRules}`,
    parameters: verdictSubmissionJsonSchema(),
  },
]

/** The instruction pinned after the system prompt; its digest is recorded in the run configuration (Rule R1). */
export const structuredOutputPrompt = () => loadPrompt("structured-output.v1")

/**
 * The run's registry with the submission tools. A submission is read by the step, never dispatched; should one reach
 * the registry anyway, it is an error result rather than a silent success.
 */
export const withSubmissionTools = (registry: ToolRegistryPort): ToolRegistryPort => {
  const definitions = [...registry.definitions(), ...submissionTools()]
  return {
    definitions: () => definitions,
    execute: (call, signal) =>
      SubmissionToolNames.includes(call.toolName)
        ? Promise.resolve({ content: `${call.toolName} is read by the harness and cannot be dispatched.`, isError: true })
        : registry.execute(call, signal),
  }
}

export const offersSubmission = (tools: readonly ToolDefinition[]) =>
  tools.some((tool) => tool.name === SubmitVerdictToolName)

/**
 * The reply a submission stands for: its arguments as JSON text, validated exactly like a text reply. Arguments the
 * provider could not parse are passed on raw, so validation reports them instead of a schema-valid empty object.
 */
export const submittedText = (calls: readonly ModelToolCall[]): string | undefined => {
  const submission = calls.find((call) => SubmissionToolNames.includes(call.name))
  if (submission === undefined) return undefined
  return submission.argumentsError === undefined ? JSON.stringify(submission.arguments) : (submission.rawArguments ?? "")
}
