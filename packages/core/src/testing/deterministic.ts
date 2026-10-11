import type { ClockPort, RandomPort, SleepPort } from "@harness/protocol"

export class FakeClock implements ClockPort {
  private current: number

  constructor(startMs = 0) {
    this.current = startMs
  }

  nowMs() {
    return this.current
  }

  advance(ms: number) {
    this.current += ms
  }

  set(ms: number) {
    this.current = ms
  }
}

/** mulberry32: a small, fast, well-distributed 32-bit generator. The same seed always yields the same sequence. */
export class SeededRandom implements RandomPort {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    const mixed = Math.imul(this.state ^ (this.state >>> 15), this.state | 1)
    const scrambled = mixed ^ (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61))
    return ((scrambled ^ (scrambled >>> 14)) >>> 0) / 4294967296
  }

  /** Random bytes for `createIdGenerator`, drawn from the same seeded stream. */
  bytes(size: number) {
    return Uint8Array.from({ length: size }, () => Math.floor(this.next() * 256))
  }
}

/** Returns immediately; the slept time is recorded and, when a clock is attached, added to it. */
export class FakeSleep implements SleepPort {
  readonly calls: number[] = []

  constructor(private readonly clock?: FakeClock) {}

  async sleep(ms: number, signal?: AbortSignal) {
    this.calls.push(ms)
    if (signal?.aborted) return
    this.clock?.advance(ms)
  }
}
