export function createDraftAutosave({
  save,
  onState = () => {},
  delay = 1200,
  scheduleTimer = setTimeout,
  cancelTimer = clearTimeout,
}) {
  let timer = null
  let pending = null
  let failed = null
  let failureError = null
  let running = null
  let disposed = false

  const setState = (state, error = null) => onState(state, error)

  async function runLoop() {
    while (!disposed && pending !== null) {
      const snapshot = pending
      pending = null
      setState('saving')
      try {
        await save(snapshot)
        failed = null
        failureError = null
        setState(pending === null ? 'saved' : 'dirty')
      } catch (error) {
        failed = snapshot
        failureError = error
        setState('error', error)
        throw error
      }
    }
  }

  function drain() {
    if (disposed) return Promise.resolve()
    if (running) return running
    if (pending === null) return Promise.resolve()
    running = runLoop().finally(() => {
      running = null
    })
    return running
  }

  function clearPendingTimer() {
    if (timer === null) return
    cancelTimer(timer)
    timer = null
  }

  function armTimer() {
    clearPendingTimer()
    timer = scheduleTimer(() => {
      timer = null
      return drain().catch(() => undefined)
    }, delay)
  }

  return {
    schedule(snapshot) {
      if (disposed) return
      pending = snapshot
      failed = null
      failureError = null
      setState('dirty')
      armTimer()
    },

    async flush() {
      clearPendingTimer()
      if (running) await running
      if (pending !== null) await drain()
      if (failureError) throw failureError
    },

    async retry() {
      clearPendingTimer()
      if (pending === null && failed !== null) pending = failed
      failed = null
      failureError = null
      await drain()
    },

    dispose() {
      disposed = true
      clearPendingTimer()
    },
  }
}
