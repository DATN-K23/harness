export const startPollingWorker = (
  runOnce: () => Promise<unknown>,
  intervalMs = 250,
  shutdownTimeoutMs = 5_000,
  onStopped: () => void | Promise<void> = () => {},
) => {
  let stopping = false
  let cleanupStarted = false
  let active: Promise<unknown> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let wake: (() => void) | undefined
  let shutdown: Promise<void> | undefined
  const done = (async () => {
    while (!stopping) {
      try { active = runOnce(); await active } catch {}
      active = undefined
      if (!stopping) await new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, intervalMs) })
    }
  })()
  return {
    stop() {
      if (!shutdown) shutdown = (async () => {
        stopping = true
        if (timer) clearTimeout(timer)
        wake?.()
        let timeout: ReturnType<typeof setTimeout> | undefined
        const settled = await Promise.race([
          done.then(() => true),
          new Promise<false>((resolve) => { timeout = setTimeout(() => resolve(false), shutdownTimeoutMs) }),
        ])
        if (timeout) clearTimeout(timeout)
        const cleanup = async () => { if (cleanupStarted) return; cleanupStarted = true; await onStopped() }
        if (settled) await cleanup()
        else void done.then(cleanup)
      })()
      return shutdown
    },
  }
}
