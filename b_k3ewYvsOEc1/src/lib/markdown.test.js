import assert from 'node:assert/strict'
import test from 'node:test'
import { renderMarkdown } from './markdown.js'

test('renders headings and lists without exposing Markdown markers', () => {
  const sanitizer = { sanitize: (html) => html }
  const html = renderMarkdown('# 主标题\n\n## 二级标题\n\n- 第一条', sanitizer)

  assert.match(html, /<h1>主标题<\/h1>/)
  assert.match(html, /<h2>二级标题<\/h2>/)
  assert.match(html, /<li>第一条<\/li>/)
  assert.doesNotMatch(html, /(?:^|>)\s*#{1,3}\s/u)
})

test('sanitizes the generated HTML before returning it', () => {
  let receivedHtml = ''
  const sanitizer = {
    sanitize(html) {
      receivedHtml = html
      return html.replace(/<script>[\s\S]*?<\/script>/gu, '')
    },
  }

  const html = renderMarkdown('正文<script>alert(1)</script>', sanitizer)

  assert.match(receivedHtml, /<script>/)
  assert.doesNotMatch(html, /<script>/)
})
