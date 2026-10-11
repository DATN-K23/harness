import { describe, expect, test } from "bun:test"
import { canonicalJson, digestOf, sha256Hex } from "../../src/util/digest"

describe("canonicalJson", () => {
  test("is independent of object key order at every depth", () => {
    const left = { b: 1, a: { y: [1, { q: 1, p: 2 }], x: null } }
    const right = { a: { x: null, y: [1, { p: 2, q: 1 }] }, b: 1 }
    expect(canonicalJson(left)).toBe(canonicalJson(right))
    expect(canonicalJson(left)).toBe('{"a":{"x":null,"y":[1,{"p":2,"q":1}]},"b":1}')
  })

  test("keeps array order significant", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })
})

describe("sha256Hex", () => {
  test("matches published SHA-256 vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  })

  test("hashes UTF-8 bytes", () => {
    expect(sha256Hex("é")).toBe(sha256Hex("é"))
    expect(sha256Hex("é")).not.toBe(sha256Hex("e"))
  })
})

describe("digestOf", () => {
  test("returns sha256: followed by 64 lowercase hex characters", () => {
    expect(digestOf({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test("has stable vectors", () => {
    expect(digestOf({})).toBe("sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a")
    expect(digestOf({ b: [1, 2, { d: "x", c: null }], a: 1 })).toBe(
      "sha256:021325d8139da0b640cac3243ea3927b4810f1a7a734fbcc048d083f90a5e3b6",
    )
  })

  test("is independent of key order and sensitive to values", () => {
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }))
    expect(digestOf({ a: 1, b: 2 })).not.toBe(digestOf({ a: 1, b: 3 }))
  })
})
