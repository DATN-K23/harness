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
  const done = (async () => {
    while (!stopping) {
      try { active = runOnce(); await active } catch {}
      active = undefined
      if (!stopping) await new Promise<void>((resolve) => { timer = setTimeout(resolve, intervalMs) })
    }
  })()
  return {
    async stop() {
      stopping = true
      if (timer) clearTimeout(timer)
      const settled = await Promise.race([done.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), shutdownTimeoutMs))])
      const cleanup = async () => { if (cleanupStarted) return; cleanupStarted = true; await onStopped() }
      if (settled) await cleanup()
      else void done.then(cleanup)
    },
  }
}
