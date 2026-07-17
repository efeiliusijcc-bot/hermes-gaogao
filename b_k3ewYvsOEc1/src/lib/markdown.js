import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function normalizePublishedDates(markdown) {
  const source = typeof markdown === 'string' ? markdown : ''
  return source.replace(
    /(发布时间：\s*)(\d{4}-\d{2}-\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)/gu,
    '$1$2',
  )
}

export function renderMarkdown(markdown, sanitizer = DOMPurify) {
  const source = typeof markdown === 'string' ? markdown.trim() : ''
  if (!source) return ''

  const html = marked.parse(source, {
    async: false,
    breaks: false,
    gfm: true,
  })

  return sanitizer.sanitize(html, { USE_PROFILES: { html: true } })
}
