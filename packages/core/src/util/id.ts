// Adapted from OpenCode packages/schema/src/identifier.ts @ 3f393d78bf (MIT License, Copyright (c) 2025 opencode). See NOTICE.
// Differences: clock and random are injected, state is per generator, IDs are strictly ascending even when the
// clock stalls, rolls over a millisecond bucket or goes backwards, and a caller-supplied prefix is supported.
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const randomLength = 14
const timeBytes = 6

export interface IdGeneratorOptions {
  clock: () => number
  random: (size: number) => Uint8Array
}

export interface IdGenerator {
  next: (prefix?: string) => string
}

export const createIdGenerator = (options: IdGeneratorOptions): IdGenerator => {
  let last = 0n
  return {
    next: (prefix = "") => {
      // 12 low bits are a per-millisecond counter that starts at 1; carrying past 4095 or a backwards clock
      // continues from the previous value instead of repeating or reordering it.
      const floor = BigInt(options.clock()) * 0x1000n + 1n
      last = floor > last ? floor : last + 1n
      const time = Array.from({ length: timeBytes }, (_, index) =>
        Number((last >> BigInt(8 * (timeBytes - 1 - index))) & 0xffn)
          .toString(16)
          .padStart(2, "0"),
      ).join("")
      const tail = Array.from(options.random(randomLength), (byte) => alphabet[byte % 62]).join("")
      return prefix + time + tail
    },
  }
}

export const systemIdSources: IdGeneratorOptions = {
  clock: () => Date.now(),
  random: (size) => crypto.getRandomValues(new Uint8Array(size)),
}
