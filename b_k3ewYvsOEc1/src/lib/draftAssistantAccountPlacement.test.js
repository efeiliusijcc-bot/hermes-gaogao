import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const assistantSource = readFileSync(new URL('../components/DraftAssistant.vue', import.meta.url), 'utf8')
const historySource = readFileSync(new URL('../components/DraftHistorySidebar.vue', import.meta.url), 'utf8')
const headerSource = readFileSync(new URL('../components/NexusHeader.vue', import.meta.url), 'utf8')
const dailySource = readFileSync(new URL('../components/DailyAwareness.vue', import.meta.url), 'utf8')

test('draft assistant keeps history and the existing account menu in its desktop sidebar', () => {
  assert.match(appSource, /showDraftAssistant\.value \|\| showDailyAwareness\.value/)
  assert.match(appSource, /<DraftAssistant[\s\S]*@open-settings="openSidebarSettings"/)
  assert.match(assistantSource, /class="draft-assistant-workspace"/)
  assert.match(assistantSource, /:current-user="currentUser"/)
  assert.match(historySource, /class="draft-history-layer draft-history-sidebar"/)
  assert.match(historySource, /class="draft-history-account"/)
  assert.match(historySource, /aria-label="账号菜单"/)
  assert.match(headerSource, /\.draft-history-sidebar/)
})

test('draft history becomes a drawer and the header account returns on mobile', () => {
  assert.match(historySource, /@media \(max-width: 900px\)[\s\S]*\.draft-history-layer\.open\s*{\s*display: block;/)
  assert.match(historySource, /width:\s*min\(320px, calc\(100vw - 24px\)\)/)
  assert.match(assistantSource, /@media \(max-width: 900px\)[\s\S]*\.draft-history-mobile-button\s*{\s*visibility: visible;/)
})

test('daily awareness and draft assistant use the compact report-history width on desktop', () => {
  assert.match(dailySource, /\.daily-history-sidebar\s*\{[\s\S]*?width:\s*240px;[\s\S]*?min-width:\s*240px;/)
  assert.match(historySource, /\.draft-history-layer\s*\{[^}]*width:\s*240px;[^}]*min-width:\s*240px;[^}]*flex:\s*0 0 240px;/)
  assert.match(assistantSource, /\.draft-assistant-main\s*\{\s*--draft-sidebar-offset:\s*120px;\s*--draft-sidebar-space:\s*240px;/)
})
