// Local-only controlled API for exercising the real Vue application without model calls.
import express from 'express'
import { randomUUID } from 'node:crypto'
import { createServer } from '../../b_k3ewYvsOEc1/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'

const app = express()
app.use(express.json())
const user = { id: 'draft-ui-one', username: 'draft-test', displayName: '拟稿交互测试', role: 'admin', roles: ['admin'],
  modules: ['report', 'qa', 'daily', 'draft'], permissions: ['report:create', 'report:read', 'draft:read', 'draft:create', 'daily-awareness:view'] }
const jobs = []
const history = [{ eventId: 'history-B', title: '历史 B：已完成事件分析', createdAt: new Date().toISOString() }]
const results = { 'history-B': { event: { eventId: 'history-B', title: history[0].title, rawInput: { materials: '历史 B 的原始材料，与任务 A 独立。' },
  analysis: { oneSentenceSummary: '历史 B 的已保存分析结果。', mainFacts: ['历史 B 的已保存事实。'] } }, sources: [], latestOutline: null } }
app.post('/__test__/finish', (req, res) => {
  const job = jobs.find(j => j.status === 'running')
  if (job) {
    job.status = req.body.failed ? 'failed' : 'succeeded'
    job.step = 'completed'
    job.completedAt = new Date().toISOString()
    job.errorMessage = req.body.failed ? '受控分析失败，请重试分析。' : null
    if (!req.body.failed) results[job.eventId].event.analysis = { oneSentenceSummary: '任务 A 的已保存分析结果。', mainFacts: ['任务 A 的受控事实。'] }
  }
  res.json({ ok: true })
})
app.get('/__test__/counts', (_req, res) => res.json({ jobs: jobs.length, history: history.length }))
app.post('/api/auth/login', (_req, res) => res.json({ access_token: 'local-controlled-session', user }))
app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }))
app.get('/api/auth/me', (_req, res) => res.json(user))
app.get('/api/draft-assistant/events', (_req, res) => res.json({ items: history.map(e => ({ ...e, analysisJob: jobs.find(j => j.eventId === e.eventId) })), total: history.length }))
app.get('/api/draft-assistant/events/:id', (req, res) => res.json({ ...results[req.params.id], analysisJob: jobs.find(j => j.eventId === req.params.id) }))
app.get('/api/draft-assistant/analysis-jobs', (req, res) => res.json({ items: jobs.filter(j => !req.query.clientRequestId || j.clientRequestId === req.query.clientRequestId) }))
app.post('/api/draft-assistant/analysis-jobs', (req, res) => {
  const duplicate = jobs.find(j => j.clientRequestId === req.body.clientRequestId)
  if (duplicate) return res.status(202).json(duplicate)
  const active = jobs.find(j => j.status === 'running')
  if (active) return res.status(409).json({ error: '已有分析任务', job: active })
  const eventId = randomUUID()
  const job = { jobId: randomUUID(), eventId, clientRequestId: req.body.clientRequestId, status: 'running', step: 'analyzing',
    createdAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 120000).toISOString() }
  jobs.unshift(job)
  history.unshift({ eventId, title: req.body.title, createdAt: job.createdAt })
  results[eventId] = { event: { eventId, title: req.body.title, rawInput: req.body, analysis: {} }, sources: [], latestOutline: null }
  res.status(202).json(job)
})
app.use('/api', (req, res) => {
  if (req.method !== 'GET') return res.status(400).json({ error: '受控浏览器测试不执行其他业务操作' })
  if (req.path.includes('health')) return res.json({ ok: true, status: 'ready' })
  if (req.path.includes('vector-sources/status')) return res.json({ enabled: true, available: true })
  return res.json({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 })
})
const vite = await createServer({
  root: fileURLToPath(new URL('../../b_k3ewYvsOEc1', import.meta.url)),
  server: { middlewareMode: true }, define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') },
})
app.use(vite.middlewares)
const server = app.listen(4186, '127.0.0.1', () => console.log('Controlled draft UI: http://127.0.0.1:4186'))
async function close() { server.close(); await vite.close(); process.exit(0) }
process.on('SIGTERM', close)
process.on('SIGINT', close)
