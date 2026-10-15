// Adapted from OpenCode packages/core/src/session/token-estimator.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { ContextItem } from "@harness/protocol"

export const FakeContextEngineLabel =
  "FAKE context engine: the token estimate is ceil(characters / 4). It is a stand-in and NOT the authoritative o200k_base count."

/** NOT the authoritative o200k_base count: a characters-over-four stand-in so tests need no tokenizer. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

export const estimateItemTokens = (items: readonly ContextItem[]): number =>
  items.reduce((total, item) => total + estimateTokens(item.content), 0)
