import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { MANUAL_SECTIONS, normalizeManualSection } from './userManualNavigation.js'

const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const headerSource = readFileSync(new URL('../components/NexusHeader.vue', import.meta.url), 'utf8')
const manualSource = readFileSync(new URL('../components/UserManual.vue', import.meta.url), 'utf8')

test('manual navigation recognizes all four workspaces and falls back safely', () => {
  assert.deepEqual(MANUAL_SECTIONS.map((section) => section.id), ['report', 'qa', 'daily', 'draft'])
  assert.equal(normalizeManualSection('daily'), 'daily')
  assert.equal(normalizeManualSection('unknown'), 'report')
})

test('the existing header entry opens one shared manual at the current workspace', () => {
  assert.match(headerSource, /defineEmits\([^\n]+open-manual/)
  assert.match(headerSource, /emit\('open-manual', currentWorkspace\)/)
  assert.doesNotMatch(headerSource, /class="header-manual-entry"[\s\S]{0,100}\sdisabled/)
  assert.match(appSource, /<UserManual[\s\S]*:initial-section="manualInitialSection"/)
  assert.match(appSource, /@open-manual="openUserManual"/)
})

test('the shared manual contains four chapters and accessible close behavior', () => {
  for (const section of MANUAL_SECTIONS) {
    assert.match(manualSource, new RegExp(`data-manual-section="${section.id}"`))
  }
  assert.match(manualSource, /scrollToSection\(props\.initialSection, 'auto'\)/)
  assert.match(manualSource, /event\.key === 'Escape'/)
  assert.match(manualSource, /@media \(max-width: 820px\)/)
  assert.match(manualSource, /@media \(prefers-reduced-motion: reduce\)/)
})
