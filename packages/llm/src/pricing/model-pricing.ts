// Adapted from OpenCode packages/llm/src/index.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { TokenUsage } from "@harness/protocol"

export interface ModelPricing {
  model: string
  inputCostPer1M: number
  outputCostPer1M: number
  inputCostPerToken: number
  outputCostPerToken: number
}

export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  "gpt-4o-mini": {
    model: "gpt-4o-mini",
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    inputCostPerToken: 0.15 / 1_000_000,
    outputCostPerToken: 0.6 / 1_000_000,
  },
  "gpt-4o": {
    model: "gpt-4o",
    inputCostPer1M: 2.5,
    outputCostPer1M: 10.0,
    inputCostPerToken: 2.5 / 1_000_000,
    outputCostPerToken: 10.0 / 1_000_000,
  },
  "gemini-3.8-flash": {
    model: "gemini-3.8-flash",
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    inputCostPerToken: 0.15 / 1_000_000,
    outputCostPerToken: 0.6 / 1_000_000,
  },
}

/**
 * Normalizes model name and returns pricing if available in the registry.
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  if (!model) return undefined
  const normalized = model.trim().toLowerCase().replace(/^(openai\/)/, "")

  if (MODEL_PRICING_TABLE[normalized]) {
    return MODEL_PRICING_TABLE[normalized]
  }

  if (normalized.startsWith("gpt-4o-mini")) {
    return MODEL_PRICING_TABLE["gpt-4o-mini"]
  }

  if (normalized.startsWith("gpt-4o")) {
    return MODEL_PRICING_TABLE["gpt-4o"]
  }

  if (normalized.includes("gemini") && normalized.includes("flash")) {
    return MODEL_PRICING_TABLE["gemini-3.8-flash"]
  }

  return undefined
}

/**
 * Calculates USD cost for model token usage based on pricing registry rates.
 * Returns 0 if pricing is not configured for the given model.
 */
export function calculateModelCost(
  model: string,
  usage?: Partial<TokenUsage> | null,
): number {
  if (!usage) return 0
  const pricing = getModelPricing(model)
  if (!pricing) return 0

  const promptTokens = usage.promptTokens ?? 0
  const completionTokens = usage.completionTokens ?? 0

  const cost = promptTokens * pricing.inputCostPerToken + completionTokens * pricing.outputCostPerToken
  return Math.round(cost * 1e8) / 1e8
}
