import { createProductionHealthHandler } from "./production-runtime"
import { isLoopbackHost } from "./runtime-security"

export interface CheckedStartupOperations<T> {
  checkSnapshot(): Promise<void>
  pingDatabase(): Promise<void>
  getCredential(): Promise<string>
  listen(hostname: string, port: number, fetch: (request: Request) => Promise<Response>, credential: string): T
}

/** Internal orchestration seam; production supplies fixed system operations, tests inject failures. */
export const startCheckedLocalServer = async <T extends { stop?: () => void | Promise<void> }>(
  options: { hostname: string; port: number },
  operations: CheckedStartupOperations<T>,
) => {
  if (!isLoopbackHost(options.hostname)) throw new Error("Server must bind to loopback")
  await operations.checkSnapshot()
  await operations.pingDatabase()
  const credential = await operations.getCredential()
  const fetch = createProductionHealthHandler(credential)
  const listener = operations.listen(options.hostname, options.port, fetch, credential)
  return { listener, fetch, async stop() { await listener.stop?.() } }
}
