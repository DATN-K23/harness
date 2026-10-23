import { parseArgs } from "node:util"
import { resolve } from "node:path"
import type { ModelGatewayPort, RunStorePort } from "@harness/protocol"
import { DiskSourceSnapshot, MultiTurnRunner, PassThroughContextEngine, ProductionContextEngine, ProductionSecurityFilter, createIdGenerator, systemIdSources, createO200kTokenizer, SnapshotManager, ToolRegistry } from "@harness/core"
import type { SnapshotManifest } from "@harness/core"
import { DefaultRetryConfig } from "@harness/protocol"
import { InMemoryRunStore, ScriptedModelGateway, textResponse, toolCallResponse } from "@harness/core/testing"
import { PostgresRunStore } from "@harness/schema"
import { priceUsage, RealModelGateway } from "@harness/llm"
import {
  ConfigValidationError,
  ensureRootEnvLoaded,
  findRepositoryRoot,
  loadRuntimeConfig,
  type RuntimeConfig,
} from "./config"
import { executeRepoAddCommand } from "./commands/repo"
import { executeRunCommand } from "./commands/run"
import { executeSnapshotListCommand } from "./commands/snapshot"
import { executeViewCommand } from "./commands/view"
import { redactSecrets } from "./redaction"
import { startProductionLocalServer } from "../../server/src/production-runtime"
import { waitForServerShutdown } from "./server-lifecycle"

export * from "./config"
export * from "./redaction"
export * from "./commands/run"
export * from "./commands/view"
export * from "./commands/repo"
export * from "./commands/snapshot"

export const HelpMessage = `
Harness CLI - Smart-contract Judge Agent Loop

Usage:
  bun run cli:repo -- add <path> [--include-root <dir>]... [--snapshot-id <id>]
  bun run cli:snapshot -- list
  bun run cli:run -- --prompt "<text>" [--model <name>] [--timeout <ms>]
  bun run cli:run -- --snapshot <id> --prompt "<text>" [run limits]
  bun run cli:run -- --snapshot <id> --finding <path> [run limits]
  bun run cli:view -- --id <runId> [--json]
  bun run cli:serve

Commands:
  repo add       Ingest a repository into an immutable source snapshot
  snapshot list  List registered source snapshots
  run            Execute a single-turn or snapshot-backed multi-turn run
  view           Inspect a historical run and its trajectory
  serve          Start the fail-closed local health/API compatibility server

Options:
  --prompt <text>             Prompt text to evaluate (required for run unless --finding is used)
  --finding <path>            Candidate finding markdown file to judge (requires --snapshot)
  --snapshot <id>             Use a registered source snapshot for tool calling
  --model <name>              Model name to invoke (optional, defaults to config)
  --timeout <ms>              Execution timeout in milliseconds
  --max-steps <count>         Maximum model steps for a snapshot run
  --max-tool-calls <count>    Maximum tool calls for a snapshot run
  --max-output-tokens <count> Maximum output tokens per provider attempt
  --max-total-tokens <count>  Maximum total tokens for the run
  --structured-output         Judge: submit verdicts through schema-typed tools (recorded in the run config)
  --no-bidirectional          Judge: skip forward/backward verification of the claim (recorded in the run config)
  --include-root <dir>        Include only this repository-relative path (repeatable)
  --snapshot-id <id>          Set an explicit ID when registering a repository
  --id <runId>                Run identifier to inspect (required for view)
  --json                      Print a multi-turn run summary as JSON
  --mock                      Use an in-memory store and scripted provider
  -h, --help                  Show this help message
`

export interface CliParsedArgs {
  command?: string
  subcommand?: string
  positionals: string[]
  prompt?: string
  finding?: string
  model?: string
  timeout?: string
  snapshot?: string
  id?: string
  mock?: boolean
  json?: boolean
  help?: boolean
  snapshotId?: string
  includeRoots: string[]
  maxSteps?: string
  maxToolCalls?: string
  maxOutputTokens?: string
  maxTotalTokens?: string
  structuredOutput?: boolean
  noBidirectional?: boolean
}

export type CliWriter = (text: string) => void
export type CliStore = RunStorePort & { close?: () => Promise<void> | void }

