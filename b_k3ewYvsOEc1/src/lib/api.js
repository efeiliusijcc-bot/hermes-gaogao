const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(data?.error || data?.message || data?.details?.[0] || `HTTP ${response.status}`)
  }

  return data
}

export function fetchHermesHealth() {
  return request('/hermes/health')
}

export function fetchResearchKeys() {
  return request('/research-keys')
}

export function updateResearchKeys(body) {
  return request('/research-keys', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function fetchVectorSourceStatus() {
  return request('/vector-sources/status')
}

export function switchVectorSourceProfile(profile) {
  return request('/vector-sources/profile', {
    method: 'POST',
    body: JSON.stringify({ profile }),
  })
}

export function createReportJob(body) {
  return request('/report-jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function createReportPlan(body) {
  return request('/report-plans', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function createChatCompletion(body) {
  return request('/chat/completions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function fetchQaSessionSources(sessionId) {
  return request(`/chat/sessions/${encodeURIComponent(sessionId)}/sources`)
}

export function upsertQaSessionSources(sessionId, body) {
  return request(`/chat/sessions/${encodeURIComponent(sessionId)}/sources`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function fetchReportJobs(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return request(`/report-jobs${suffix}`)
}

export function fetchReportJob(jobId) {
  return request(`/report-jobs/${jobId}`)
}

export function fetchReportJobEventLog(jobId) {
  return request(`/report-jobs/${jobId}/event-log`)
}

export function fetchReportProgress(jobId) {
  return request(`/report-jobs/${jobId}/progress`)
}

export function fetchReportResult(jobId) {
  return request(`/report-jobs/${jobId}/result`)
}

export function fetchReportDatabaseSources(jobId) {
  return request(`/report-jobs/${jobId}/database-sources`)
}

export function fetchReportSources(jobId, type, params = {}) {
  const query = new URLSearchParams()
  if (type) query.set('type', type)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return request(`/report-jobs/${jobId}/sources${suffix}`)
}

export function getDownloadUrl(jobId, format = 'md') {
  return `${API_BASE}/report-jobs/${jobId}/download?format=${format}`
}

export function getJobEventsUrl(jobId) {
  return `${API_BASE}/report-jobs/${jobId}/events`
}

export function getChatStreamUrl(eventsUrl) {
  if (!eventsUrl) return ''
  if (/^https?:\/\//i.test(eventsUrl)) return eventsUrl
  const normalized = eventsUrl.startsWith('/api/') ? eventsUrl.slice(4) : eventsUrl
  return `${API_BASE}${normalized.startsWith('/') ? normalized : `/${normalized}`}`
}
