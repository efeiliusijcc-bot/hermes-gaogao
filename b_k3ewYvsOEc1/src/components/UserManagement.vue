<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  createRole,
  createUser,
  deleteRole,
  disableUser,
  getPermissions,
  getRoles,
  getUsers,
  resetUserPassword,
  updateRole,
  updateUser,
} from '../lib/api.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['back'])

const fallbackRoles = [
  { id: 'admin', name: 'admin', description: '管理员', isSystem: true, permissions: [] },
  { id: 'operator', name: 'operator', description: '操作员', isSystem: true, permissions: [] },
  { id: 'viewer', name: 'viewer', description: '观察员', isSystem: true, permissions: [] },
]

const roleLabels = {
  admin: '管理员',
  operator: '操作员',
  viewer: '观察员',
}

const activeTab = ref('users')
const users = ref([])
const roles = ref([])
const permissions = ref([])
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const editingUserId = ref('')
const passwordUserId = ref('')
const passwordValue = ref('')
const editingRoleId = ref('')
const selectedRoleId = ref('')

const createForm = reactive({
  username: '',
  password: '',
  displayName: '',
  email: '',
  roles: ['viewer'],
})

const editForm = reactive({
  displayName: '',
  email: '',
  roles: ['viewer'],
  isActive: true,
})

const roleForm = reactive({
  name: '',
  description: '',
  permissions: [],
})

const isLoggedIn = computed(() => Boolean(props.currentUser?.id))
const isAdmin = computed(() => props.currentUser?.role === 'admin' || props.currentUser?.roles?.includes('admin'))
const availableRoles = computed(() => roles.value.length ? roles.value : fallbackRoles)
const selectedRole = computed(() => availableRoles.value.find((role) => role.id === selectedRoleId.value) || availableRoles.value[0] || null)
const groupedPermissions = computed(() => {
  const groups = new Map()
  permissions.value.forEach((permission) => {
    const resource = permission.resource || String(permission.permission || '').split(':')[0] || 'other'
    if (!groups.has(resource)) groups.set(resource, [])
    groups.get(resource).push(permission)
  })
  return Array.from(groups.entries()).map(([resource, items]) => ({
    resource,
    items: items.slice().sort((a, b) => String(a.permission).localeCompare(String(b.permission))),
  }))
})

onMounted(() => {
  if (isAdmin.value) void loadAll()
})

function roleLabel(role) {
  return roleLabels[role] || role || '--'
}