export interface RunCliDependencies {
  gatewayFactory?: (config: RuntimeConfig) => ModelGatewayPort
  storeFactory?: (config: RuntimeConfig) => CliStore
  env?: Record<string, string | undefined>
  stdout?: CliWriter
  stderr?: CliWriter
  snapshotDir?: string
  processSignals?: { on(event: "SIGINT", listener: () => void): unknown; off(event: "SIGINT", listener: () => void): unknown }
}

export function parseCliArgs(args: string[]): CliParsedArgs {
  if (args.includes("--max-cost-usd")) throw new Error("Unknown option '--max-cost-usd'. See --help.")
  const { values, positionals } = parseArgs({
    args,
    options: {
      prompt: { type: "string" },
      finding: { type: "string" },
      model: { type: "string" },
      timeout: { type: "string" },
      snapshot: { type: "string" },
      id: { type: "string" },
      mock: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      "snapshot-id": { type: "string" },
      "include-root": { type: "string", multiple: true },
      "max-steps": { type: "string" },
      "max-tool-calls": { type: "string" },
      "max-output-tokens": { type: "string" },
      "max-total-tokens": { type: "string" },
      "structured-output": { type: "boolean" },
      "no-bidirectional": { type: "boolean" },
    },
    allowPositionals: true,
    strict: false,
  })
  const includeRoot = values["include-root"]
  return {
    command: positionals[0] === "run" || positionals[0] === "view" || positionals[0] === "repo" || positionals[0] === "snapshot" || positionals[0] === "serve"
      ? positionals[0]
      : (values.prompt !== undefined || values.finding !== undefined ? "run" : positionals[0]),
    subcommand: positionals[1],
    positionals: positionals.slice(positionals[0] === "run" || positionals[0] === "view" || positionals[0] === "repo" || positionals[0] === "snapshot" || positionals[0] === "serve" ? 2 : 1),
    prompt: asString(values.prompt),
    finding: asString(values.finding),
    model: asString(values.model),
    timeout: asString(values.timeout),
    snapshot: asString(values.snapshot),
    id: asString(values.id),
    mock: Boolean(values.mock),
    json: Boolean(values.json),
    help: Boolean(values.help),
    snapshotId: asString(values["snapshot-id"]),
    includeRoots: Array.isArray(includeRoot)
      ? includeRoot.filter((root): root is string => typeof root === "string")
      : typeof includeRoot === "string"
        ? [includeRoot]
        : [],
    maxSteps: asString(values["max-steps"]),
    maxToolCalls: asString(values["max-tool-calls"]),
    maxOutputTokens: asString(values["max-output-tokens"]),
    maxTotalTokens: asString(values["max-total-tokens"]),
    structuredOutput: Boolean(values["structured-output"]),
    noBidirectional: Boolean(values["no-bidirectional"]),
  }
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  deps: RunCliDependencies = {},
): Promise<number> {
  const stdout = deps.stdout ?? ((message: string) => console.log(message))
  const stderr = deps.stderr ?? ((message: string) => console.error(message))
  let parsed: CliParsedArgs
  try {
    parsed = parseCliArgs(argv)
  } catch (error) {
    stderr(`Error: ${safeError(error, [])}`)
    return 1
  }
  if (parsed.help || (!parsed.command && argv.length === 0)) {
    stdout(HelpMessage.trim())
    return 0
  }

  if (deps.env === undefined) ensureRootEnvLoaded()
  const env = deps.env ?? process.env
  const snapshotDir = resolveSnapshotStorageDir(env, deps.snapshotDir)
  const secrets = env.MODEL_API_KEY ? [env.MODEL_API_KEY] : []

  if (parsed.command === "repo" && parsed.subcommand === "add") {
    const result = await executeRepoAddCommand({
      sourceDir: parsed.positionals[0],
      storageDir: snapshotDir,
      ...(parsed.includeRoots.length > 0 ? { includeRoots: parsed.includeRoots } : {}),
      snapshotId: parsed.snapshotId,
      secrets,
    })
    const write = result.exitCode === 0 ? stdout : stderr
    write(redactSecrets(result.output, secrets))
    return result.exitCode
  }

  if (parsed.command === "snapshot" && parsed.subcommand === "list") {
    const result = await executeSnapshotListCommand({ storageDir: snapshotDir, secrets })
    const write = result.exitCode === 0 ? stdout : stderr
    write(redactSecrets(result.output, secrets))
    return result.exitCode
  }

  if (parsed.command === "run") {
    return runCommand(parsed, deps, env, snapshotDir, stdout, stderr, secrets)
  }

  if (parsed.command === "view") {
    return viewCommand(parsed, deps, env, stdout, stderr, secrets)
  }

  if (parsed.command === "serve") {
    try {
      const config = loadCliConfig(env, deps.snapshotDir)
      const server = await startProductionLocalServer({
        databaseUrl: config.databaseUrl,
        modelApiKey: config.modelApiKey,
        modelName: config.modelName,
        providerName: config.providerName,
        modelBaseUrl: config.modelBaseUrl,
        modelTimeoutMs: config.modelTimeoutMs,
        modelMaxOutputTokens: config.modelMaxOutputTokens,
        modelInputCostPerMTok: config.modelInputCostPerMTok,
        modelOutputCostPerMTok: config.modelOutputCostPerMTok,
        snapshotDir: config.snapshotDir,
        hostname: env.HARNESS_HOST ?? "127.0.0.1",
        port: Number(env.HARNESS_PORT ?? 4318),
      })
      stdout(`Harness local Judge API listening on ${server.server.hostname}:${server.server.port}; verdict capability remains UNVERIFIED`)
      await waitForServerShutdown(process, () => server.stop())
      return 0
    } catch (error) {
      stderr(`Error: ${safeError(error, secrets)}`)
      return 1
    }
  }

  stderr(`Error: Unknown command '${parsed.command ?? ""}'. See --help.`)
  return 1
}

