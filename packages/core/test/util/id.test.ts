import { describe, expect, test } from "bun:test"
import { createIdGenerator } from "../../src/util/id"

const sequentialRandom = () => {
  let next = 0
  return (size: number) => Uint8Array.from({ length: size }, () => next++ % 256)
}

const timePart = (id: string) => id.slice(0, 12)

describe("createIdGenerator", () => {
  test("produces 26 character IDs with a 12 hex time part and a base62 random tail", () => {
    const ids = createIdGenerator({ clock: () => 1_700_000_000_000, random: sequentialRandom() })
    const id = ids.next()
    expect(id).toHaveLength(26)
    expect(id).toMatch(/^[0-9a-f]{12}[0-9A-Za-z]{14}$/)
  })

  test("is strictly ascending under a fixed clock", () => {
    const ids = createIdGenerator({ clock: () => 1_700_000_000_000, random: () => new Uint8Array(14) })
    const generated = Array.from({ length: 50 }, () => ids.next())
    expect([...generated].sort()).toEqual(generated)
    expect(new Set(generated).size).toBe(generated.length)
  })

  test("stays ascending across more IDs than one millisecond bucket holds", () => {
    let now = 1_700_000_000_000
    const ids = createIdGenerator({ clock: () => now, random: () => new Uint8Array(14) })
    const generated = Array.from({ length: 5000 }, () => ids.next())
    now += 1
    generated.push(ids.next())
    expect([...generated].sort()).toEqual(generated)
    expect(new Set(generated).size).toBe(generated.length)
  })

  test("sorts later clock readings after earlier ones", () => {
    let now = 1_700_000_000_000
    const ids = createIdGenerator({ clock: () => now, random: () => new Uint8Array(14) })
    const first = ids.next()
    now += 1000
    const second = ids.next()
    expect(second > first).toBe(true)
  })

  test("never goes backwards when the clock does", () => {
    let now = 1_700_000_000_000
    const ids = createIdGenerator({ clock: () => now, random: () => new Uint8Array(14) })
    const first = ids.next()
    now -= 5000
    const second = ids.next()
    expect(second > first).toBe(true)
    expect(timePart(second) >= timePart(first)).toBe(true)
  })

  test("is deterministic for the same clock and random sources", () => {
    const make = () => createIdGenerator({ clock: () => 1_700_000_000_000, random: sequentialRandom() })
    const left = make()
    const right = make()
    expect([left.next(), left.next(), left.next()]).toEqual([right.next(), right.next(), right.next()])
  })

  test("keeps no state shared between generators", () => {
    const options = { clock: () => 1_700_000_000_000, random: () => new Uint8Array(14) }
    const left = createIdGenerator(options)
    const right = createIdGenerator(options)
    left.next()
    left.next()
    expect(right.next()).toBe(createIdGenerator(options).next())
  })

  test("prepends the prefix verbatim and keeps the prefixed IDs sortable", () => {
    const ids = createIdGenerator({ clock: () => 1_700_000_000_000, random: sequentialRandom() })
    const first = ids.next("run_")
    const second = ids.next("run_")
    expect(first.startsWith("run_")).toBe(true)
    expect(first).toHaveLength(30)
    expect(second > first).toBe(true)
    expect(ids.next("evt_").startsWith("evt_")).toBe(true)
  })

  test("maps random bytes onto the base62 alphabet", () => {
    const ids = createIdGenerator({ clock: () => 0, random: () => Uint8Array.from({ length: 14 }, (_, i) => 60 + i) })
    expect(ids.next().slice(12)).toBe("yz01234567" + "89AB")
  })
})
