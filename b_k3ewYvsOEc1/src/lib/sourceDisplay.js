const TECHNICAL_REPLACEMENTS = [
  [/Hermes/gi, '自主智能体'],
  [/Agent|MCP|tool_call|command|rawPayload/gi, '技术信息'],
  [/\bSQL\b/gi, '查询信息'],
]

const MOJIBAKE_PREFIX_PATTERN = /^[?\uFFFD�\s·•\-_:：|｜/\\]+(?=[\p{L}\p{N}\u4e00-\u9fff])/u
const MOJIBAKE_SUFFIX_PATTERN = /(?<=[\p{L}\p{N}\u4e00-\u9fff])[?\uFFFD�\s·•\-_:：|｜/\\.。]+$/u
const PLACEHOLDER_ONLY_PATTERN = /^[?\uFFFD�\s()[\]（）【】·•\-_:：|｜/\\.。]+$/u

export function sanitizeSourceDisplayText(value) {
  let text = String(value || '').replace(/\u0000/g, '')
  for (const [pattern, replacement] of TECHNICAL_REPLACEMENTS) {
    text = text.replace(pattern, replacement)
  }
  text = text
    .replace(MOJIBAKE_PREFIX_PATTERN, '')
    .replace(MOJIBAKE_SUFFIX_PATTERN, '')
    .trim()
  if (!text || PLACEHOLDER_ONLY_PATTERN.test(text)) return ''
  return text
}

export function firstSourceDisplayText(source, keys, fallback = '') {
  for (const key of keys) {
    const cleaned = sanitizeSourceDisplayText(source?.[key])
    if (cleaned) return cleaned
  }
  return sanitizeSourceDisplayText(fallback) || fallback
}

export function sourceHostname(url) {
  const text = String(url || '').trim()
  if (!text) return ''
  try {
    const hostname = new URL(text).hostname.replace(/^www\./i, '')
    return sanitizeSourceDisplayText(hostname)
  } catch {
    return ''
  }
}

export function filterAcceptedReportReferences(items) {
  return (Array.isArray(items) ? items : []).filter((item) => (
    item && typeof item === 'object' && item.matchStatus === 'matched'
  ))
}

export function resolveSourceGroup(source, fallbackGroup = 'all') {
  const explicit = source?.sourceGroup || source?.source_group || source?.group || source?.category
  if (['report_refs', 'candidate_hits', 'extract_failed', 'structured_sources'].includes(explicit)) return explicit

  const origin = source?.sourceOrigin || source?.source_origin
  if (['database_recall', 'crawler', 'tool_search'].includes(origin)) return origin
  if (['database_recall', 'crawler', 'tool_search'].includes(explicit)) return explicit

  const text = `${explicit || ''} ${source?.type || ''} ${source?.source_type || ''} ${source?.sourceType || ''} ${source?.tag || ''} ${source?.designated_tag || ''} ${source?.status || ''} ${source?.extract_status || ''} ${source?.method || ''} ${source?.engine || ''}`.toLowerCase()
  if (/candidate_hits|candidate|hit|候选|命中/.test(text)) return 'candidate_hits'
  if (/extract_failed|failed|failure|error|失败|不可用/.test(text)) return 'extract_failed'
  if (/report_refs|report_ref|citation|reference|引用|参考/.test(text)) return 'report_refs'
  if (/crawler|资料采集/.test(text)) return 'crawler'
  if (/tool_search|exa|firecrawl|tavily|工具调用|公开搜索/.test(text)) return 'tool_search'
  if (/database_recall|pg_vector|pgvector|database|vector|结构化|数据库|向量/.test(text)) return 'database_recall'
  if (/structured_sources|structured/.test(text)) return 'structured_sources'
  return fallbackGroup === 'all' ? 'database_recall' : fallbackGroup
}