async function runCommand(
  parsed: CliParsedArgs,
  deps: RunCliDependencies,
  env: Record<string, string | undefined>,
  snapshotDir: string,
  stdout: CliWriter,
  stderr: CliWriter,
  secrets: string[],
): Promise<number> {
  let config: RuntimeConfig | undefined
  let store: CliStore | undefined
  try {
    if (!parsed.mock && parsed.snapshot === undefined) config = loadCliConfig(env, deps.snapshotDir)

    let snapshot: DiskSourceSnapshot | undefined
    let snapshotFiles: string[] = []
    if (parsed.snapshot !== undefined) {
      let manifest: SnapshotManifest
      try {
        manifest = await SnapshotManager.loadSnapshotManifest(snapshotDir, parsed.snapshot)
      } catch {
        stderr(redactSecrets(`Error: Snapshot ${parsed.snapshot} not found`, secrets))
        return 1
      }
      snapshot = new DiskSourceSnapshot({ storageDir: snapshotDir, snapshotId: parsed.snapshot, manifest })
      snapshotFiles = await snapshot.listFiles({ snapshotId: parsed.snapshot })
    }

    if (!parsed.mock && parsed.snapshot !== undefined) config = loadCliConfig(env, deps.snapshotDir)

    if (parsed.finding !== undefined && parsed.snapshot === undefined) {
      stderr("Error: --snapshot <id> is required when --finding is provided.")
      return 1
    }

    let findingMarkdown = ""
    if (parsed.finding !== undefined) {
      try {
        const filePath = resolve(findRepositoryRoot() ?? process.cwd(), parsed.finding)
        const file = Bun.file(filePath)
        if (!(await file.exists())) {
          stderr(redactSecrets(`Error: Finding file '${parsed.finding}' could not be read.`, secrets))
          return 1
        }
        findingMarkdown = await file.text()
        if (!findingMarkdown.trim()) {
          stderr(`Error: Finding file '${parsed.finding}' is empty.`)
          return 1
        }
      } catch {
        stderr(redactSecrets(`Error: Finding file '${parsed.finding}' could not be read.`, secrets))
        return 1
      }
    }

    const prompt = parsed.prompt?.trim()
    if (!prompt && parsed.finding === undefined) {
      stderr("Error: --prompt is required and cannot be empty.")
      return 1
    }

    const timeoutOverride = parseLimit(parsed.timeout, "--timeout", "positiveInteger")
    const maxOutputTokensOverride = parseLimit(parsed.maxOutputTokens, "--max-output-tokens", "positiveInteger")
    if (timeoutOverride.error || maxOutputTokensOverride.error) {
      stderr(`Error: ${timeoutOverride.error ?? maxOutputTokensOverride.error}`)
      return 1
    }

    if (parsed.snapshot !== undefined && snapshot) {
      const effectiveConfig = config
      const profileId = parsed.model ?? effectiveConfig?.modelName ?? "mock-model"
      const timeoutMs = timeoutOverride.value ?? effectiveConfig?.modelTimeoutMs ?? 30_000
      const maxOutputTokens = maxOutputTokensOverride.value ?? effectiveConfig?.modelMaxOutputTokens ?? 4_096
      const maxSteps = resolveLimit(
        parsed.maxSteps,
        effectiveConfig?.runLimits.maxSteps,
        10,
        "--max-steps",
        "positiveInteger",
      )
      const maxToolCalls = resolveLimit(
        parsed.maxToolCalls,
        effectiveConfig?.runLimits.maxToolCalls,
        20,
        "--max-tool-calls",
        "positiveInteger",
      )
      const maxTotalTokens = resolveLimit(
        parsed.maxTotalTokens,
        effectiveConfig?.runLimits.totalTokenBudget,
        200_000,
        "--max-total-tokens",
        "positiveInteger",
      )
      const limits = {
        wallClockTimeoutMs: timeoutMs,
        maxSteps: maxSteps.value,
        maxToolCalls: maxToolCalls.value,
        totalTokenBudget: maxTotalTokens.value,
      }
      const validation = [
        parseLimit(parsed.maxSteps, "--max-steps", "positiveInteger"),
        parseLimit(parsed.maxToolCalls, "--max-tool-calls", "positiveInteger"),
        parseLimit(parsed.maxTotalTokens, "--max-total-tokens", "positiveInteger"),
      ].find((item) => item.error)
      if (validation?.error) {
        stderr(`Error: ${validation.error}`)
        return 1
      }
      const inputPrice = effectiveConfig?.modelInputCostPerMTok
      const outputPrice = effectiveConfig?.modelOutputCostPerMTok
      const priceOverride = inputPrice !== undefined && outputPrice !== undefined
        ? { inputCostPerMTok: inputPrice, outputCostPerMTok: outputPrice }
        : undefined
      const profilePricing = parsed.mock
        ? "priced"
        : priceUsage(profileId, { promptTokens: 0, completionTokens: 0 }, priceOverride).pricing

      if (parsed.mock) {
        store = new InMemoryRunStore({ clock: { nowMs: () => Date.now() } })
      } else if (effectiveConfig) {
        store = deps.storeFactory
          ? deps.storeFactory(effectiveConfig)
          : new PostgresRunStore({ url: effectiveConfig.databaseUrl })
      }
      if (!store) throw new ConfigValidationError("Invalid runtime configuration:\n  DATABASE_URL: required")

      const registry = new ToolRegistry({ snapshot, snapshotId: parsed.snapshot, secrets })
      let gateway: ModelGatewayPort
      if (parsed.mock) {
        const firstFile = snapshotFiles[0]
        if (!firstFile) {
          stderr(`Error: Snapshot ${parsed.snapshot} contains no readable files.`)
          return 1
        }
        gateway = new ScriptedModelGateway([
          toolCallResponse([{ id: "mock-read-file-1", name: "read_file", arguments: { path: firstFile } }]),
          textResponse("Mock run read a file from the registered snapshot and completed.", {
            usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40, costUsd: 0.0001 },
          }),
        ])
      } else if (effectiveConfig) {
        const gatewayConfig = { ...effectiveConfig, modelName: profileId, modelTimeoutMs: timeoutMs }
        gateway = deps.gatewayFactory ? deps.gatewayFactory(gatewayConfig) : createRealGateway(gatewayConfig, secrets)
      } else {
        throw new ConfigValidationError("Invalid runtime configuration:\n  MODEL_API_KEY: required", ["MODEL_API_KEY"])
      }

      if (parsed.finding !== undefined) {
        const { JudgeRunner } = await import("@harness/core")
        const findingId = `finding-${Date.now()}`
        const runId = `run-${Date.now()}`
        const judgeInput: import("@harness/core").JudgeRunInput = {
          finding: { findingId, reportMarkdown: findingMarkdown },
          snapshotId: parsed.snapshot,
          config: {
            flags: {
              enableToolTruncation: true,
              enableObsMasking: true,
              enableSupersedeReads: true,
              enableDropEmpty: true,
              enableLlmCompaction: true,
              enableSessionNote: false,
              enableSchemaRepair: true,
              enableMaxStepsForcing: true,
              enableNoProgressDetection: true,
              enableInfraRetry: true,
              enableParallelToolDispatch: true,
            },
            policy: {
              policyVersion: "cli-judge-v1",
              windowLimitTokens: 100_000,
              outputReserveTokens: maxOutputTokens,
              compactionThreshold: 0.8,
              safetyMarginFactor: 1.2,
              recentWindowTokens: 10_000,
              toolOutputMaxTokens: 4_000,
              toolOutputMaxLines: 50,
              maxCompactions: 2,
              flags: {
                enableToolTruncation: true,
                enableObsMasking: true,
                enableSupersedeReads: true,
                enableDropEmpty: true,
                enableLlmCompaction: true,
                enableSessionNote: false,
              },
            },
            retry: { ...DefaultRetryConfig, retryableStatuses: [...DefaultRetryConfig.retryableStatuses] },
            limits: {
              wallClockTimeoutMs: timeoutMs,
              totalTokenBudget: maxTotalTokens.value,
              maxSteps: maxSteps.value,
              noProgressMaxRepeats: 3,
            },
            maxProbeRuns: 0,
            enablePocExecution: false,
            enableBidirectionalVerification: !parsed.noBidirectional,
            enableStructuredOutput: Boolean(parsed.structuredOutput),
            modelLimits: { maxContextTokens: 128_000, maxOutputTokens, safetyMarginFactor: 1.2 },
            profileId,
          },
        }

        const clock = { nowMs: () => Date.now() }
        const random = { next: () => Math.random() }
        const sleep = { sleep: (ms: number) => Bun.sleep(ms) }
        const ids = createIdGenerator(systemIdSources)
        const cancellation: import("@harness/protocol").CancellationPort = {
          isRequested: async () => false,
          request: async () => ({ kind: "requested" as const }),
        }
        const security = new ProductionSecurityFilter()
        const ingestion: import("@harness/protocol").IngestionPort = {
          ingest: async () => ({
            kind: "narrative_only" as const,
            claim: {
              targetContracts: ["Vault"],
              targetFunctions: ["withdraw"],
              rootCause: "Report narrative analyzed via CLI Judge runner",
              attackScenario: "Attacker executes vulnerability scenario",
              callerAssumptions: [],
              claimedImpact: "Impact claimed in report",
              claimedState: "State affected",
            },
            bceSlices: [],
          }),
        }
        const sanitizer: import("@harness/protocol").SanitizerPort = {
          sanitize: async () => ({ kind: "ok" as const, stitchedTestFile: "", hasSubmitterAssertions: false, antiCheatReport: { rulesChecked: [], findings: [] } }),
          injectStateProbes: async () => ({ probedTestFile: "" }),
        }
        const sandbox: import("@harness/protocol").SandboxPort = {
          runSingleShot: async () => ({ outcome: "passed" as const, exitCode: 0, trace: "", durationMs: 0 }),
          runStateProbe: async () => ({ outcome: "passed" as const, exitCode: 0, trace: "", durationMs: 0, observedBefore: null, observedAfter: null, stateDeltas: [] }),
        }

        let judgeGateway = gateway
        if (parsed.mock) {
          const validVerdictJson = JSON.stringify({
            runId,
            findingId,
            validity: "unverified",
            verificationStatus: "UNVERIFIED",
            confidence: "MEDIUM",
            reasonCode: "UNRESOLVED",
            summary: "Evaluated finding via mock Judge runner.",
            reasoning: "The finding narrative was parsed and evaluated; BCE status is incomplete so status remains UNVERIFIED.",
            citesEvidence: [{ filePath: snapshotFiles[0] ?? "README.md", startLine: 1, endLine: 5, explanation: "Cited reference" }],
          })
          judgeGateway = new ScriptedModelGateway([
            textResponse("acknowledged"),
            textResponse('{"reachability":"incomplete","explanation":"insufficient evidence"}'),
            textResponse('{"reconstruction":"incomplete","explanation":"insufficient evidence"}'),
            textResponse(validVerdictJson, { usage: { promptTokens: 30, completionTokens: 40, totalTokens: 70, costUsd: 0.0002 } }),
          ])
        }

        const runner = new JudgeRunner({
          store,
          gateway: judgeGateway,
          tools: registry,
          snapshot,
          contextEngine: new PassThroughContextEngine(),
          security,
          ingestion,
          sanitizer,
          sandbox,
          cancellation,
          clock,
          random,
          sleep,
          ids,
        })

        if ("admit" in store && typeof store.admit === "function") {
          await store.admit({
            runId,
            findingId,
            reportMarkdown: findingMarkdown,
            snapshotId: parsed.snapshot,
            config: judgeInput.config as unknown as Record<string, unknown>,
            idempotencyKey: `cli-judge-${runId}`,
            requestDigest: `sha256:${runId}`,
          })
        } else if ("seedRun" in store && typeof store.seedRun === "function") {
          await store.seedRun(runId, "queued", findingMarkdown)
        }

        const claimRes = await store.claim({ runId, workerId: "cli-judge-worker" })
        if (claimRes.kind !== "claimed") {
          stderr(`Error: Failed to claim Judge run (${claimRes.kind}).`)
          return 1
        }

        const judgeResult = await runner.run(claimRes.claim, judgeInput)
        const verdict = judgeResult.kind === "committed" && judgeResult.state === "completed" ? judgeResult.verdict : undefined
        const judgeState = judgeResult.kind === "committed" ? judgeResult.state : "failed"

        const output = [
          "========================================",
          "Judge Run Summary",
          "========================================",
          `Run ID:       ${runId}`,
          `Finding ID:   ${findingId}`,
          `Snapshot ID:  ${parsed.snapshot}`,
          `State:        ${judgeState}`,
          ...(judgeResult.kind === "committed" && judgeResult.terminalReason ? [`Terminal:     ${judgeResult.terminalReason}`] : []),
          ...(verdict
            ? [
                "----------------------------------------",
                "Judge Verdict:",
                `  Validity:          ${verdict.validity}`,
                `  Status:            ${verdict.verificationStatus}`,
                `  Confidence:        ${verdict.confidence}`,
                `  Reason Code:       ${verdict.reasonCode}`,
                `  Summary:           ${verdict.summary}`,
                `  Reasoning:         ${verdict.reasoning}`,
                "  Cites Evidence:",
                ...(verdict.citesEvidence.length === 0
                  ? ["    (none)"]
                  : verdict.citesEvidence.map((c) => `    - ${c.filePath}:${c.startLine}-${c.endLine}${c.contentDigest ? ` (digest: ${c.contentDigest})` : ""}`)),
              ]
            : []),
          "========================================",
        ].join("\n")
        stdout(redactSecrets(output, secrets))
        return judgeState === "completed" ? 0 : 1
      }

      const promptText = prompt ?? ""
      const controller = new AbortController()
      const signals = deps.processSignals ?? process
      const onSigint = () => controller.abort("SIGINT")
      signals.on("SIGINT", onSigint)
      const wasInterrupted = () => controller.signal.aborted
      let result: Awaited<ReturnType<MultiTurnRunner["execute"]>>
      try {
        result = await new MultiTurnRunner({
          store,
          gateway,
          registry,
          snapshot,
          contextEngine: parsed.mock
            ? new PassThroughContextEngine()
            : new ProductionContextEngine(createO200kTokenizer()),
          secrets,
        }).execute({
          prompt: promptText,
          snapshotId: parsed.snapshot,
          profileId,
          pricing: profilePricing,
          providerProfile: {
            outputTokensField: effectiveConfig?.modelOutputTokensField ?? "max_tokens",
            ...(effectiveConfig?.modelMaxContextTokens !== undefined ? { maxContextTokens: effectiveConfig.modelMaxContextTokens } : {}),
            maxOutputTokens: effectiveConfig?.modelMaxOutputTokens ?? maxOutputTokens,
            ...(inputPrice !== undefined ? { inputCostPerMTok: inputPrice } : {}),
            ...(outputPrice !== undefined ? { outputCostPerMTok: outputPrice } : {}),
          },
          limits,
          maxOutputTokens,
          secrets,
          signal: controller.signal,
        })
      } finally {
        signals.off("SIGINT", onSigint)
      }
      if (wasInterrupted()) stderr("Run cancelled by Ctrl+C.")
      const usagePricing = result.usage.pricing ?? profilePricing
      const output = [
        "========================================",
        "Multi-turn Run Summary",
        "========================================",
        `Run ID:       ${result.runId}`,
        `State:        ${result.state}`,
        `Terminal:     ${result.terminalReason ?? "-"}`,
        `Snapshot ID:  ${parsed.snapshot}`,
        `Steps:        ${result.stepsExecuted}`,
        `Tool calls:   ${result.toolCallsExecuted}`,
        `Tokens:       ${result.usage.totalTokens} (prompt ${result.usage.promptTokens}, ` +
          `completion ${result.usage.completionTokens})`,
        `Cost:         ${usagePricing === "unpriced" ? "unknown" : `$${result.usage.costUsd.toFixed(6)} USD`}`,
        `Observed:     ${JSON.stringify(result.observedLimits)}`,
        ...(result.outputTruncated ? ["Output truncated: true"] : []),
        "----------------------------------------",
        "Model Output:",
        redactSecrets(result.output ?? result.error ?? "", secrets),
        "========================================",
      ].join("\n")
      stdout(redactSecrets(output, secrets))
      return result.state === "completed" ? 0 : 1
    }

    if (parsed.mock) {
      store = new InMemoryRunStore({ clock: { nowMs: () => Date.now() } })
      const result = await executeRunCommand(
        { prompt, model: parsed.model, timeout: parsed.timeout, maxOutputTokens: maxOutputTokensOverride.value },
        {
          store,
          gateway: new ScriptedModelGateway([textResponse("Hello from Harness CLI mock runner.", {
            usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40, costUsd: 0.0001 },
          })]),
        },
      )
      const write = result.exitCode === 0 ? stdout : stderr
      write(redactSecrets(result.output, secrets))
      return result.exitCode
    }

    if (!config) throw new ConfigValidationError("Invalid runtime configuration:\n  MODEL_API_KEY: required")
    store = deps.storeFactory ? deps.storeFactory(config) : new PostgresRunStore({ url: config.databaseUrl })
    const modelConfig = {
      ...config,
      modelName: parsed.model ?? config.modelName,
      modelTimeoutMs: timeoutOverride.value ?? config.modelTimeoutMs,
    }
    const gateway = deps.gatewayFactory ? deps.gatewayFactory(modelConfig) : createRealGateway(modelConfig, secrets)
    const pricing = priceUsage(
      modelConfig.modelName,
      { promptTokens: 0, completionTokens: 0 },
      pricingOverrideFor(modelConfig),
    ).pricing
    if (pricing === "unpriced") {
      stdout(redactSecrets(`Warning: cost is unknown for model ${modelConfig.modelName}.`, secrets))
    }
    const result = await executeRunCommand(
      {
        prompt,
        model: modelConfig.modelName,
        timeout: String(modelConfig.modelTimeoutMs),
        maxOutputTokens: maxOutputTokensOverride.value,
      },
      { config: modelConfig, store, gateway, secrets, pricing },
    )
    const write = result.exitCode === 0 ? stdout : stderr
    write(redactSecrets(result.output, secrets))
    return result.exitCode
  } catch (error) {
    stderr(`Error: ${safeError(error, secrets)}`)
    return 1
  } finally {
    await closeStore(store)
  }
}

