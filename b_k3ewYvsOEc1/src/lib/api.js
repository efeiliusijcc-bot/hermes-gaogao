const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'
export const AUTH_TOKEN_KEY = 'gaogao_access_token'
export const AUTH_USER_KEY = 'gaogao_current_user'

let unauthorizedHandler = null
let refreshPromise = null

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

export async function logout() {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    // Logout should clear local state even if the server is unavailable.
  } finally {
    clearAuthSession()
  }
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null
}

async function refreshAuthSession() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (response) => {
        const text = await response.text()
        const data = text ? JSON.parse(text) : null
        if (!response.ok) throw new ApiError(data?.error || data?.message || `HTTP ${response.status}`, response.status, data)
        setAuthSession(data?.access_token || '', data?.user || null)
        return data
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
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
    credentials: 'include',
    ...options,
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const fallbackMessage = response.status === 403 ? '无权限访问用户管理' : `HTTP ${response.status}`
    const error = new ApiError(data?.error || data?.message || data?.details?.[0] || fallbackMessage, response.status, data)
    if (response.status === 401 && !options.skipRefresh) {
      try {
        await refreshAuthSession()
        return request(path, { ...options, skipRefresh: true })
      } catch {
        clearAuthSession()
        unauthorizedHandler?.(error)
      }
    } else if (response.status === 401) {
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

export function changePassword(oldPassword, newPassword) {
  return request('/auth/password', {
    method: 'PUT',
    body: JSON.stringify({ oldPassword, newPassword }),
  })
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

export function getRoles() {
  return request('/roles')
}

export function createRole(payload) {
  return request('/roles', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateRole(id, payload) {
  return request(`/roles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteRole(id) {
  return request(`/roles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function getPermissions() {
  return request('/permissions')
}

function querySuffix(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  return query.toString() ? `?${query.toString()}` : ''
}

export function getMyPreferences() {
  return request('/user-preferences/me')
}

export function updateMyPreferences(payload) {
  return request('/user-preferences/me', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function getUserTemplates(params = {}) {
  return request(`/user-templates${querySuffix(params)}`)
}

export function createUserTemplate(payload) {
  return request('/user-templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateUserTemplate(id, payload) {
  return request(`/user-templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteUserTemplate(id) {
  return request(`/user-templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function applyUserTemplate(id) {
  return request(`/user-templates/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
  })
}

export function getPromptSnippets(params = {}) {
  return request(`/user-prompt-snippets${querySuffix(params)}`)
}

export function createPromptSnippet(payload) {
  return request('/user-prompt-snippets', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updatePromptSnippet(id, payload) {
  return request(`/user-prompt-snippets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deletePromptSnippet(id) {
  return request(`/user-prompt-snippets/${encodeURIComponent(id)}`, {
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

export function createCrawlerTask(payload) {
  return request('/crawler/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function runCrawlerTask(taskId) {
  return request(`/crawler/tasks/${encodeURIComponent(taskId)}/run`, {
    method: 'POST',
  })
}

export function getCrawlerTaskItems(taskId) {
  return request(`/crawler/tasks/${encodeURIComponent(taskId)}/items`)
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

export function generateDailyBrief(payload) {
  return request('/daily-awareness/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getDailyBriefs(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return request(`/daily-awareness/briefs${suffix}`)
}

export function getDailyBrief(briefId) {
  return request(`/daily-awareness/briefs/${encodeURIComponent(briefId)}`)
}

export function getDailyBriefEvents(briefId, params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return request(`/daily-awareness/briefs/${encodeURIComponent(briefId)}/events${suffix}`)
}

export function importDailyEventToDraft(itemId) {
  return request(`/daily-awareness/events/${encodeURIComponent(itemId)}/import-draft`, {
    method: 'POST',
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

export function createReportEdit(jobId, payload) {
  return request(`/report-jobs/${encodeURIComponent(jobId)}/edits`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getReportEdits(jobId) {
  return request(`/report-jobs/${encodeURIComponent(jobId)}/edits`)
}

export function applyReportEdit(jobId, editId) {
  return request(`/report-jobs/${encodeURIComponent(jobId)}/edits/${encodeURIComponent(editId)}/apply`, {
    method: 'POST',
  })
}

export function getReportQualityReview(jobId) {
  return request(`/report-jobs/${encodeURIComponent(jobId)}/quality-review`)
}

export function runReportQualityReview(jobId) {
  return request(`/report-jobs/${encodeURIComponent(jobId)}/quality-review/run`, {
    method: 'POST',
  })
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
