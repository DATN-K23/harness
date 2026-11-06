import { describe, expect, test } from "bun:test"
import { createIdGenerator } from "../../src/util/id"
import { FakeClock, FakeSleep, SeededRandom } from "../../src/testing/deterministic"

describe("FakeClock", () => {
  test("starts where it is told and only moves when advanced or set", () => {
    const clock = new FakeClock(1_000)
    expect(clock.nowMs()).toBe(1_000)
    expect(clock.nowMs()).toBe(1_000)
    clock.advance(250)
    expect(clock.nowMs()).toBe(1_250)
    clock.set(5)
    expect(clock.nowMs()).toBe(5)
  })

  test("defaults to epoch zero", () => {
    expect(new FakeClock().nowMs()).toBe(0)
  })
})

describe("SeededRandom", () => {
  const draw = (random: SeededRandom, count: number) => Array.from({ length: count }, () => random.next())

  test("the same seed reproduces the same sequence", () => {
    expect(draw(new SeededRandom(42), 20)).toEqual(draw(new SeededRandom(42), 20))
  })

  test("different seeds diverge", () => {
    expect(draw(new SeededRandom(1), 5)).not.toEqual(draw(new SeededRandom(2), 5))
  })

  test("values stay in [0, 1)", () => {
    expect(draw(new SeededRandom(7), 500).every((value) => value >= 0 && value < 1)).toBe(true)
  })

  test("bytes are reproducible and sized as asked, so it can feed the id generator", () => {
    expect(new SeededRandom(9).bytes(14)).toEqual(new SeededRandom(9).bytes(14))
    expect(new SeededRandom(9).bytes(14)).toHaveLength(14)
    const make = () => {
      const random = new SeededRandom(3)
      return createIdGenerator({ clock: () => 1_000, random: (size) => random.bytes(size) })
    }
    expect(make().next("run_")).toBe(make().next("run_"))
  })
})

describe("FakeSleep", () => {
  test("records requested durations and returns without waiting", async () => {
    const sleep = new FakeSleep()
    await sleep.sleep(2_000)
    await sleep.sleep(500)
    expect(sleep.calls).toEqual([2_000, 500])
  })

  test("advances an attached clock by the slept time", async () => {
    const clock = new FakeClock(10)
    const sleep = new FakeSleep(clock)
    await sleep.sleep(90)
    expect(clock.nowMs()).toBe(100)
  })

  test("an aborted signal returns early and leaves the clock alone", async () => {
    const clock = new FakeClock(10)
    const sleep = new FakeSleep(clock)
    await sleep.sleep(90, AbortSignal.abort())
    expect(clock.nowMs()).toBe(10)
    expect(sleep.calls).toEqual([90])
  })
})
