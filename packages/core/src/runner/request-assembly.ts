// Adapted from OpenCode packages/core/src/session/runner/to-llm-message.ts @ 3f393d78bf (MIT License). See NOTICE.
import {
  validateAttemptRequestTools,
  type ContextItem,
  type ModelAttemptRequest,
  type ToolRegistryPort,
} from "@harness/protocol"
import { createIdGenerator, systemIdSources } from "../util/id"
import { sanitizeSourceContent, sanitizeSystemText } from "../util/sanitize"
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
  skippedFiles?: readonly { path: string; reason: string }[]
  registry: ToolRegistryPort
  historyItems?: readonly ContextItem[]
  maxToolCalls?: number
  maxOutputTokens?: number
  maxSourceEntries?: number
  toolsDisabled?: boolean
  temperature?: number
  seed?: number
  secrets?: readonly string[]
}

const sanitizeHistoryItem = (item: ContextItem, secrets: readonly string[]): ContextItem => {
  const sanitize = item.type === "tool_result" && item.toolMeta?.isError !== true
    ? sanitizeSourceContent
    : sanitizeSystemText
  return {
    ...item,
    content: sanitize(item.content, secrets),
    ...(item.toolMeta?.filePath !== undefined
      ? { toolMeta: { ...item.toolMeta, filePath: sanitizeSystemText(item.toolMeta.filePath, secrets) } }
      : {}),
  }
}

/**
 * Assembles the minimal per-turn model request for multi-turn execution.
 * Enforces ground-truth isolation, bounds source snapshot file list,
 * attaches authorized tool definitions, and attaches prior history.
 */
export function assembleTurnRequest(input: AssembleRequestInput): ModelAttemptRequest {
  const idGen = createIdGenerator(systemIdSources)
  const maxEntries = input.maxSourceEntries ?? defaultMaxSourceEntries
  const secrets = input.secrets ?? []
  const rawFileList = (input.availableFiles ?? []).map((file) => `- ${sanitizeSystemText(file, secrets)}`).join("\n")
  const truncatedFiles = truncateText(rawFileList, {
    maxLines: maxEntries,
    direction: "head",
    customHint: "Use glob or list_dir to discover more files in the snapshot.",
  })
  const unreadableFiles = (input.skippedFiles ?? []).filter(
    (file) => file.reason === "too_large" || file.reason === "binary",
  )
  const unreadableInfo = unreadableFiles.length === 0
    ? ""
    : [
        `Files present but unreadable (${unreadableFiles.length} total; showing up to 20):`,
        ...unreadableFiles.slice(0, 20).map((file) => `- ${sanitizeSystemText(file.path, secrets)} (${file.reason})`),
      ].join("\n")

  const sourceListContent = sanitizeSystemText([
    `You are an autonomous AI smart-contract security auditor running inside a sandboxed evaluation harness.`,
    `You are analyzing an immutable source snapshot with ID: "${input.snapshotId}".`,
    `Available source files in snapshot:`,
    truncatedFiles.content,
    unreadableInfo,
    `\nUse the provided tools to inspect contracts and verify potential vulnerabilities before answering.`,
  ].filter(Boolean).join("\n"), secrets)

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
    content: sanitizeSystemText(input.prompt, secrets),
  }

  const history = (input.historyItems ?? []).map((item) => sanitizeHistoryItem(item, secrets))
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
