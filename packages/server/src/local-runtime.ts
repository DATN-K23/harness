import { listenLocal } from "./local-server"
import { isAuthorizedLocalRequest, localAuthenticationRequired, requireLocalServerPassword } from "./runtime-security"

export interface LocalRuntimeOptions<T> {
  hostname: string
  port: number
  credential: string | undefined
  listen(hostname: string, port: number, fetch: (request: Request) => Promise<Response>): T
  fetch(request: Request): Promise<Response>
}

export const startLocalRuntime = <T>(options: LocalRuntimeOptions<T>): T => {
  const password = requireLocalServerPassword(options.credential)
  return listenLocal(options.hostname, options.port, () => options.listen(
    options.hostname,
    options.port,
    async (request) => isAuthorizedLocalRequest(request, password)
      ? options.fetch(request)
      : localAuthenticationRequired(),
  ))
}
