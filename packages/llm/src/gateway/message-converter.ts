// Adapted from OpenCode packages/core/src/session/runner/to-llm-message.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ContextItem } from "@harness/protocol"
import type OpenAI from "openai"

/**
 * Maps context items to OpenAI chat completion message format.
 */
export function convertToChatMessages(
  items: readonly ContextItem[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return items.map((item): OpenAI.Chat.ChatCompletionMessageParam => {
    switch (item.type) {
      case "system_prompt":
      case "tool_description":
      case "compaction_summary":
        return {
          role: "system",
          content: item.content,
        }

      case "assistant_reasoning":
        return {
          role: "assistant",
          content: item.content,
        }

      case "tool_request":
        if (item.toolMeta?.callId) {
          return {
            role: "assistant",
            content: item.content || null,
            tool_calls: [
              {
                id: item.toolMeta.callId,
                type: "function",
                function: {
                  name: item.toolMeta.toolName,
                  arguments: item.content || "{}",
                },
              },
            ],
          }
        }
        return {
          role: "assistant",
          content: item.content,
        }

      case "tool_result":
        return {
          role: "tool",
          tool_call_id: item.toolMeta?.callId ?? item.id,
          content: item.content,
        }

      case "candidate_finding":
      case "submitter_poc":
      case "bce_sliced_ast":
      case "execution_trace":
      case "session_note":
      default:
        return {
          role: "user",
          content: item.content,
        }
    }
  })
}