async function viewCommand(
  parsed: CliParsedArgs,
  deps: RunCliDependencies,
  env: Record<string, string | undefined>,
  stdout: CliWriter,
  stderr: CliWriter,
  secrets: string[],
): Promise<number> {
  let store: CliStore | undefined
  try {
    if (parsed.mock) {
      store = new InMemoryRunStore({ clock: { nowMs: () => Date.now() } })
    } else if (deps.storeFactory) {
      const config = loadCliConfig(env, deps.snapshotDir)
      store = deps.storeFactory(config)
    } else {
      if (!env.DATABASE_URL) {
        stderr("Error: DATABASE_URL is required to inspect persistent runs. Use --mock for in-memory testing.")
        return 1
      }
      store = new PostgresRunStore({ url: env.DATABASE_URL })
    }
    const result = await executeViewCommand({ id: parsed.id, json: parsed.json }, { store, secrets })
    const write = result.exitCode === 0 ? stdout : stderr
    write(redactSecrets(result.output, secrets))
    return result.exitCode
  } catch (error) {
    stderr(`Error: ${safeError(error, secrets)}`)
    return 1
  } finally {
    await closeStore(store)
  }
}

async function closeStore(store: CliStore | undefined): Promise<void> {
  if (typeof store?.close !== "function") return
  try {
    await Promise.resolve(store.close())
  } catch {
    // Preserve the command result if cleanup itself fails.
  }
}

