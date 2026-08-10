import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const dailySource = readFileSync(new URL('../components/DailyAwareness.vue', import.meta.url), 'utf8')
const headerSource = readFileSync(new URL('../components/NexusHeader.vue', import.meta.url), 'utf8')
const stylesSource = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8')

test('daily awareness moves the existing account menu into its desktop sidebar', () => {
  assert.match(appSource, /showDailyAwareness\.value \|\| currentView\.value === 'generator'/)
  assert.match(appSource, /<DailyAwareness[\s\S]*@open-settings="openSidebarSettings"/)
  assert.match(dailySource, /class="daily-history-account"/)
  assert.match(dailySource, /aria-label="账号菜单"/)
  assert.match(dailySource, /emit\('open-settings', \$event\)/)
  assert.match(headerSource, /closest\('\.sidebar-shell, \.daily-history-sidebar'\)/)
})

test('the header account remains available when the daily sidebar is hidden on mobile', () => {
  assert.match(stylesSource, /@media \(max-width: 900px\)[\s\S]*\.header-user-chip-sidebar-mode\s*{\s*display: inline-flex;/)
  assert.match(dailySource, /@media \(max-width: 900px\)[\s\S]*\.daily-history-sidebar\s*{\s*display: none;/)
})
