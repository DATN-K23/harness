import { createKeychainCredentialProvider, type KeychainCredentialProvider } from "./keychain-credential"
import { startLocalRuntime } from "./local-runtime"

export interface JudgeServerStartupOptions<T> {
  hostname: string
  port: number
  credentialProvider?: KeychainCredentialProvider
  createRuntime(credential: string): { api: { fetch(request: Request): Promise<Response> } }
  listen(hostname: string, port: number, fetch: (request: Request) => Promise<Response>): T
}

export const startJudgeServer = async <T>(options: JudgeServerStartupOptions<T>) => {
  const credential = await (options.credentialProvider ?? createKeychainCredentialProvider()).getOrCreate()
  const runtime = options.createRuntime(credential)
  return startLocalRuntime({
    hostname: options.hostname,
    port: options.port,
    credential,
    fetch: (request) => runtime.api.fetch(request),
    listen: options.listen,
  })
}
