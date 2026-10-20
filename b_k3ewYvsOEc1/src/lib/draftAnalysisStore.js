import { reactive } from 'vue'

export const isActiveAnalysis = (job) => ['queued', 'running'].includes(job?.status)
const terminal = (job) => ['succeeded', 'failed'].includes(job?.status)
const phaseLabels = { queued: '等待分析', retrieving: '正在检索相关资料', analyzing: '正在分析事件材料', saving: '正在保存分析结果' }
export const analysisStepLabel = (job) => phaseLabels[job?.step] || (job?.status === 'failed' ? '分析失败' : '分析已完成')

export function createDraftAnalysisStore({ api, local = globalThis.localStorage, session = globalThis.sessionStorage,
  visible = () => globalThis.document?.visibilityState !== 'hidden', online = () => globalThis.navigator?.onLine !== false,
  schedule = setTimeout, unschedule = clearTimeout, uuid = () => crypto.randomUUID() } = {}) {
  const state = reactive({
    userId: '', jobs: {}, selectedEventId: '', workspace: 'report', composer: '',
    pending: null, submitting: false, connectionLost: false, submitError: '', notice: null, initialized: false,
    readJobs: [], accepted: null,
  })
  let generation = 0, timer = null, refreshing = false, disposed = false, submitPromise = null
  const key = (suffix) => `hermes.draft-analysis.${state.userId}.${suffix}`
  const read = (storage, name, fallback) => { try { return JSON.parse(storage?.getItem(name) || 'null') ?? fallback } catch { return fallback } }
  const write = (storage, name, value) => { try { storage?.setItem(name, JSON.stringify(value)) } catch { /* Storage is optional; the server owns task state. */ } }
  const remove = (storage, name) => { try { storage?.removeItem(name) } catch {} }
  const current = (version) => !disposed && version === generation && !!state.userId
  const jobs = () => Object.values(state.jobs).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const activeJob = () => jobs().find(isActiveAnalysis) || null
  const jobForEvent = (eventId) => jobs().find(job => job.eventId === eventId) || null
  const stopTimer = () => { if (timer) unschedule(timer); timer = null }
  function persist() {
    if (!state.userId) return
    write(local, key('view'), { eventId: state.selectedEventId, workspace: state.workspace })
    write(local, key('tracked'), jobs().filter(isActiveAnalysis).map(job => job.jobId))
  }
  function markRead(job) {
    if (!job || !terminal(job)) return
    state.readJobs = [...new Set([...state.readJobs, job.jobId])].slice(-100)
    write(local, key('read'), state.readJobs)
    const seen = read(local, key('seen'), [])
    write(local, key('seen'), [...new Set([...seen, job.jobId])].slice(-100))
    if (state.notice?.jobId === job.jobId) state.notice = null
  }
  function merge(job, notify = true, tracked = []) {
    if (!job) return
    const previous = state.jobs[job.jobId]
    if (terminal(previous) && !terminal(job)) return
    if (JSON.stringify(previous) === JSON.stringify(job)) {
      if (state.workspace === 'draft' && state.selectedEventId === job.eventId) markRead(job)
      return
    }
    state.jobs[job.jobId] = job
    const watching = state.workspace === 'draft' && state.selectedEventId === job.eventId
    if (watching) markRead(job)
    else if (notify && terminal(job) && (isActiveAnalysis(previous) || tracked.includes(job.jobId))
      && !read(local, key('seen'), []).includes(job.jobId)) {
      state.notice = job
      write(local, key('seen'), [...read(local, key('seen'), []), job.jobId].slice(-100))
    }
  }
  function planNext() {
    stopTimer()
    if (!state.userId || !visible() || !online() || disposed) return
    if (!activeJob() && !state.pending && !state.connectionLost) return
    timer = schedule(() => { void refresh() }, state.workspace === 'draft' && state.selectedEventId === activeJob()?.eventId ? 2000 : 5000)
  }
  async function sendPending(version) {
    const pending = state.pending
    if (!pending || !current(version)) return null
    const result = await api.list(pending.clientRequestId)
    if (!current(version) || state.pending?.clientRequestId !== pending.clientRequestId) return null
    let job = result.items?.[0]
    if (!job) {
      const saved = read(session, key('pending-input'), null)
      if (!saved || saved.clientRequestId !== pending.clientRequestId) {
        state.pending = null
        remove(session, key('pending'))
        state.submitError = '未找到已受理的分析记录，请重新填写材料。'
        return null
      }
      job = pending.retryJobId
        ? await api.retry(pending.retryJobId, pending.clientRequestId)
        : await api.submit({ ...saved.payload, clientRequestId: pending.clientRequestId })
    }
    if (!current(version) || state.pending?.clientRequestId !== pending.clientRequestId) return null
    merge(job, true, [job.jobId])
    state.accepted = { clientRequestId: pending.clientRequestId, eventId: job.eventId }
    state.pending = null
    remove(session, key('pending'))
    remove(session, key('pending-input'))
    persist()
    return job
  }
  function handleSubmitError(error) {
    const status = Number(error?.status)
    const data = error?.data || {}
    if (status === 401) { logout(); return }
    if (status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
      if (data.job) merge(data.job, false)
      state.submitError = error.message || '提交失败，请检查材料'
      state.pending = null
      remove(session, key('pending'))
      remove(session, key('pending-input'))
    } else state.connectionLost = true
  }
  async function refresh() {
    if (!visible() || !online()) {
      stopTimer()
      if (!online() && state.userId) state.connectionLost = true
      return
    }
    if (refreshing || !state.userId || disposed) return
    const version = generation
    refreshing = true
    const tracked = read(local, key('tracked'), [])
    try {
      const result = await api.list()
      if (!current(version)) return
      for (const job of result.items || []) merge(job, true, tracked)
      if (state.pending && !state.submitting) await sendPending(version)
      if (current(version)) { state.connectionLost = false; state.initialized = true; persist() }
    } catch (error) {
      if (current(version)) {
        if (Number(error?.status) === 401) logout()
        else { state.connectionLost = true; if (state.pending) handleSubmitError(error) }
      }
    } finally {
      if (current(version)) { refreshing = false; planNext() }
    }
  }
  async function submit(payload, retryJobId = '') {
    if (submitPromise) return submitPromise
    if (!state.userId) return null
    if (state.pending || activeJob()) {
      state.submitError = '已有一条事件分析正在进行，请返回该任务查看。'
      return null
    }
    const version = generation
    const clientRequestId = uuid()
    state.pending = { clientRequestId, retryJobId }
    state.submitting = true
    state.submitError = ''
    write(session, key('pending'), state.pending)
    write(session, key('pending-input'), { clientRequestId, payload })
    submitPromise = (async () => {
      try {
        const job = await (retryJobId ? api.retry(retryJobId, clientRequestId) : api.submit({ ...payload, clientRequestId }))
        if (!current(version)) return null
        merge(job, false)
        state.pending = null
        state.connectionLost = false
        remove(session, key('pending'))
        remove(session, key('pending-input'))
        persist()
        return job
      } catch (error) {
        if (current(version)) handleSubmitError(error)
        return null
      } finally {
        if (current(version)) { state.submitting = false; submitPromise = null; planNext() }
      }
    })()
    return submitPromise
  }
  function setAccount(userId) {
    if ((userId || '') === state.userId) return
    generation++
    stopTimer()
    refreshing = false
    submitPromise = null
    Object.assign(state, { userId: userId || '', jobs: {}, selectedEventId: '', composer: '', pending: null,
      submitting: false, submitError: '', connectionLost: false, notice: null, initialized: false, workspace: 'report',
      readJobs: [], accepted: null })
    if (!userId) return
    const view = read(local, key('view'), {})
    state.selectedEventId = view.eventId || ''
    state.workspace = view.workspace || 'report'
    state.composer = read(session, key('composer'), '')
    state.pending = read(session, key('pending'), null)
    state.readJobs = read(local, key('read'), [])
    void refresh()
  }
  function selectEvent(eventId) {
    state.selectedEventId = eventId || ''
    markRead(jobForEvent(eventId))
    persist()
    planNext()
  }
  function setWorkspace(workspace) { state.workspace = workspace; markRead(workspace === 'draft' ? jobForEvent(state.selectedEventId) : null); persist(); planNext() }
  function setComposer(text) { state.composer = text; if (state.userId) write(session, key('composer'), text) }
  function logout() {
    if (state.userId) { remove(session, key('composer')); remove(session, key('pending-input')); remove(session, key('pending')) }
    setAccount('')
  }
  function dispose() { disposed = true; generation++; stopTimer() }
  return { state, activeJob, jobForEvent, submit, refresh, setAccount, selectEvent, setWorkspace, setComposer, markRead, logout, dispose }
}
