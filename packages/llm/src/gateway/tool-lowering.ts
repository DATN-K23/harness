// Adapted from OpenCode packages/llm/src/protocols/openai-chat.ts and packages/llm/src/protocols/utils/tool-schema.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ModelAttemptRequest, ToolDefinition } from "@harness/protocol"
import type OpenAI from "openai"

type OpenAIToolOptions = Partial<
  Pick<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "tools" | "tool_choice" | "parallel_tool_calls">
>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const removeNullSchemas = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(removeNullSchemas)
  if (!isRecord(value)) return value

  const fields = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "anyOf")
      .map(([key, field]) => [key, removeNullSchemas(field)]),
  )
  if (!Array.isArray(value.anyOf)) return fields

  const variants = value.anyOf.filter((variant) => !isRecord(variant) || variant.type !== "null").map(removeNullSchemas)
  if (variants.length === 1 && isRecord(variants[0])) return { ...fields, ...variants[0] }
  return { ...fields, anyOf: variants }
}

/** Projects a tool schema onto the JSON Schema shape accepted by OpenAI Chat Completions. */
export function projectOpenAIToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const variants = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isRecord) : []
  const flattened =
    variants.length === 0
      ? { ...schema, type: "object" }
      : {
          ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "anyOf")),
          type: "object",
          properties: variants.reduce(
            (properties, variant) => ({
              ...(isRecord(variant.properties) ? variant.properties : {}),
              ...properties,
            }),
            {} as Record<string, unknown>,
          ),
          additionalProperties: false,
        }
  const normalized = removeNullSchemas(flattened)
  return isRecord(normalized) ? normalized : { type: "object" }
}

export function lowerTools(tools: readonly ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: projectOpenAIToolSchema(tool.parameters),
    },
  }))
}

const lowerToolChoice = (choice: "auto" | "none"): OpenAI.Chat.ChatCompletionToolChoiceOption => choice

/** Lowers the request's tool policy without inferring options from provider or model names. */
export function lowerToolOptions(request: ModelAttemptRequest): OpenAIToolOptions {
  const toolsAvailable = !request.toolsDisabled && (request.tools?.length ?? 0) > 0
  const options: OpenAIToolOptions = {}

  if (toolsAvailable) {
    options.tools = lowerTools(request.tools ?? [])
    options.tool_choice = lowerToolChoice("auto")
  } else if (request.toolsDisabled && request.items.some((item) => item.type === "tool_result")) {
    options.tool_choice = lowerToolChoice("none")
  }

  if (request.maxToolCalls === 1) options.parallel_tool_calls = false
  return options
}
