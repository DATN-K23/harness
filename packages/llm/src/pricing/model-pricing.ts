import type { TokenUsage } from "@harness/protocol"

export interface ModelPricing {
  model: string
  inputCostPer1M: number
  outputCostPer1M: number
  inputCostPerToken: number
  outputCostPerToken: number
}

export interface ModelPricingOverride {
  inputCostPerMTok: number
  outputCostPerMTok: number
}

export interface PriceUsageResult {
  costUsd: number
  pricing: "priced" | "unpriced"
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

export function getModelPricing(model: string): ModelPricing | undefined {
  if (!model) return undefined
  const normalized = model.trim().toLowerCase().replace(/^(openai\/)/, "")
  if (MODEL_PRICING_TABLE[normalized]) return MODEL_PRICING_TABLE[normalized]
  if (normalized.startsWith("gpt-4o-mini")) return MODEL_PRICING_TABLE["gpt-4o-mini"]
  if (normalized.startsWith("gpt-4o")) return MODEL_PRICING_TABLE["gpt-4o"]
  if (normalized.includes("gemini") && normalized.includes("flash")) return MODEL_PRICING_TABLE["gemini-3.8-flash"]
  return undefined
}

const roundedCost = (inputTokens: number, outputTokens: number, inputRate: number, outputRate: number) =>
  Math.round((inputTokens * inputRate + outputTokens * outputRate) * 1e8) / 1e8

export function priceUsage(
  model: string,
  usage: Partial<TokenUsage> | null | undefined,
  override?: ModelPricingOverride,
): PriceUsageResult {
  if (!usage) return { costUsd: 0, pricing: "unpriced" }
  const registry = override ? undefined : getModelPricing(model)
  if (!override && !registry) return { costUsd: 0, pricing: "unpriced" }

  const inputRate = override ? override.inputCostPerMTok / 1_000_000 : registry!.inputCostPerToken
  const outputRate = override ? override.outputCostPerMTok / 1_000_000 : registry!.outputCostPerToken
  return {
    costUsd: roundedCost(usage.promptTokens ?? 0, usage.completionTokens ?? 0, inputRate, outputRate),
    pricing: "priced",
  }
}

/** Retained for existing consumers; unknown models and absent usage return zero. */
export function calculateModelCost(model: string, usage?: Partial<TokenUsage> | null): number {
  return priceUsage(model, usage).costUsd
}
