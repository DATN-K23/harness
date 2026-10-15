import { describe, expect, test } from "bun:test"
import { parseCliArgs } from "../src/index"

describe("parseCliArgs", () => {
  test("parses run command with prompt, model, and timeout flags", () => {
    const args = ["run", "--prompt", "Hello world", "--model", "gpt-4o", "--timeout", "15000"]
    const parsed = parseCliArgs(args)

    expect(parsed.command).toBe("run")
    expect(parsed.prompt).toBe("Hello world")
    expect(parsed.model).toBe("gpt-4o")
    expect(parsed.timeout).toBe("15000")
  })

  test("parses view command with id flag", () => {
    const args = ["view", "--id", "run-12345"]
    const parsed = parseCliArgs(args)

    expect(parsed.command).toBe("view")
    expect(parsed.id).toBe("run-12345")
  })

  test("parses mock flag correctly", () => {
    expect(parseCliArgs(["run", "--mock"]).mock).toBe(true)
    expect(parseCliArgs(["view", "--id", "run-123", "--mock"]).mock).toBe(true)
    expect(parseCliArgs(["run"]).mock).toBe(false)
  })

  test("parses help flag correctly", () => {
    expect(parseCliArgs(["--help"]).help).toBe(true)
    expect(parseCliArgs(["-h"]).help).toBe(true)
    expect(parseCliArgs(["run", "--help"]).help).toBe(true)
  })

  test("returns empty fields when flags are omitted", () => {
    const parsed = parseCliArgs(["run"])
    expect(parsed.command).toBe("run")
    expect(parsed.prompt).toBeUndefined()
    expect(parsed.model).toBeUndefined()
  })
})
