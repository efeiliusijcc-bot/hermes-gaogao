const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'
export const AUTH_TOKEN_KEY = 'gaogao_access_token'
export const AUTH_USER_KEY = 'gaogao_current_user'

let unauthorizedHandler = null

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

export function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function getStoredAuthUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setAuthSession(token, user) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
    else localStorage.removeItem(AUTH_TOKEN_KEY)
    if (user) localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(AUTH_USER_KEY)
  } catch {
    // Storage is best-effort; API calls still use the in-memory response path.
  }
}

export function clearAuthSession() {
  setAuthSession('', null)
}

export function logout() {
  clearAuthSession()
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null
}

async function request(path, options = {}) {
  const token = getAuthToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }
  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const fallbackMessage = response.status === 403 ? '无权限访问用户管理' : `HTTP ${response.status}`
    const error = new ApiError(data?.error || data?.message || data?.details?.[0] || fallbackMessage, response.status, data)
    if (response.status === 401) {
      clearAuthSession()
      unauthorizedHandler?.(error)
    }
    throw error
  }

  return data
}

export function login(username, password) {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function getCurrentUser() {
  return request('/auth/me')
}

export const loginAuth = (body) => login(body?.username || '', body?.password || '')
export const fetchCurrentUser = getCurrentUser

export function getUsers() {
  return request('/users')
}

export function createUser(payload) {
  return request('/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateUser(id, payload) {
  return request(`/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function resetUserPassword(id, password) {
  return request(`/users/${encodeURIComponent(id)}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  })
}

export function disableUser(id) {
  return request(`/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
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

export function analyzeDraftEvent(payload) {
  return request('/draft-assistant/analyze', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getDraftEvents(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return request(`/draft-assistant/events${suffix}`)
}

export function getDraftEvent(eventId) {
  return request(`/draft-assistant/events/${encodeURIComponent(eventId)}`)
}

export function generateDraftOutline(payload) {
  return request('/draft-assistant/outline', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function refineDraftOutline(payload) {
  return request('/draft-assistant/outline/refine', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function manualUpdateDraftOutline(payload) {
  return request('/draft-assistant/outline/manual-update', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function importDraftOutline(payload) {
  return request('/draft-assistant/outline/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getDraftOutline(outlineId) {
  return request(`/draft-assistant/outlines/${encodeURIComponent(outlineId)}`)
}

export function getDraftEventOutlines(eventId) {
  return request(`/draft-assistant/events/${encodeURIComponent(eventId)}/outlines`)
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

export function deleteReportJob(jobId) {
  return request(`/report-jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
}

export function restoreReportJob(jobId) {
  return request(`/report-jobs/${encodeURIComponent(jobId)}/restore`, {
    method: 'POST',
  })
}

export function permanentlyDeleteReportJob(jobId) {
  return request(`/report-jobs/${encodeURIComponent(jobId)}/permanent`, {
    method: 'DELETE',
  })
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
