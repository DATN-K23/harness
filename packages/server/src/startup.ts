import { createKeychainCredentialProvider, type KeychainCredentialProvider } from "./keychain-credential"
import { startLocalRuntime } from "./local-runtime"

export interface JudgeServerStartupOptions<T> {
  hostname: string
  port: number
  credentialProvider?: KeychainCredentialProvider
  createRuntime(credential: string): {
    api: { fetch(request: Request): Promise<Response> }
    worker: { runOnce(): Promise<number> }
  }
  listen(hostname: string, port: number, fetch: (request: Request) => Promise<Response>): T
  runWorker?: boolean
  pollIntervalMs?: number
}

export const startJudgeServer = async <T>(options: JudgeServerStartupOptions<T>) => {
  const credential = await (options.credentialProvider ?? createKeychainCredentialProvider()).getOrCreate()
  const runtime = options.createRuntime(credential)
  const listener = startLocalRuntime({
    hostname: options.hostname,
    port: options.port,
    credential,
    fetch: (request) => runtime.api.fetch(request),
    listen: options.listen,
  })
  let stopped = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  const runWorkerOnce = () => runtime.worker.runOnce()
  const schedule = () => {
    if (stopped || options.runWorker === false) return
    pollTimer = setTimeout(async () => {
      try {
        await runWorkerOnce()
      } catch {
        // A failed claim/dispatch remains in the outbox for its lease-based retry.
      }
      schedule()
    }, options.pollIntervalMs ?? 250)
  }
  schedule()
  return {
    ...listener,
    runWorkerOnce,
    async stop() {
      stopped = true
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      await (listener as { stop?: () => Promise<void> | void }).stop?.()
    },
  }
}
