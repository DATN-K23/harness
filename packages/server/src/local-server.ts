import { isLoopbackHost } from "./runtime-security"

export const listenLocal = <T>(hostname: string, port: number, listen: () => T): T => {
  if (!isLoopbackHost(hostname)) throw new Error("Server must bind to loopback")
  return listen()
}