function statusLabel(user) {
  return user?.isActive ? '启用' : '禁用'
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function setError(error) {
  if (error?.status === 403) {
    errorMessage.value = '无权限访问用户或角色管理'
    return
  }
  errorMessage.value = error instanceof Error ? error.message : String(error)
}

function clearMessages() {
  errorMessage.value = ''
  noticeMessage.value = ''
}

async function loadAll() {
  await Promise.all([loadUsers(), loadRoleData()])
}

async function loadUsers() {
  if (!isLoggedIn.value) {
    errorMessage.value = '请先登录'
    return
  }
  if (!isAdmin.value) {
    errorMessage.value = '无权限访问用户管理'
    return
  }

  loading.value = true
  clearMessages()
  try {
    const result = await getUsers()
    users.value = Array.isArray(result) ? result : []
  } catch (error) {
    setError(error)
  } finally {
    loading.value = false
  }
}

async function loadRoleData() {
  if (!isAdmin.value) return
  loading.value = true
  clearMessages()
  try {
    const [roleResult, permissionResult] = await Promise.all([getRoles(), getPermissions()])
    roles.value = Array.isArray(roleResult) ? roleResult : []
    permissions.value = Array.isArray(permissionResult) ? permissionResult : []
    if (!selectedRoleId.value && roles.value[0]) selectedRoleId.value = roles.value[0].id
  } catch (error) {
    setError(error)
  } finally {
    loading.value = false
  }
}

function switchTab(tab) {
  activeTab.value = tab
  clearMessages()
  if (tab === 'roles') void loadRoleData()
  else void loadUsers()
}

function userRoleNames(user) {
  return Array.isArray(user?.roles) && user.roles.length ? user.roles : [user?.role || 'viewer']
}

function toggleRole(target, roleName) {
  const next = new Set(target.roles)
  if (next.has(roleName)) next.delete(roleName)
  else next.add(roleName)
  target.roles = Array.from(next)
  if (!target.roles.length) target.roles = ['viewer']
}

function roleChecked(target, roleName) {
  return target.roles.includes(roleName)
}

function resetCreateForm() {
  createForm.username = ''
  createForm.password = ''
  createForm.displayName = ''
  createForm.email = ''
  createForm.roles = ['viewer']
}

async function submitCreateUser() {
  saving.value = true
  clearMessages()
  try {
    await createUser({
      username: createForm.username.trim(),
      password: createForm.password,
      displayName: createForm.displayName.trim(),
      email: createForm.email.trim() || null,
      role: createForm.roles[0] || 'viewer',
      roles: createForm.roles,
    })
    noticeMessage.value = '用户已创建'
    resetCreateForm()
    await loadUsers()
  } catch (error) {
    setError(error)
  } finally {
    saving.value = false
  }
}

function startEdit(user) {
  clearMessages()
  editingUserId.value = user.id
  editForm.displayName = user.displayName || ''
  editForm.email = user.email || ''
  editForm.roles = userRoleNames(user)
  editForm.isActive = user.isActive !== false
}

function cancelEdit() {
  editingUserId.value = ''
}

async function submitEditUser(user) {
  saving.value = true
  clearMessages()
  try {
    await updateUser(user.id, {
      displayName: editForm.displayName.trim(),
      email: editForm.email.trim() || null,
      role: editForm.roles[0] || user.role || 'viewer',
      roles: editForm.roles,
      isActive: Boolean(editForm.isActive),
    })
    noticeMessage.value = '用户信息已更新'
    editingUserId.value = ''
    await loadUsers()
  } catch (error) {
    setError(error)
  } finally {
    saving.value = false
  }
}

function startResetPassword(user) {
  clearMessages()
  passwordUserId.value = user.id
  passwordValue.value = ''
}

function cancelResetPassword() {
  passwordUserId.value = ''
  passwordValue.value = ''
}

async function submitResetPassword(user) {
  saving.value = true
  clearMessages()
  try {
    await resetUserPassword(user.id, passwordValue.value)
    noticeMessage.value = '密码已重置'
    cancelResetPassword()
  } catch (error) {
    setError(error)
  } finally {
    saving.value = false
  }
}

async function confirmDisableUser(user) {
  if (!window.confirm(`确认禁用用户 ${user.username}？禁用后该账号不能继续登录。`)) return
  saving.value = true
  clearMessages()
  try {
    await disableUser(user.id)
    noticeMessage.value = '用户已禁用'
    await loadUsers()
  } catch (error) {
    setError(error)
  } finally {
    saving.value = false
  }
}

function resetRoleForm() {
  roleForm.name = ''
  roleForm.description = ''
  roleForm.permissions = []
  editingRoleId.value = ''
}

function startEditRole(role) {
  clearMessages()
  selectedRoleId.value = role.id
  editingRoleId.value = role.id
  roleForm.name = role.name || ''
  roleForm.description = role.description || ''
  roleForm.permissions = Array.isArray(role.permissions) ? role.permissions.slice() : []
}

function togglePermission(permission) {
  const next = new Set(roleForm.permissions)
  if (next.has(permission)) next.delete(permission)
  else next.add(permission)
  roleForm.permissions = Array.from(next).sort()
}

function permissionChecked(permission) {
  return roleForm.permissions.includes(permission)
}

async function submitRoleForm() {
  saving.value = true
  clearMessages()
  try {
    const payload = {
      name: roleForm.name.trim(),
      description: roleForm.description.trim(),
      permissions: roleForm.permissions,
    }
    if (editingRoleId.value) {
      await updateRole(editingRoleId.value, payload)
      noticeMessage.value = '角色已更新'
    } else {
      await createRole(payload)
      noticeMessage.value = '角色已创建'
    }
    resetRoleForm()
    await loadRoleData()
  } catch (error) {
    setError(error)
  } finally {
    saving.value = false
  }
}

async function confirmDeleteRole(role) {
  if (role.isSystem) return
  if (!window.confirm(`确认删除角色 ${role.name}？`)) return
  saving.value = true
  clearMessages()
  try {
    await deleteRole(role.id)
    noticeMessage.value = '角色已删除'
    if (selectedRoleId.value === role.id) selectedRoleId.value = ''
    await loadRoleData()
  } catch (error) {
    setError(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="user-management">
    <div class="user-management__header">
      <div>
        <div class="user-management__eyebrow">ACCESS CONTROL</div>
        <h1>用户与角色管理</h1>
        <p>管理系统账号、角色、权限点和启用状态。</p>
      </div>
      <div class="user-management__actions">
        <button class="sci-btn" type="button" @click="emit('back')">返回工作台</button>
        <button class="sci-btn sci-btn-primary" type="button" :disabled="loading || !isAdmin" @click="activeTab === 'roles' ? loadRoleData() : loadUsers()">
          {{ loading ? '刷新中...' : '刷新列表' }}
        </button>
      </div>
    </div>

    <div v-if="!isLoggedIn" class="user-management__empty">请先登录后再访问用户管理。</div>
    <div v-else-if="!isAdmin" class="user-management__empty">无权限访问用户管理。</div>
    <template v-else>
      <div class="user-management__tabs" role="tablist">
        <button type="button" :class="{ active: activeTab === 'users' }" @click="switchTab('users')">用户管理</button>
        <button type="button" :class="{ active: activeTab === 'roles' }" @click="switchTab('roles')">角色管理</button>
      </div>

      <div v-if="errorMessage" class="user-management__error">{{ errorMessage }}</div>
      <div v-if="noticeMessage" class="user-management__notice">{{ noticeMessage }}</div>

      <template v-if="activeTab === 'users'">
        <form class="user-management__create panel" @submit.prevent="submitCreateUser">
          <div class="user-management__section-title">
            <span>新增用户</span>
            <small>默认启用，角色默认观察员</small>
          </div>
          <div class="user-management__form-grid">
            <label>
              <span>用户名</span>
              <input v-model="createForm.username" class="sci-input" required maxlength="64" autocomplete="off" />
            </label>
            <label>
              <span>密码</span>
              <input v-model="createForm.password" class="sci-input" required type="password" autocomplete="new-password" />
            </label>
            <label>
              <span>显示名称</span>
              <input v-model="createForm.displayName" class="sci-input" maxlength="128" autocomplete="off" />
            </label>
            <label>
              <span>邮箱</span>
              <input v-model="createForm.email" class="sci-input" type="email" maxlength="255" autocomplete="off" />
            </label>
            <fieldset class="user-management__role-picker">
              <legend>角色</legend>
              <label v-for="role in availableRoles" :key="role.id">
                <input type="checkbox" :checked="roleChecked(createForm, role.name)" @change="toggleRole(createForm, role.name)" />
                <span>{{ roleLabel(role.name) }}</span>
              </label>
            </fieldset>
            <div class="user-management__form-actions">
              <button class="sci-btn sci-btn-primary" type="submit" :disabled="saving">
                {{ saving ? '保存中...' : '创建用户' }}
              </button>
            </div>
          </div>
        </form>

        <div class="user-management__table panel">
          <div class="user-management__table-head">
            <div>用户名</div>
            <div>显示名称</div>
            <div>邮箱</div>
            <div>角色</div>
            <div>状态</div>
            <div>创建时间</div>
            <div>操作</div>
          </div>

          <div v-if="loading" class="user-management__empty">正在读取用户列表...</div>
          <div v-else-if="!users.length" class="user-management__empty">暂无用户。</div>

          <template v-else>
            <div v-for="user in users" :key="user.id" class="user-management__row">
              <div class="user-management__cell user-management__username">{{ user.username }}</div>
              <div class="user-management__cell">{{ user.displayName || '--' }}</div>
              <div class="user-management__cell">{{ user.email || '--' }}</div>
              <div class="user-management__cell user-management__roles">
                <span v-for="role in userRoleNames(user)" :key="role" class="user-management__role">{{ roleLabel(role) }}</span>
              </div>
              <div class="user-management__cell">
                <span class="user-management__status" :class="{ 'is-disabled': !user.isActive }">
                  {{ statusLabel(user) }}
                </span>
              </div>
              <div class="user-management__cell">{{ formatTime(user.createdAt) }}</div>
              <div class="user-management__cell user-management__ops">
                <button class="sci-btn" type="button" :disabled="saving" @click="startEdit(user)">编辑</button>
                <button class="sci-btn" type="button" :disabled="saving" @click="startResetPassword(user)">重置密码</button>
                <button
                  class="sci-btn user-management__danger"
                  type="button"
                  :disabled="saving || !user.isActive || user.id === currentUser?.id"
                  @click="confirmDisableUser(user)"
                >
                  禁用
                </button>
              </div>

              <form v-if="editingUserId === user.id" class="user-management__inline-form" @submit.prevent="submitEditUser(user)">
                <label>
                  <span>显示名称</span>
                  <input v-model="editForm.displayName" class="sci-input" maxlength="128" />
                </label>
                <label>
                  <span>邮箱</span>
                  <input v-model="editForm.email" class="sci-input" type="email" maxlength="255" />
                </label>
                <fieldset class="user-management__role-picker compact">
                  <legend>角色</legend>
                  <label v-for="role in availableRoles" :key="role.id">
                    <input type="checkbox" :checked="roleChecked(editForm, role.name)" @change="toggleRole(editForm, role.name)" />
                    <span>{{ roleLabel(role.name) }}</span>
                  </label>
                </fieldset>
                <label class="user-management__check">
                  <input v-model="editForm.isActive" type="checkbox" />
                  <span>启用账号</span>
                </label>
                <div class="user-management__inline-actions">
                  <button class="sci-btn" type="button" :disabled="saving" @click="cancelEdit">取消</button>
                  <button class="sci-btn sci-btn-primary" type="submit" :disabled="saving">保存修改</button>
                </div>
              </form>

              <form v-if="passwordUserId === user.id" class="user-management__inline-form is-password" @submit.prevent="submitResetPassword(user)">
                <label>
                  <span>新密码</span>
                  <input v-model="passwordValue" class="sci-input" required type="password" autocomplete="new-password" />
                </label>
                <div class="user-management__inline-actions">
                  <button class="sci-btn" type="button" :disabled="saving" @click="cancelResetPassword">取消</button>
                  <button class="sci-btn sci-btn-primary" type="submit" :disabled="saving">确认重置</button>
                </div>
              </form>
            </div>
          </template>
        </div>
      </template>

      <template v-else>
        <div class="role-management">
          <div class="role-management__list panel">
            <div class="user-management__section-title">
              <span>角色列表</span>
              <small>{{ availableRoles.length }} 个角色</small>
            </div>
            <button
              v-for="role in availableRoles"
              :key="role.id"
              class="role-management__item"
              :class="{ active: selectedRole?.id === role.id }"
              type="button"
              @click="selectedRoleId = role.id"
            >
              <span>
                <strong>{{ roleLabel(role.name) }}</strong>
                <small>{{ role.description || role.name }}</small>
              </span>
              <em>{{ role.isSystem ? '系统角色' : `${role.permissions?.length || 0} 权限` }}</em>
            </button>
          </div>

          <div class="role-management__detail panel">
            <div v-if="selectedRole" class="role-management__summary">
              <div>
                <h2>{{ roleLabel(selectedRole.name) }}</h2>
                <p>{{ selectedRole.description || '--' }}</p>
              </div>
              <div class="user-management__actions">
                <button class="sci-btn" type="button" :disabled="saving" @click="startEditRole(selectedRole)">编辑</button>
                <button class="sci-btn user-management__danger" type="button" :disabled="saving || selectedRole.isSystem" @click="confirmDeleteRole(selectedRole)">删除</button>
              </div>
            </div>

            <form class="role-management__form" @submit.prevent="submitRoleForm">
              <div class="user-management__section-title">
                <span>{{ editingRoleId ? '编辑角色' : '新增角色' }}</span>
                <small v-if="editingRoleId">正在编辑 {{ roleForm.name }}</small>
              </div>
              <div class="role-management__form-grid">
                <label>
                  <span>角色名称</span>
                  <input v-model="roleForm.name" class="sci-input" required maxlength="64" :disabled="Boolean(editingRoleId && selectedRole?.isSystem)" />
                </label>
                <label>
                  <span>描述</span>
                  <input v-model="roleForm.description" class="sci-input" maxlength="255" />
                </label>
              </div>

              <div class="permission-groups">
                <section v-for="group in groupedPermissions" :key="group.resource" class="permission-group">
                  <h3>{{ group.resource }}</h3>
                  <label v-for="permission in group.items" :key="permission.permission">
                    <input type="checkbox" :checked="permissionChecked(permission.permission)" @change="togglePermission(permission.permission)" />
                    <span>{{ permission.permission }}</span>
                    <small>{{ permission.description }}</small>
                  </label>
                </section>
              </div>

              <div class="user-management__inline-actions">
                <button class="sci-btn" type="button" :disabled="saving" @click="resetRoleForm">清空</button>
                <button class="sci-btn sci-btn-primary" type="submit" :disabled="saving">
                  {{ saving ? '保存中...' : '保存角色' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.user-management {
  width: min(1280px, calc(100vw - 48px));
  margin: 0 auto;
  padding: 28px 0 48px;
  color: #111827;
}

.user-management__header,
.user-management__create,
.user-management__table,
.role-management__list,
.role-management__detail {
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
}

.user-management__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 16px;
  padding: 20px;
}

.user-management__eyebrow {
  margin-bottom: 8px;
  color: #0369a1;
  font-family: "Fira Code", monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.user-management h1,
.role-management__summary h2 {
  color: #0f172a;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.2;
}

.user-management p,
.role-management__summary p {
  margin-top: 8px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.7;
}

.user-management__actions,
.user-management__form-actions,
.user-management__inline-actions,
.user-management__ops,
.user-management__roles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.user-management__tabs {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 14px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #eff6ff;
  padding: 4px;
}

.user-management__tabs button {
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 8px 14px;
  color: #1e40af;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.user-management__tabs button.active {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.12);
}

.user-management__error,
.user-management__notice,
.user-management__empty {
  margin-bottom: 12px;
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 13px;
}

.user-management__error {
  border: 1px solid #fecaca;
  background: #fff1f2;
  color: #be123c;
}

.user-management__notice {
  border: 1px solid #bbf7d0;
  background: #f0fdf4;
  color: #047857;
}

.user-management__empty {
  border: 1px solid #e2e8f0;
  background: rgba(255, 255, 255, 0.9);
  color: #64748b;
  text-align: center;
}

.user-management__create {
  margin-bottom: 16px;
  padding: 18px;
}

.user-management__section-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  color: #0f172a;
  font-weight: 800;
}

.user-management__section-title small {
  color: #64748b;
  font-size: 12px;
  font-weight: 500;
}

.user-management__form-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}

.user-management__form-grid label,
.user-management__inline-form label,
.role-management__form-grid label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.user-management__form-grid label {
  grid-column: span 2;
}

.user-management__form-actions {
  grid-column: span 2;
  align-self: end;
}

.user-management__role-picker {
  grid-column: span 4;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  padding: 10px;
}

.user-management__role-picker.compact {
  grid-column: span 2;
}

.user-management__role-picker legend {
  padding: 0 4px;
  color: #334155;
  font-size: 12px;
  font-weight: 800;
}

.user-management__role-picker label,
.permission-group label {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.user-management__table {
  overflow: hidden;
}

.user-management__table-head,
.user-management__row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.25fr 1.2fr 0.65fr 1.1fr 1.6fr;
  gap: 12px;
  align-items: center;
}

.user-management__table-head {
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  padding: 12px 16px;
  color: #475569;
  font-size: 12px;
  font-weight: 800;
}

.user-management__row {
  border-bottom: 1px solid #edf2f7;
  padding: 14px 16px;
}

.user-management__row:last-child {
  border-bottom: 0;
}

.user-management__cell {
  min-width: 0;
  overflow-wrap: anywhere;
  color: #334155;
  font-size: 13px;
  line-height: 1.5;
}

.user-management__username {
  color: #0f172a;
  font-weight: 800;
}

.user-management__role,
.user-management__status {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  border-radius: 999px;
  padding: 4px 10px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 800;
}

.user-management__status {
  background: #ecfdf5;
  color: #047857;
}

.user-management__status.is-disabled {
  background: #f1f5f9;
  color: #64748b;
}

.user-management__danger {
  border-color: #fecaca !important;
  color: #be123c !important;
}

.user-management__inline-form {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-top: 4px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
  padding: 12px;
}

.user-management__inline-form.is-password {
  grid-template-columns: minmax(240px, 1fr) auto;
}

.user-management__check {
  justify-content: flex-end;
}

.user-management__check input {
  width: 16px;
  height: 16px;
}

.user-management__inline-actions {
  align-self: end;
}

.role-management {
  display: grid;
  grid-template-columns: minmax(260px, 330px) minmax(0, 1fr);
  gap: 16px;
}

.role-management__list,
.role-management__detail {
  padding: 18px;
}

.role-management__item {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}

.role-management__item.active {
  border-color: #93c5fd;
  background: #eff6ff;
}

.role-management__item strong,
.role-management__item small {
  display: block;
}

.role-management__item strong {
  color: #0f172a;
  font-size: 13px;
}

.role-management__item small,
.role-management__item em {
  color: #64748b;
  font-size: 12px;
  font-style: normal;
}

.role-management__summary {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 14px;
}

.role-management__summary h2 {
  font-size: 20px;
}

.role-management__form-grid {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.permission-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.permission-group {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 12px;
}

.permission-group h3 {
  margin-bottom: 8px;
  color: #0f172a;
  font-size: 13px;
  font-weight: 900;
}

.permission-group label {
  width: 100%;
  justify-content: flex-start;
  margin-top: 7px;
  color: #334155;
}

.permission-group label span {
  min-width: 138px;
  color: #1d4ed8;
  font-family: "Fira Code", monospace;
  font-size: 11px;
  font-weight: 800;
}

.permission-group label small {
  color: #64748b;
  font-size: 11px;
}

@media (max-width: 1100px) {
  .user-management__table-head {
    display: none;
  }

  .user-management__row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .user-management__ops,
  .user-management__inline-form {
    grid-column: 1 / -1;
  }

  .role-management,
  .permission-groups {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .user-management {
    width: min(100% - 28px, 1280px);
  }

  .user-management__header,
  .role-management__summary {
    flex-direction: column;
  }

  .user-management__form-grid,
  .user-management__inline-form,
  .user-management__inline-form.is-password,
  .user-management__row,
  .role-management__form-grid {
    grid-template-columns: 1fr;
  }

  .user-management__form-grid label,
  .user-management__form-actions,
  .user-management__role-picker,
  .user-management__role-picker.compact {
    grid-column: auto;
  }
}
</style>
