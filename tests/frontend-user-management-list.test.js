import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const listViewUrl = new URL('../b_k3ewYvsOEc1/src/lib/userListView.js', import.meta.url)
const componentUrl = new URL('../b_k3ewYvsOEc1/src/components/UserManagement.vue', import.meta.url)

async function loadListView() {
  try {
    return await import(listViewUrl)
  } catch {
    return null
  }
}

test('filters users locally across username, email, and remark-compatible fields', async () => {
  const listView = await loadListView()
  assert.ok(listView, 'user list view helpers should exist')

  const users = [
    { id: '1', username: 'Alice', email: null, displayName: '值班负责人' },
    { id: '2', username: 'bob', email: 'BOB@EXAMPLE.COM', displayName: undefined },
    { id: '3', username: null, email: undefined, notes: 'Regional Desk' },
    { id: '4', description: '外部协作账号' },
  ]

  assert.deepEqual(listView.filterUsers(users, ' alice '), [users[0]])
  assert.deepEqual(listView.filterUsers(users, 'example.com'), [users[1]])
  assert.deepEqual(listView.filterUsers(users, 'regional'), [users[2]])
  assert.deepEqual(listView.filterUsers(users, '协作'), [users[3]])
  assert.deepEqual(listView.filterUsers(users, '   '), users)
})

test('paginates filtered users at ten rows and clamps invalid pages', async () => {
  const listView = await loadListView()
  assert.ok(listView, 'user list view helpers should exist')

  const users = Array.from({ length: 23 }, (_, index) => ({ id: String(index + 1) }))
  assert.deepEqual(listView.paginateUsers(users, 1).items.map((user) => user.id), users.slice(0, 10).map((user) => user.id))
  assert.deepEqual(listView.paginateUsers(users, 3).items.map((user) => user.id), ['21', '22', '23'])
  assert.equal(listView.paginateUsers(users, 99).page, 3)
  assert.equal(listView.paginateUsers(users, 0).page, 1)
  assert.deepEqual(listView.paginateUsers([], 2), { items: [], page: 1, pageSize: 10, total: 0, totalPages: 1 })
})

test('wires the local list view and create-user dialog into UserManagement', async () => {
  const source = await readFile(componentUrl, 'utf8')
  const submitStart = source.indexOf('async function submitCreateUser()')
  const submitEnd = source.indexOf('function startEdit(', submitStart)
  const submitSource = source.slice(submitStart, submitEnd)

  assert.match(source, /filterUsers/)
  assert.match(source, /paginateUsers/)
  assert.doesNotMatch(source, /class="user-management__create panel"/)
  assert.match(source, /placeholder="搜索用户名、邮箱或备注"/)
  assert.match(source, /class="user-management__create-dialog"/)
  assert.match(source, /aria-labelledby="create-user-dialog-title"/)
  assert.match(source, /创建用户/)
  assert.match(source, /未找到匹配用户/)
  assert.match(source, /第 \{\{ currentPage \}\} \/ \{\{ totalPages \}\} 页/)
  assert.match(submitSource, /if \(saving\.value\) return/)
  assert.match(submitSource, /username: createForm\.username\.trim\(\)/)
  assert.match(submitSource, /password: createForm\.password/)
  assert.match(submitSource, /displayName: createForm\.displayName\.trim\(\)/)
  assert.match(submitSource, /email: createForm\.email\.trim\(\) \|\| null/)
  assert.match(submitSource, /role: createForm\.roles\[0\] \|\| undefined/)
  assert.match(submitSource, /roles: createForm\.roles/)
  assert.ok(submitSource.indexOf('await loadUsers()') < submitSource.indexOf("noticeMessage.value = '用户已创建'"))
  assert.match(submitSource, /createDialogError\.value = error/)
})
