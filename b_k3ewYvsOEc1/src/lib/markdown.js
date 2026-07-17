import DOMPurify from 'dompurify'
import { marked } from 'marked'

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
