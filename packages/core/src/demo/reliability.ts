import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { DefaultOutputDir } from "./demo"
import { checkRunInvariants } from "./invariants"
import { stressScenarios } from "./scenarios"
import { runScenario } from "./world"

export const StressBaseSeed = 20261011
export const StressRuns = 100
export const ConcurrentBatch = 10

export interface ReliabilityReport {
  baseSeed: number
  totalRuns: number
  crashFreeRuns: number
  invariantViolations: number
  violations: Array<{ runId: string; scenario: string; violation: string }>
  concurrentBatch: { size: number; firstRun: number }
  unhandledErrors: string[]
  terminalDistribution: Record<string, number>
  perScenario: Record<string, { runs: number; crashFree: number; terminal: Record<string, number> }>
}

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Runs `runs` scenarios from the fixed seed (index `i` uses kind `i mod kinds` and seed `base + i`); the last
 * `concurrent` of them run together under `Promise.all`. An unhandled rejection or uncaught exception anywhere in
 * between is recorded and fails the report even when every run's own invariants hold.
 */
export const runStress = async (options: { runs?: number; concurrent?: number } = {}): Promise<ReliabilityReport> => {
  const runs = options.runs ?? StressRuns
  const concurrent = options.concurrent ?? ConcurrentBatch
  const unhandledErrors: string[] = []
  const onRejection = (reason: unknown) => unhandledErrors.push(`unhandledRejection: ${describe(reason)}`)
  const onException = (error: unknown) => unhandledErrors.push(`uncaughtException: ${describe(error)}`)
  process.on("unhandledRejection", onRejection)
  process.on("uncaughtException", onException)

  const runOne = async (index: number) => {
    const spec = stressScenarios[index % stressScenarios.length]
    const run = await runScenario(spec, { seed: StressBaseSeed + index, runId: `stress-${index}` })
    return { spec, run, invariants: checkRunInvariants(run) }
  }

  const sequentialRuns = runs - concurrent
  const results = []
  try {
    for (let index = 0; index < sequentialRuns; index += 1) results.push(await runOne(index))
    results.push(...(await Promise.all(Array.from({ length: concurrent }, (_, offset) => runOne(sequentialRuns + offset)))))
    // Let any rejection that nobody handled surface before the listeners are removed.
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off("unhandledRejection", onRejection)
    process.off("uncaughtException", onException)
  }

  const terminalDistribution: Record<string, number> = {}
  const perScenario: ReliabilityReport["perScenario"] = {}
  const violations: ReliabilityReport["violations"] = []
  results.forEach(({ spec, run, invariants }) => {
    const terminal = run.result === undefined ? "rejected" : run.result.kind === "committed" ? run.result.state : run.result.kind
    const entry = (perScenario[spec.name] ??= { runs: 0, crashFree: 0, terminal: {} })
    entry.runs += 1
    entry.crashFree += invariants.crashFree ? 1 : 0
    increment(entry.terminal, terminal)
    increment(terminalDistribution, terminal)
    invariants.violations.forEach((violation) => violations.push({ runId: run.runId, scenario: spec.name, violation }))
  })
  return {
    baseSeed: StressBaseSeed,
    totalRuns: results.length,
    crashFreeRuns: results.filter(({ invariants }) => invariants.crashFree).length,
    invariantViolations: violations.length,
    violations,
    concurrentBatch: { size: concurrent, firstRun: sequentialRuns },
    unhandledErrors,
    terminalDistribution,
    perScenario,
  }
}

export const writeReliabilityReport = (report: ReliabilityReport, outputDir = DefaultOutputDir) => {
  mkdirSync(outputDir, { recursive: true })
  const path = join(outputDir, "reliability-report.json")
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  return path
}
