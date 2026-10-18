import { describe, expect, test } from "bun:test"
import type { ToolCall } from "@harness/protocol"
import { FakeClock, FakeSleep } from "../../src/testing/deterministic"
import { InMemoryToolRegistry } from "../../src/testing/in-memory-tool-registry"

const files = {
  "src/Vault.sol": "contract Vault {\n  function withdraw() external {}\n  function deposit() external {}\n}\n",
  "src/lib/Math.sol": "library Math {}\n",
  "test/Vault.t.sol": "contract VaultTest {}\n",
  "README.md": "# Vault\n",
  "secrets/key.txt": "hunter2\n",
}

let counter = 0
const call = (toolName: string, args: Record<string, unknown> = {}): ToolCall => ({
  runId: "run-1",
  callId: `call-${++counter}`,
  toolName,
  arguments: args,
})

const registry = () => new InMemoryToolRegistry({ files })

describe("definitions", () => {
  test("lists the four read-only tools with JSON schema parameters", () => {
    const names = registry()
      .definitions()
      .map((tool) => tool.name)
    expect(names).toEqual(["read_file", "grep", "glob", "list_dir"])
    expect(
      registry()
        .definitions()
        .every((tool) => tool.parameters.type === "object"),
    ).toBe(true)
  })
})

describe("read_file", () => {
  test("returns the whole file with its path and line range", async () => {
    const result = await registry().execute(call("read_file", { path: "src/Vault.sol" }))
    expect(result).toEqual({
      content: "contract Vault {\n  function withdraw() external {}\n  function deposit() external {}\n}",
      isError: false,
      filePath: "src/Vault.sol",
      lineRange: [1, 4],
    })
  })

  test("returns an inclusive line range and clamps the end to the file", async () => {
    const some = await registry().execute(call("read_file", { path: "src/Vault.sol", startLine: 2, endLine: 3 }))
    expect(some).toMatchObject({
      content: "  function withdraw() external {}\n  function deposit() external {}",
      lineRange: [2, 3],
    })
    const clamped = await registry().execute(call("read_file", { path: "src/Vault.sol", startLine: 4, endLine: 99 }))
    expect(clamped).toMatchObject({ content: "}", lineRange: [4, 4] })
  })

  test("a missing file is a structured error with a next step", async () => {
    const result = await registry().execute(call("read_file", { path: "src/Nope.sol" }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('File not found: "src/Nope.sol"')
    expect(result.content).toContain("list_dir")
  })

  test("a start line past the end is an error that names the real line count", async () => {
    const result = await registry().execute(call("read_file", { path: "README.md", startLine: 5 }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain("which has 1 lines")
  })

  test("normalizes ./ and repeated slashes", async () => {
    const result = await registry().execute(call("read_file", { path: "./src//Vault.sol" }))
    expect(result).toMatchObject({ isError: false, filePath: "src/Vault.sol" })
  })

  test.each([
    ["missing path", {}],
    ["non-string path", { path: 42 }],
    ["empty path", { path: "" }],
    ["fractional line", { path: "README.md", startLine: 1.5 }],
    ["zero line", { path: "README.md", startLine: 0 }],
    ["reversed range", { path: "src/Vault.sol", startLine: 3, endLine: 2 }],
  ])("invalid arguments (%s) produce a structured error", async (_name, args) => {
    const result = await registry().execute(call("read_file", args))
    expect(result.isError).toBe(true)
    expect(result.content).toContain("Invalid arguments for read_file")
    expect(result.content).toContain("Expected")
  })

  test.each(["/etc/passwd", "C:\\Windows\\win.ini", "../outside.txt", "src/../../outside.txt"])(
    "refuses %s as outside the snapshot",
    async (path) => {
      const result = await registry().execute(call("read_file", { path }))
      expect(result.isError).toBe(true)
      expect(result.content).toContain("Access denied")
    },
  )

  test("refuses a configured denied prefix but still reads its siblings", async () => {
    const guarded = new InMemoryToolRegistry({ files, deniedPrefixes: ["secrets"] })
    const denied = await guarded.execute(call("read_file", { path: "secrets/key.txt" }))
    expect(denied.isError).toBe(true)
    expect(denied.content).toContain("Access denied")
    expect((await guarded.execute(call("read_file", { path: "src/Vault.sol" }))).isError).toBe(false)
  })
})

describe("grep", () => {
  test("returns path:line: text for each match in path order", async () => {
    const result = await registry().execute(call("grep", { pattern: "function \\w+" }))
    expect(result).toEqual({
      content: "src/Vault.sol:2:   function withdraw() external {}\nsrc/Vault.sol:3:   function deposit() external {}",
      isError: false,
    })
  })

  test("no match is a normal result, an invalid expression is an error", async () => {
    const none = await registry().execute(call("grep", { pattern: "selfdestruct" }))
    expect(none).toEqual({ content: 'No matches for "selfdestruct".', isError: false })
    const broken = await registry().execute(call("grep", { pattern: "(" }))
    expect(broken.isError).toBe(true)
    expect(broken.content).toContain("Invalid regular expression")
  })

  test("never searches denied paths", async () => {
    const guarded = new InMemoryToolRegistry({ files, deniedPrefixes: ["secrets"] })
    expect((await guarded.execute(call("grep", { pattern: "hunter2" }))).content).toContain("No matches")
    expect((await registry().execute(call("grep", { pattern: "hunter2" }))).content).toContain("secrets/key.txt:1")
  })

  test("a non-string pattern is invalid", async () => {
    expect((await registry().execute(call("grep", { pattern: 7 }))).content).toContain("Invalid arguments for grep")
  })
})

describe("glob", () => {
  test.each([
    ["**/*.sol", ["src/Vault.sol", "src/lib/Math.sol", "test/Vault.t.sol"]],
    ["src/*.sol", ["src/Vault.sol"]],
    ["src/**", ["src/Vault.sol", "src/lib/Math.sol"]],
    ["*.md", ["README.md"]],
    ["src/?ault.sol", ["src/Vault.sol"]],
  ])("%s", async (pattern, expected) => {
    const result = await registry().execute(call("glob", { pattern }))
    expect(result.content.split("\n")).toEqual(expected)
  })

  test("reports no match and rejects a missing pattern", async () => {
    expect((await registry().execute(call("glob", { pattern: "*.rs" }))).content).toBe('No files match "*.rs".')
    expect((await registry().execute(call("glob", {}))).isError).toBe(true)
  })
})

describe("list_dir", () => {
  test("lists the root with directories marked", async () => {
    const result = await registry().execute(call("list_dir"))
    expect(result.content.split("\n")).toEqual(["README.md", "secrets/", "src/", "test/"])
  })

  test("lists a subdirectory", async () => {
    const result = await registry().execute(call("list_dir", { path: "src" }))
    expect(result.content.split("\n")).toEqual(["Vault.sol", "lib/"])
  })

  test("an unknown directory is an error, a traversal is denied", async () => {
    expect((await registry().execute(call("list_dir", { path: "nope" }))).content).toContain("Directory not found")
    expect((await registry().execute(call("list_dir", { path: ".." }))).content).toContain("Access denied")
  })

  test("hides denied prefixes", async () => {
    const guarded = new InMemoryToolRegistry({ files, deniedPrefixes: ["secrets"] })
    expect((await guarded.execute(call("list_dir"))).content.split("\n")).toEqual(["README.md", "src/", "test/"])
  })
})

describe("unknown tools and the call log", () => {
  test("an unknown tool resolves as an error naming the available tools", async () => {
    const result = await registry().execute(call("delete_file", { path: "x" }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unknown tool "delete_file"')
    expect(result.content).toContain("read_file, grep, glob, list_dir")
  })

  test("logs every call as a copy", async () => {
    const tools = registry()
    const first = call("list_dir")
    await tools.execute(first)
    await tools.execute(call("nope"))
    first.arguments.path = "mutated"
    expect(tools.calls.map((logged) => logged.toolName)).toEqual(["list_dir", "nope"])
    expect(tools.calls[0].arguments).toEqual({})
  })

  test("an aborted signal resolves as an error without reading", async () => {
    const result = await registry().execute(call("read_file", { path: "README.md" }), AbortSignal.abort())
    expect(result.isError).toBe(true)
    expect(result.content).toContain("aborted")
  })
})

describe("injected failures, throws and delays", () => {
  test("failTool returns an error result for the next calls only", async () => {
    const tools = registry()
    tools.failTool("read_file", "disk unavailable", 2)
    const results = await Promise.all([1, 2, 3].map(() => tools.execute(call("read_file", { path: "README.md" }))))
    expect(results.map((result) => result.isError)).toEqual([true, true, false])
    expect(results[0].content).toBe("disk unavailable")
  })

  test("throwOn maps unexpected errors to a fixed error result, once by default", async () => {
    const tools = registry()
    tools.throwOn("grep", new Error("adapter bug"))
    expect(await tools.execute(call("grep", { pattern: "x" }))).toEqual({
      content: "Tool execution failed (internal error). Retry or use a different path.",
      isError: true,
    })
    expect((await tools.execute(call("grep", { pattern: "x" }))).isError).toBe(false)
  })

  test("throwOn maps non-Error values to the fixed error result", async () => {
    const tools = registry()
    tools.throwOn("glob", "just a string")
    expect(await tools.execute(call("glob", { pattern: "*" }))).toEqual({
      content: "Tool execution failed (internal error). Retry or use a different path.",
      isError: true,
    })
  })

  test("delayTool sleeps through the injected sleep before running", async () => {
    const clock = new FakeClock(0)
    const sleep = new FakeSleep(clock)
    const tools = new InMemoryToolRegistry({ files, sleep })
    tools.delayTool("read_file", 750)
    await tools.execute(call("read_file", { path: "README.md" }))
    await tools.execute(call("list_dir"))
    expect(sleep.calls).toEqual([750])
    expect(clock.nowMs()).toBe(750)
  })

  test("delayTool without a sleep is a setup error", () => {
    expect(() => registry().delayTool("read_file", 1)).toThrow("needs a sleep")
  })

  test("rejects fixture paths that are not snapshot-relative", () => {
    expect(() => new InMemoryToolRegistry({ files: { "/abs/File.sol": "" } })).toThrow("must be relative")
  })
})
