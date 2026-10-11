import { DefaultOutputDir, formatSummary, runDemo } from "./demo"

const rows = await runDemo()
console.log(formatSummary(rows))
console.log(`\nBundles written to ${DefaultOutputDir}`)
