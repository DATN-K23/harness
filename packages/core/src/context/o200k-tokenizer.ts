import { getEncoding } from "js-tiktoken"

export interface TokenizerPort {
  readonly id: "o200k_base"
  count(text: string): number
}

/** Creates a pure-JavaScript o200k tokenizer; callers should reuse it. */
export const createO200kTokenizer = (): TokenizerPort => {
  const encoding = getEncoding("o200k_base")
  return {
    id: "o200k_base",
    count: (text) => encoding.encode(text, [], []).length,
  }
}
