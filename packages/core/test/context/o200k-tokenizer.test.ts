import { describe, expect, test } from "bun:test"
import { createO200kTokenizer } from "../../src/context/o200k-tokenizer"

describe("createO200kTokenizer", () => {
  const tokenizer = createO200kTokenizer()

  test("matches o200k_base reference vectors for Solidity and bytecode-like text", () => {
    expect(tokenizer.count("hello world")).toBe(2)
    expect(tokenizer.count("function withdrawAll() external { balances[msg.sender] = 0; }"))
      .toBe(15)
    expect(tokenizer.count("0x6080604052600436106100295760003560e01c8063"))
      .toBe(19)
  })

  test("counts Unicode text deterministically", () => {
    const text = "Vault 🔐 — 取款 / balances[msg.sender]"
    expect(tokenizer.count(text)).toBe(tokenizer.count(text))
    expect(tokenizer.count(text)).toBe(12)
  })

  test("does not interpret provider special-token spellings as control tokens", () => {
    expect(() => tokenizer.count("literal <|im_start|> marker")).not.toThrow()
    expect(tokenizer.count("literal <|im_start|> marker")).toBe(8)
  })

  test("returns zero for empty text and counts repeated input consistently", () => {
    expect(tokenizer.count("")).toBe(0)
    expect(tokenizer.count("same input")).toBe(2)
  })
})
