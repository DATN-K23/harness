export const waitForServerShutdown = (
  signals: {
    once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown
    off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown
  },
  stop: () => Promise<void>,
  owner?: AbortSignal,
): Promise<void> => new Promise((resolve, reject) => {
  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    signals.off("SIGINT", shutdown)
    signals.off("SIGTERM", shutdown)
    owner?.removeEventListener("abort", shutdown)
    stop().then(resolve, reject)
  }
  signals.once("SIGINT", shutdown)
  signals.once("SIGTERM", shutdown)
  owner?.addEventListener("abort", shutdown, { once: true })
  if (owner?.aborted) shutdown()
})
