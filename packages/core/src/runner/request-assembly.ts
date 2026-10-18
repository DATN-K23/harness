// Adapted from OpenCode packages/core/src/session/runner/to-llm-message.ts @ 3f393d78bf (MIT License). See NOTICE.
import {
  validateAttemptRequestTools,
  type ContextItem,
  type ModelAttemptRequest,
  type ToolRegistryPort,
} from "@harness/protocol"
import { createIdGenerator, systemIdSources } from "../util/id"
import { truncateText } from "../util/truncate"

const defaultMaxSourceEntries = 100

export interface AssembleRequestInput {
  runId: string
  stepIndex: number
  attemptIndex: number
  profileId: string
  prompt: string
  snapshotId: string
  availableFiles?: readonly string[]
  registry: ToolRegistryPort
  historyItems?: readonly ContextItem[]
  maxToolCalls?: number
  maxOutputTokens?: number
  maxSourceEntries?: number
  toolsDisabled?: boolean
  temperature?: number
  seed?: number
}

const sanitizeText = (text: string): string => {
  return text
    // Redact absolute host paths
    .replace(/(?:[A-Za-z]:[\\/]|(?:\/[a-zA-Z0-9_.-]+)+)[\\/][a-zA-Z0-9_.-]+/g, "<absolute path redacted>")
    // Strip ground truth labels or metadata
    .replace(/GroundTruthLabel\w*:[^\n]*/gi, "<ground truth redacted>")
    .replace(/adjudication_report[^\n]*/gi, "<adjudication redacted>")
}

/**
 * Assembles the minimal per-turn model request for multi-turn execution.
 * Enforces ground-truth isolation, bounds source snapshot file list,
 * attaches authorized tool definitions, and attaches prior history.
 */
export function assembleTurnRequest(input: AssembleRequestInput): ModelAttemptRequest {
  const idGen = createIdGenerator(systemIdSources)
  const maxEntries = input.maxSourceEntries ?? defaultMaxSourceEntries
  const rawFileList = (input.availableFiles ?? []).map((f) => `- ${sanitizeText(f)}`).join("\n")
  const truncatedFiles = truncateText(rawFileList, {
    maxLines: maxEntries,
    direction: "head",
    customHint: "Use glob or list_dir to discover more files in the snapshot.",
  })

  const sourceListContent = [
    `You are an autonomous AI smart-contract security auditor running inside a sandboxed evaluation harness.`,
    `You are analyzing an immutable source snapshot with ID: "${input.snapshotId}".`,
    `Available source files in snapshot:`,
    truncatedFiles.content,
    `\nUse the provided tools to inspect contracts and verify potential vulnerabilities before answering.`,
  ].filter(Boolean).join("\n")

  const systemPromptItem: ContextItem = {
    id: idGen.next("ctx_sys_"),
    turn: 1,
    type: "system_prompt",
    isPinned: true,
    content: sourceListContent,
  }

  const promptItem: ContextItem = {
    id: idGen.next("ctx_usr_"),
    turn: 1,
    type: "candidate_finding",
    isPinned: true,
    content: sanitizeText(input.prompt),
  }

  const history = input.historyItems ?? []
  const tools = input.toolsDisabled ? undefined : input.registry.definitions()
  if (tools !== undefined) {
    validateAttemptRequestTools(tools)
  }

  return {
    runId: input.runId,
    stepIndex: input.stepIndex,
    attemptIndex: input.attemptIndex,
    profileId: input.profileId,
    items: [systemPromptItem, promptItem, ...history],
    ...(tools ? { tools } : {}),
    ...(input.maxToolCalls !== undefined ? { maxToolCalls: input.maxToolCalls } : {}),
    ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
    ...(input.toolsDisabled !== undefined ? { toolsDisabled: input.toolsDisabled } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  }
}
