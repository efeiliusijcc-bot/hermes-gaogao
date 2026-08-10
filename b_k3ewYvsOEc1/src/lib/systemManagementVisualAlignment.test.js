import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const userManagementSource = readFileSync(new URL('../components/UserManagement.vue', import.meta.url), 'utf8')
const dailyAdminSource = readFileSync(new URL('../components/DailyAwarenessAdmin.vue', import.meta.url), 'utf8')
const globalStyles = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8')

test('system management uses a narrower sidebar without crowding the user table', () => {
  assert.match(userManagementSource, /\.user-management-sidebar\s*{[\s\S]*width: 220px;/)
  assert.match(globalStyles, /\.user-management-main\s*{[\s\S]*margin-left: 220px;/)
  assert.match(userManagementSource, /grid-template-columns: minmax\(190px, 1\.4fr\)[^;]+;/)
  assert.match(userManagementSource, /min-width: 920px;/)
})

test('system management follows the report workspace blue-white visual language', () => {
  assert.match(userManagementSource, /\.user-management-sidebar__nav button\.active\s*{[\s\S]*background: #eff6ff;[\s\S]*color: #1d4ed8;/)
  assert.match(userManagementSource, /\.user-management__toolbar-actions \.sci-btn-primary\s*{[\s\S]*background: #2563eb !important;/)
  assert.match(userManagementSource, /\.user-management__status\s*{[\s\S]*background: #f0fdf4;[\s\S]*color: #15803d;/)
  assert.match(dailyAdminSource, /\.admin-tabs button\.active \{ border-bottom-color: #2563eb; color: #1d4ed8; \}/)
  assert.match(dailyAdminSource, /\.admin-button\.primary \{ border-color: #2563eb; color: #fff; background: #2563eb; \}/)
})
