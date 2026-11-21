import type { LocalExecutionPort, LocalExecutionRequest, LocalExecutionResult } from "../execution"

export class ScriptedLocalExecution implements LocalExecutionPort {
  readonly calls: LocalExecutionRequest[] = []

  constructor(private readonly results: readonly LocalExecutionResult[]) {}

  async run(request: LocalExecutionRequest, signal?: AbortSignal): Promise<LocalExecutionResult> {
    signal?.throwIfAborted()
    const result = this.results[Math.min(this.calls.length, this.results.length - 1)]
    if (result === undefined) throw new Error("ScriptedLocalExecution.run: no result was scripted")
    this.calls.push(structuredClone(request))
    return structuredClone(result)
  }
}
