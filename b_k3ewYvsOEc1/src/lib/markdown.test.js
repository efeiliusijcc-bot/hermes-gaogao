import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizePublishedDates, renderMarkdown } from './markdown.js'

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

test('keeps only the calendar date in published time labels', () => {
  const markdown = '来源：新华社，发布时间：2026-07-15T06:06:00.000Z'

  assert.equal(normalizePublishedDates(markdown), '来源：新华社，发布时间：2026-07-15')
})

test('daily awareness styles explicitly restore ordered and unordered list markers', () => {
  const component = readFileSync(new URL('../components/DailyAwareness.vue', import.meta.url), 'utf8')

  assert.match(component, /\.report-markdown :deep\(ol\)[\s\S]*?list-style-type:\s*decimal/u)
  assert.match(component, /\.report-markdown :deep\(ul\)[\s\S]*?list-style-type:\s*disc/u)
})
