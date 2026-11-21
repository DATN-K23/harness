// Adapted from OpenCode packages/llm/src/protocols/openai-chat.ts and packages/core/src/session/runner/to-llm-message.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ContextItem } from "@harness/protocol"
import type OpenAI from "openai"

export class HistoryLoweringError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HistoryLoweringError"
  }
}

const lowerSimpleItem = (item: ContextItem): OpenAI.Chat.ChatCompletionMessageParam => {
  switch (item.type) {
    case "system_prompt":
    case "tool_description":
      return { role: "system", content: item.content }
    // A summary replaces history mid-run, and Gemini filters mid-run system messages, so it goes as a user message.
    case "compaction_summary":
      return { role: "user", content: item.content }
    case "assistant_reasoning":
      return { role: "assistant", content: item.content }
    case "candidate_finding":
    case "submitter_poc":
    case "execution_trace":
    case "session_note":
    default:
      return { role: "user", content: item.content }
  }
}

// The Judge stores `{name, arguments}`; replaying that envelope as arguments makes Gemini emit malformed calls.
const requestArguments = (item: ContextItem): string => {
  try {
    const parsed: unknown = JSON.parse(item.content)
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const envelope = parsed as Record<string, unknown>
      if (Object.keys(envelope).length === 2 && envelope.name === item.toolMeta?.toolName && "arguments" in envelope)
        return JSON.stringify(envelope.arguments)
    }
  } catch {}
  return item.content
}

/**
 * One system message, then the conversation: the leading system messages are joined, and a system message after the
 * conversation started goes as a user message. 9router's Codex route keeps only the first system message (measured
 * 2026-11-21) and Gemini filters mid-run ones, so a later instruction (a verification direction, a repair request)
 * would otherwise never reach the model.
 */
const withOneSystemMessage = (
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] => {
  const firstTurn = messages.findIndex((message) => message.role !== "system")
  const leading = messages.slice(0, firstTurn === -1 ? messages.length : firstTurn)
  const rest = messages
    .slice(leading.length)
    .map((message) => (message.role === "system" ? { role: "user" as const, content: message.content } : message))
  if (leading.length === 0) return rest
  return [{ role: "system", content: leading.map((message) => message.content).join("\n\n") }, ...rest]
}

/** Groups stored context by turn and reconstructs each assistant tool-call message faithfully. */
export function convertToChatMessages(items: readonly ContextItem[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const turns = new Map<number, ContextItem[]>()
  for (const item of items) {
    const turn = turns.get(item.turn) ?? []
    turn.push(item)
    turns.set(item.turn, turn)
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  const orderedTurns = [...turns.entries()].sort(([left], [right]) => left - right)

  for (const [, turnItems] of orderedTurns) {
    const requests = turnItems.filter((item) => item.type === "tool_request")
    const requestIds = new Set<string>()

    for (const request of requests) {
      const callId = request.toolMeta?.callId
      if (!callId || requestIds.has(callId)) {
        throw new HistoryLoweringError("Tool history contains an invalid request call ID.")
      }
      requestIds.add(callId)
    }

    const results = turnItems.filter((item) => item.type === "tool_result")
    for (const result of results) {
      const callId = result.toolMeta?.callId
      if (!callId || !requestIds.has(callId)) {
        throw new HistoryLoweringError("Tool history contains a result without a matching request in the same turn.")
      }
    }

    if (requests.length === 0) {
      for (const item of turnItems) messages.push(lowerSimpleItem(item))
      continue
    }

    const reasoning = turnItems
      .filter((item) => item.type === "assistant_reasoning")
      .map((item) => item.content)
      .join("\n")
    const assistantMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: reasoning || null,
      tool_calls: requests.map((item) => ({
        id: item.toolMeta!.callId,
        type: "function",
        function: {
          name: item.toolMeta!.toolName,
          arguments: requestArguments(item),
        },
      })),
    }

    const requestOrder = new Map(requests.map((item, index) => [item.toolMeta!.callId, index]))
    const orderedResults = results
      .map((item, originalIndex) => ({
        item,
        requestIndex: requestOrder.get(item.toolMeta!.callId)!,
        originalIndex,
      }))
      .sort((left, right) => left.requestIndex - right.requestIndex || left.originalIndex - right.originalIndex)

    let insertedToolTurn = false
    for (const item of turnItems) {
      if (item.type === "tool_request") {
        if (!insertedToolTurn) {
          messages.push(assistantMessage)
          for (const { item: result } of orderedResults) {
            messages.push({
              role: "tool",
              tool_call_id: result.toolMeta!.callId,
              content: result.content,
            })
          }
          insertedToolTurn = true
        }
        continue
      }
      if (item.type === "assistant_reasoning" || item.type === "tool_result") continue
      messages.push(lowerSimpleItem(item))
    }
  }

  return withOneSystemMessage(messages)
}
