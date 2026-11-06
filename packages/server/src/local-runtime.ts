import { listenLocal } from "./local-server"
import { isAuthorizedLocalRequest } from "./runtime-security"

export interface LocalRuntimeOptions<T> {
  hostname: string
  port: number
  credential: string | undefined
  listen(hostname: string, port: number, fetch: (request: Request) => Promise<Response>): T
  fetch(request: Request): Promise<Response>
}

export const startLocalRuntime = <T>(options: LocalRuntimeOptions<T>): T => {
  if (!options.credential) throw new Error("Keychain credential unavailable")
  return listenLocal(options.hostname, options.port, () => options.listen(
    options.hostname,
    options.port,
    async (request) => isAuthorizedLocalRequest(request, options.credential!)
      ? options.fetch(request)
      : Response.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 }),
  ))
}
