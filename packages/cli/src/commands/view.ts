// Adapted from OpenCode packages/cli/src/commands/view.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { RunStorePort } from "@harness/protocol"
import { getRun, getRunHistory } from "@harness/core"
import { redactSecrets } from "../redaction"

export interface ViewCommandOptions {
  id?: string
  help?: boolean
}

export interface ViewCommandDeps {
  store: RunStorePort
  secrets?: string[]
}

/**
 * Views a persisted run record and its chronological trajectory events.
 */
export async function executeViewCommand(
  options: ViewCommandOptions,
  deps: ViewCommandDeps,
): Promise<{ exitCode: number; output: string }> {
  const runId = options.id?.trim()

  if (!runId) {
    return {
      exitCode: 1,
      output: "Error: --id <runId> is required to view a run.",
    }
  }

  const run = await getRun(runId, deps.store)

  if (!run) {
    return {
      exitCode: 1,
      output: `Error: Run '${runId}' not found in persistent store.`,
    }
  }

  const events = await getRunHistory(runId, deps.store)
  const secrets = deps.secrets ?? []

  const lines = [
    "========================================",
    "Run Inspection Record",
    "========================================",
    `Run ID:       ${run.runId}`,
    `State:        ${run.state}`,
    `Version:      ${run.stateVersion}`,
    ...(run.terminalReason ? [`Terminal:     ${run.terminalReason}`] : []),
    "----------------------------------------",
    `Trajectory Events (${events.length} recorded):`,
  ]

  if (events.length === 0) {
    lines.push("  (no events recorded)")
  } else {
    for (const evt of events) {
      const timeStr = evt.occurredAt
      const payloadStr = JSON.stringify(evt.payload)
      const sanitizedPayload = redactSecrets(payloadStr, secrets)
      lines.push(`  [#${evt.sequence}] ${timeStr} | ${evt.type} | ${sanitizedPayload}`)
    }
  }

  lines.push("========================================")

  return {
    exitCode: 0,
    output: lines.join("\n"),
  }
}
