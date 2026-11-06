import { parentPort } from "node:worker_threads"

interface GrepScanFile {
  path: string
  lines: string[]
}

interface GrepWorkerRequest {
  pattern: string
  files: GrepScanFile[]
  maxMatches: number
}

interface GrepWorkerResponse {
  matches: { path: string; lineNumber: number; line: string }[]
  truncated: boolean
}

parentPort?.on("message", (request: GrepWorkerRequest) => {
  const matcher = new RegExp(request.pattern)
  const matches: GrepWorkerResponse["matches"] = []
  let truncated = false

  outer: for (const file of request.files) {
    for (let index = 0; index < file.lines.length; index++) {
      const line = file.lines[index]!
      if (!matcher.test(line)) continue
      if (matches.length >= request.maxMatches) {
        truncated = true
        break outer
      }
      matches.push({ path: file.path, lineNumber: index + 1, line })
    }
  }

  parentPort?.postMessage({ matches, truncated } satisfies GrepWorkerResponse)
})
