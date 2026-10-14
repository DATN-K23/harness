// Adapted from OpenCode packages/cli/src/index.ts @ 3f393d78bf (MIT License). See NOTICE.
import { parseArgs } from "node:util"
import { loadRuntimeConfig } from "./config"
import { executeRunCommand } from "./commands/run"
import { executeViewCommand } from "./commands/view"
import { InMemoryRunStore } from "@harness/core/testing"

export * from "./config"
export * from "./redaction"
export * from "./commands/run"
export * from "./commands/view"

export const HelpMessage = `
Harness CLI - Smart-contract Judge Agent Loop

Usage:
  bun run cli:run -- --prompt "<text>" [--model <name>] [--timeout <ms>]
  bun run cli:view -- --id <runId>

Commands:
  run     Execute a single-turn prompt run through the model runner
  view    Inspect historical run record and trajectory events

Options:
  --prompt <text>     Prompt text to evaluate (required for run)
  --model <name>      Model name to invoke (optional, defaults to config)
  --timeout <ms>      Execution timeout in milliseconds (default: 30000)
  --id <runId>        Run identifier to inspect (required for view)
  -h, --help          Show this help message
`

export interface CliParsedArgs {
  command?: string
  prompt?: string
  model?: string
  timeout?: string
  id?: string
  help?: boolean
}

export function parseCliArgs(args: string[]): CliParsedArgs {
  const { values, positionals } = parseArgs({
    args,
    options: {
      prompt: { type: "string" },
      model: { type: "string" },
      timeout: { type: "string" },
      id: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  })

  return {
    command: positionals[0],
    prompt: typeof values.prompt === "string" ? values.prompt : undefined,
    model: typeof values.model === "string" ? values.model : undefined,
    timeout: typeof values.timeout === "string" ? values.timeout : undefined,
    id: typeof values.id === "string" ? values.id : undefined,
    help: Boolean(values.help),
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliArgs(argv)

  if (parsed.help || (!parsed.command && argv.length === 0)) {
    console.log(HelpMessage.trim())
    return 0
  }

  if (parsed.command === "run") {
    let config
    try {
      config = loadRuntimeConfig()
    } catch {
      // Configuration optional in fallback dev/test mode; runner uses test fakes
    }

    const { exitCode, output } = await executeRunCommand(
      {
        prompt: parsed.prompt,
        model: parsed.model,
        timeout: parsed.timeout,
      },
      { config },
    )
    console.log(output)
    return exitCode
  }

  if (parsed.command === "view") {
    // InMemory store fallback when database connection is not yet configured
    const store = new InMemoryRunStore({ clock: { nowMs: () => Date.now() } })
    const { exitCode, output } = await executeViewCommand(
      {
        id: parsed.id,
      },
      { store },
    )
    console.log(output)
    return exitCode
  }

  console.error(`Error: Unknown command '${parsed.command}'. See --help.`)
  return 1
}

// Auto-run if executed directly via CLI
if (import.meta.main) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code)
  })
}
