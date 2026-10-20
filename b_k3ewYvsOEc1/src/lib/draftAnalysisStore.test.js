import test from 'node:test'
import assert from 'node:assert/strict'
import { createDraftAnalysisStore } from './draftAnalysisStore.js'

const storage = () => {
  const values = new Map()
  return { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const job = (status = 'running', id = 'A') => ({
  jobId: id, eventId: `event-${id}`, clientRequestId: 'request-1', status, step: 'analyzing', createdAt: '2026-10-20T00:00:00Z',
})
function setup(t, options = {}) {
  let rows = [], visible = true, online = true, count = 0
  const timers = new Map()
  const api = { list: async key => ({ items: rows.filter(row => !key || row.clientRequestId === key) }),
    submit: async () => { rows = [job()]; return rows[0] }, retry: async () => job('queued', 'retry'), ...options.api }
  const store = createDraftAnalysisStore({ api, local: storage(), session: storage(), uuid: () => `request-${++count}`,
    visible: () => visible, online: () => online, schedule: (fn, ms) => { timers.set(fn, ms); return fn },
    unschedule: fn => timers.delete(fn), ...options, api })
  t.after(() => store.dispose())
  store.setAccount('one')
  return { store, timers, rows: value => { rows = value }, visible: value => { visible = value }, online: value => { online = value } }
}

test('submission is single-flight and completion never changes selection or another composer', async t => {
  const pending = deferred()
  let calls = 0
  const s = setup(t, { api: { submit: () => { calls++; return pending.promise } } })
  await settle()
  const first = s.store.submit({ title: 'A' })
  const second = s.store.submit({ title: 'A' })
  s.store.selectEvent('event-B')
  s.store.setComposer('Material B')
  pending.resolve(job())
  await Promise.all([first, second])
  assert.equal(calls, 1)
  s.rows([job('succeeded')])
  await s.store.refresh()
  assert.equal(s.store.state.selectedEventId, 'event-B')
  assert.equal(s.store.state.composer, 'Material B')
  assert.equal(s.store.state.notice.jobId, 'A')
  s.store.state.notice = null
  await s.store.refresh()
  assert.equal(s.store.state.notice, null)
  assert.equal(s.timers.size, 0)
})

test('lost submission response is reconciled by the original key without another submission', async t => {
  let calls = 0
  const s = setup(t, { api: { submit: async () => { calls++; throw new Error('disconnected') } } })
  await settle()
  await s.store.submit({ title: 'A' })
  assert.equal(s.store.state.pending.clientRequestId, 'request-1')
  assert.equal(s.store.state.connectionLost, true)
  s.rows([job()])
  await s.store.refresh()
  assert.equal(calls, 1)
  assert.equal(s.store.state.pending, null)
  assert.equal(s.store.state.accepted.eventId, 'event-A')
  assert.equal(s.store.state.connectionLost, false)
})

test('ambiguous submission survives refresh and reuses its key if not accepted', async t => {
  const local = storage(), session = storage()
  const a = setup(t, { local, session, api: { submit: async () => { throw new Error('offline') } } })
  await settle()
  a.store.setComposer('retained materials')
  await a.store.submit({ title: 'A' })
  a.store.dispose()
  const keys = []
  const b = setup(t, { local, session, api: { submit: async input => { keys.push(input.clientRequestId); return job() } } })
  await settle()
  assert.deepEqual(keys, ['request-1'])
  assert.equal(b.store.state.composer, 'retained materials')
  assert.equal(b.store.activeJob().jobId, 'A')
})

test('task recovery after closing a tab only reads saved results, never starts a model call', async t => {
  const local = storage()
  const a = setup(t, { local })
  await settle()
  await a.store.submit({ title: 'A' })
  a.store.selectEvent('event-A')
  a.store.setWorkspace('draft')
  a.store.dispose()
  let calls = 0
  const b = setup(t, { local, api: { list: async () => ({ items: [job('succeeded')] }), submit: async () => { calls++ } } })
  await settle()
  assert.equal(calls, 0)
  assert.equal(b.store.state.selectedEventId, 'event-A')
  assert.equal(b.store.state.workspace, 'draft')
  assert.equal(b.store.jobForEvent('event-A').status, 'succeeded')
  assert.equal(b.store.state.notice, null)
})

test('poll interval is 2s in the selected task, 5s elsewhere, paused when hidden or offline', async t => {
  const s = setup(t)
  await settle()
  await s.store.submit({ title: 'A' })
  assert.deepEqual([...s.timers.values()], [5000])
  s.store.selectEvent('event-A')
  s.store.setWorkspace('draft')
  assert.deepEqual([...s.timers.values()], [2000])
  s.visible(false)
  await s.store.refresh()
  assert.equal(s.timers.size, 0)
  s.visible(true)
  s.online(false)
  await s.store.refresh()
  assert.equal(s.store.state.connectionLost, true)
  assert.equal(s.store.activeJob().status, 'running')
  s.online(true)
  await s.store.refresh()
  assert.equal(s.store.state.connectionLost, false)
})

test('logout and account switches fence late results and clear old account content', async t => {
  const pending = deferred()
  const s = setup(t, { api: { submit: () => pending.promise } })
  await settle()
  s.store.setComposer('private one')
  const submitted = s.store.submit({ title: 'A' })
  s.store.logout()
  s.store.setAccount('two')
  pending.resolve(job())
  await submitted
  await settle()
  assert.equal(s.store.state.userId, 'two')
  assert.deepEqual(Object.values(s.store.state.jobs), [])
  assert.equal(s.store.state.composer, '')
  s.store.setAccount('one')
  assert.equal(s.store.state.composer, '')
})

test('401 stops polling instead of representing an authentication loss as task failure', async t => {
  const s = setup(t, { api: { list: async () => { throw Object.assign(new Error('expired'), { status: 401 }) } } })
  await settle()
  assert.equal(s.store.state.userId, '')
  assert.equal(s.timers.size, 0)
})

test('409 exposes the existing task; failed retry uses another attempt without creating another event', async t => {
  const s = setup(t, { api: { submit: async () => { throw Object.assign(new Error('active'), { status: 409, data: { job: job() } }) } } })
  await settle()
  await s.store.submit({ title: 'B' })
  assert.equal(s.store.activeJob().eventId, 'event-A')
  assert.equal(s.store.state.pending, null)
  s.rows([job('failed')])
  await s.store.refresh()
  const retried = await s.store.submit({}, 'A')
  assert.equal(retried.jobId, 'retry')
})
