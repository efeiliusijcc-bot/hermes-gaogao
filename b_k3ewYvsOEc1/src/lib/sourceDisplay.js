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