function loadCliConfig(env: Record<string, string | undefined>, snapshotDir?: string): RuntimeConfig {
  const configuredSnapshotDir = snapshotDir ?? env.HARNESS_SNAPSHOT_DIR
  const configEnv = configuredSnapshotDir ? { ...env, HARNESS_SNAPSHOT_DIR: configuredSnapshotDir } : env
  return loadRuntimeConfig(configEnv)
}

function resolveSnapshotStorageDir(env: Record<string, string | undefined>, override?: string): string {
  const configured = override ?? env.HARNESS_SNAPSHOT_DIR?.trim()
  return configured || resolve(findRepositoryRoot(), "data", "snapshots")
}

function createRealGateway(config: RuntimeConfig, secrets: string[]): RealModelGateway {
  return new RealModelGateway({
    apiKey: config.modelApiKey,
    model: config.modelName,
    outputTokensField: config.modelOutputTokensField,
    inputCostPerMTok: config.modelInputCostPerMTok,
    outputCostPerMTok: config.modelOutputCostPerMTok,
    baseURL: config.modelBaseUrl,
    timeoutMs: config.modelTimeoutMs,
    secrets,
  })
}

function pricingOverrideFor(config: RuntimeConfig) {
  return config.modelInputCostPerMTok !== undefined && config.modelOutputCostPerMTok !== undefined
    ? { inputCostPerMTok: config.modelInputCostPerMTok, outputCostPerMTok: config.modelOutputCostPerMTok }
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

interface LimitResult {
  value?: number
  error?: string
}

interface ResolvedLimit {
  value: number
  error?: string
}

function parseLimit(
  value: string | undefined,
  flag: string,
  kind: "positiveInteger" | "nonNegativeNumber",
): LimitResult {
  if (value === undefined) return {}
  const parsed = Number(value)
  const valid = Number.isFinite(parsed) &&
    (kind === "positiveInteger" ? Number.isInteger(parsed) && parsed > 0 : parsed >= 0)
  return valid
    ? { value: parsed }
    : { error: `${flag} must be a ${kind === "positiveInteger" ? "positive integer" : "non-negative number"}.` }
}

function resolveLimit(
  flagValue: string | undefined,
  envValue: number | undefined,
  defaultValue: number,
  flag: string,
  kind: "positiveInteger" | "nonNegativeNumber",
): ResolvedLimit {
  const parsed = parseLimit(flagValue, flag, kind)
  return { value: parsed.value ?? envValue ?? defaultValue, ...(parsed.error ? { error: parsed.error } : {}) }
}

function safeError(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : String(error)
  return redactSecrets(message, secrets)
}

// Auto-run if executed directly via CLI.
if (import.meta.main) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code)
  })
}
