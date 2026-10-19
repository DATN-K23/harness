import { describe, expect, test } from "bun:test"
import { HelpMessage, parseCliArgs, runCli } from "../src/index"

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


test("help lists repository, snapshot, run and view commands", async () => {
  const output: string[] = []
  const exitCode = await runCli(["--help"], { stdout: (message) => output.push(message) })
  expect(exitCode).toBe(0)
  expect(output.join("\n")).toContain("repo add")
  expect(output.join("\n")).toContain("snapshot list")
  expect(output.join("\n")).toContain("  run            ")
  expect(output.join("\n")).toContain("  view           ")
  expect(output.join("\n")).toContain("--snapshot <id>")
  expect(output.join("\n")).toContain("--json")
  expect(HelpMessage).toContain("--max-cost-usd")
})


test("parses repeatable include roots and snapshot run budgets", () => {
  const parsed = parseCliArgs([
    "repo", "add", "./repo", "--include-root", "src", "--include-root", "contracts", "--snapshot-id", "snap_test",
  ])
  expect(parsed.command).toBe("repo")
  expect(parsed.subcommand).toBe("add")
  expect(parsed.positionals).toEqual(["./repo"])
  expect(parsed.includeRoots).toEqual(["src", "contracts"])
  expect(parsed.snapshotId).toBe("snap_test")
  const run = parseCliArgs(["run", "--snapshot", "snap_test", "--max-steps", "5", "--max-cost-usd", "0.2"])
  expect(run.snapshot).toBe("snap_test")
  expect(run.maxSteps).toBe("5")
  expect(run.maxCostUsd).toBe("0.2")
})
