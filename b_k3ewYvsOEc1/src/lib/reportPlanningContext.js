const STRUCTURED_CONTEXT_KEYS = ['selectedModules', 'selectedSearchQueries']

function isStructuredContext(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (
    value.kind === 'structured_report_context' ||
    STRUCTURED_CONTEXT_KEYS.some((key) => Array.isArray(value[key]))
  ))
}

export function parseStructuredPlanningContext(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return null
  if (isStructuredContext(value)) return value
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['planningContext', 'known_context', 'context']) {
      const nested = parseStructuredPlanningContext(value[key], depth + 1)
      if (nested) return nested
    }
    return null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  try {
    return parseStructuredPlanningContext(JSON.parse(text), depth + 1)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return parseStructuredPlanningContext(text.slice(start, end + 1), depth + 1)
    } catch {
      return null
    }
  }
}

export function buildPlanningContextPayload({ topic = '', knownContext = '' } = {}) {
  const parsed = parseStructuredPlanningContext(knownContext)
  return {
    topic,
    known_context: knownContext,
    ...(parsed ? { planningContext: parsed } : {}),
  }
}
