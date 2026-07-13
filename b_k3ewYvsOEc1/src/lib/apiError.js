const GENERIC_HTTP_ERRORS = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Conflict',
  'Internal Server Error',
])

function firstMessage(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).find(Boolean) || ''
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveApiErrorMessage(data, fallbackMessage) {
  const message = firstMessage(data?.message)
  const detail = firstMessage(data?.details)
  const error = firstMessage(data?.error)
  if (message && !GENERIC_HTTP_ERRORS.has(message)) return message
  if (detail) return detail
  if (error && !GENERIC_HTTP_ERRORS.has(error)) return error
  return message || error || fallbackMessage
}
