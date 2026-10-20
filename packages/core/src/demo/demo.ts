import { join } from "node:path"
import type { JudgeRunResult } from "../runner/judge-runner"
import { renderBundle, writeBundle } from "./bundle"
import { checkRunInvariants } from "./invariants"
import { demoScenarios } from "./scenarios"
import { runScenario } from "./world"

export const DemoSeed = 20261011

export const DefaultOutputDir = join(import.meta.dir, "..", "..", "demo-output")

export interface DemoRow {
  scenario: string
  state: string
  reason: string
  steps: number
  tokens: number
  costUsd: number
  directory: string
}

const reasonOf = (result: JudgeRunResult) => {
  if (result.kind !== "committed") return result.kind
  return result.verdict?.reasonCode ?? result.terminalReason ?? result.state
}

/** Runs the offline judge scenarios and writes one seven-pillar bundle per scenario under `outputDir`. */
export const runDemo = async (outputDir = DefaultOutputDir): Promise<DemoRow[]> => {
  const rows: DemoRow[] = []
  for (const [index, spec] of demoScenarios.entries()) {
    const run = await runScenario(spec, { seed: DemoSeed + index, runId: `demo-${spec.name}` })
    if (run.result === undefined) throw new Error(`scenario ${spec.name} rejected: ${run.rejection}`)
    const { result } = run
    const directory = join(outputDir, spec.name)
    writeBundle(
      directory,
      renderBundle({
        scenario: spec.name,
        result,
        events: run.events,
        streamed: run.streamed,
        stages: run.stages,
        invariants: checkRunInvariants(run),
      }),
    )
    rows.push({
      scenario: spec.name,
      state: result.kind === "committed" ? result.state : result.kind,
      reason: reasonOf(result),
      steps: result.lastStepIndex,
      tokens: result.usage.totalTokens,
      costUsd: result.usage.costUsd,
      directory,
    })
  }
  return rows
}

const columns = ["scenario", "state", "reason", "steps", "tokens", "cost (USD)"] as const

export const formatSummary = (rows: readonly DemoRow[]) => {
  const cells = rows.map((row) => [
    row.scenario,
    row.state,
    row.reason,
    String(row.steps),
    String(row.tokens),
    row.costUsd.toFixed(4),
  ])
  const widths = columns.map((name, index) => Math.max(name.length, ...cells.map((row) => row[index].length)))
  const line = (row: readonly string[]) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ")
  return [line(columns), line(widths.map((width) => "-".repeat(width))), ...cells.map(line)].join("\n")
}
