// Adapted from OpenCode packages/cli/src/index.ts @ 3f393d78bf (MIT License). See NOTICE.
import { parseArgs } from "node:util"
import { ConfigValidationError, ensureRootEnvLoaded, loadRuntimeConfig } from "./config"
import { executeRunCommand } from "./commands/run"
import { executeViewCommand } from "./commands/view"
import { InMemoryRunStore, ScriptedModelGateway, textResponse } from "@harness/core/testing"
import { PostgresRunStore } from "@harness/schema"

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
  --mock              Use in-memory fake runner and store for development/testing
  -h, --help          Show this help message
`

export interface CliParsedArgs {
  command?: string
  prompt?: string
  model?: string
  timeout?: string
  id?: string
  mock?: boolean
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
      mock: { type: "boolean" },
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
    mock: Boolean(values.mock),
    help: Boolean(values.help),
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliArgs(argv)

  if (parsed.help || (!parsed.command && argv.length === 0)) {
    console.log(HelpMessage.trim())
    return 0
  }
  ensureRootEnvLoaded()


  if (parsed.command === "run") {
    let config
    let store: PostgresRunStore | InMemoryRunStore | undefined
    let gateway: ScriptedModelGateway | undefined

    if (parsed.mock) {
      store = new InMemoryRunStore({ clock: { nowMs: () => Date.now() } })
      gateway = new ScriptedModelGateway([
        textResponse("Hello from Harness CLI mock runner.", {
          usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40, costUsd: 0.0001 },
        }),
      ])
    } else {
      try {
        config = loadRuntimeConfig()
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          console.error(err.message)
          return 1
        }
        throw err
      }

      if (config.databaseUrl) {
        store = new PostgresRunStore({ url: config.databaseUrl })
      }
    }

    try {
      const { exitCode, output } = await executeRunCommand(
        {
          prompt: parsed.prompt,
          model: parsed.model,
          timeout: parsed.timeout,
        },
        { config, store, gateway },
      )
      console.log(output)
      return exitCode
    } finally {
      if (store && "close" in store && typeof store.close === "function") {
        await store.close()
      }
    }
  }

  if (parsed.command === "view") {
    if (parsed.mock) {
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

    if (!process.env.DATABASE_URL) {
      console.error("Error: DATABASE_URL is required to inspect persistent runs. Use --mock for in-memory testing.")
      return 1
    }

    const store = new PostgresRunStore({ url: process.env.DATABASE_URL })
    try {
      const { exitCode, output } = await executeViewCommand(
        {
          id: parsed.id,
        },
        { store },
      )
      console.log(output)
      return exitCode
    } finally {
      if (store && "close" in store && typeof store.close === "function") {
        await store.close()
      }
    }
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
