const LIVE_SOURCE_REFRESH_FAILURE_MESSAGE = '信源加载失败，请稍后重试。'

function isEligible(context) {
  return context.activeTab === 'sources' &&
    Boolean(context.jobId) &&
    ['queued', 'running'].includes(String(context.status || '').toLowerCase())
}

function sameContext(left, right) {
  return left?.activeTab === right.activeTab &&
    left?.jobId === right.jobId &&
    left?.status === right.status
}

export function createLiveSourceRefreshController({
  intervalMs,
  setIntervalFn,
  clearIntervalFn,
  onRefresh,
}) {
  let timerId = null
  let generation = 0
  let context = null

  function clearTimer() {
    if (timerId !== null) clearIntervalFn(timerId)
    timerId = null
  }

  function sync(nextContext) {
    if (!sameContext(context, nextContext)) {
      generation += 1
      clearTimer()
      context = { ...nextContext }
    }

    if (!isEligible(context)) {
      clearTimer()
      return
    }

    if (timerId !== null) return
    const timerGeneration = generation
    timerId = setIntervalFn(() => {
      if (timerGeneration === generation) onRefresh()
    }, intervalMs)
  }

  function stop() {
    clearTimer()
    generation += 1
  }

  async function runRequest({ request, preserveOnError = false, hasExistingRows = false }) {
    const requestGeneration = generation
    try {
      const value = await request()
      if (requestGeneration !== generation) return { kind: 'stale' }
      return { kind: 'success', value }
    } catch (error) {
      if (requestGeneration !== generation) return { kind: 'stale' }
      const preserveExistingRows = preserveOnError && hasExistingRows
      return {
        kind: 'failure',
        error,
        preserveExistingRows,
        errorMessage: preserveExistingRows ? '' : LIVE_SOURCE_REFRESH_FAILURE_MESSAGE,
      }
    }
  }

  return { sync, stop, runRequest }
}
