import { runStress, writeReliabilityReport } from "./reliability"

const report = await runStress()
const path = writeReliabilityReport(report)
console.log(
  `${report.crashFreeRuns}/${report.totalRuns} runs crash-free, ${report.invariantViolations} invariant violations, ` +
    `${report.unhandledErrors.length} unhandled errors (base seed ${report.baseSeed}, last ${report.concurrentBatch.size} runs concurrent)`,
)
console.log(`Terminal states: ${JSON.stringify(report.terminalDistribution)}`)
console.log(`Report written to ${path}`)
if (report.crashFreeRuns !== report.totalRuns || report.unhandledErrors.length > 0) process.exit(1)
