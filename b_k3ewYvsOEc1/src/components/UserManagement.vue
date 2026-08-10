<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  House,
  MessageSquareText,
  PenLine,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  UserRoundCheck,
  UserRoundCog,
  Users,
  UserX,
} from '@lucide/vue'
import DailyAwarenessAdmin from './DailyAwarenessAdmin.vue'
import {
  createRole,
  createUser,
  deleteRole,
  disableUser,
  getRoles,
  getUsers,
  resetUserPassword,
  updateRole,
  updateUser,
} from '../lib/api.js'
import { userPasswordValidationMessage, userPasswordValidationState } from '../lib/userValidation.js'
import { deriveRoleModules, deriveUserModules } from '../lib/permissionModules.js'
import { filterUsers, paginateUsers } from '../lib/userListView.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['back', 'open-daily-awareness', 'open-settings', 'open-workspace'])

const fallbackRoles = [
  { id: 'admin', name: 'admin', description: '管理员', isSystem: true, modules: ['report', 'qa', 'draft', 'daily'], permissions: [] },
]

const roleLabels = {
  admin: '管理员',
  operator: '操作员',
  viewer: '观察员',
}

const moduleOptions = [
  { key: 'report', label: '编报', icon: '编', description: '允许使用 AI 智能体深度编报，包括创建、规划和管理自己的编报任务。' },
  { key: 'qa', label: '问答', icon: '问', description: '允许使用 QA 问答，包括提问、知识库检索和问答历史。' },
  { key: 'draft', label: '拟稿', icon: '稿', description: '允许使用拟稿助手，包括事件分析、提纲生成和内容调整。' },
  { key: 'daily', label: '每日动态感知', icon: '日', description: '允许查看全局共享的每日动态简报。' },
]

const moduleLabels = Object.fromEntries(moduleOptions.map((item) => [item.key, item.label]))

const activeTab = ref('users')
const users = ref([])
const roles = ref([])
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const editingUserId = ref('')
const passwordUserId = ref('')
const passwordValue = ref('')
const editingRoleId = ref('')
const selectedRoleId = ref('')
const roleDrawerOpen = ref(false)
const roleDrawerMode = ref('create')
const createDialogOpen = ref(false)
const createDialogError = ref('')
const createUsernameInputRef = ref(null)
const searchKeyword = ref('')
const currentPage = ref(1)
const sidebarCollapsed = ref(false)

const createForm = reactive({
  username: '',
  password: '',
  displayName: '',
  email: '',
  roles: [],
})

const editForm = reactive({
  displayName: '',
  email: '',
  roles: [],
  isActive: true,
})

const roleForm = reactive({
  name: '',
  description: '',
  modules: [],
})

const isLoggedIn = computed(() => Boolean(props.currentUser?.id))
const currentPermissions = computed(() => Array.isArray(props.currentUser?.permissions) ? props.currentUser.permissions : [])
const canManageUsers = computed(() => currentPermissions.value.includes('user:manage'))
const canManageRoles = computed(() => currentPermissions.value.includes('role:manage'))
const canManageDailyAwareness = computed(() => currentPermissions.value.includes('system:daily-awareness:manage'))
const canAccessManagement = computed(() => canManageUsers.value || canManageRoles.value || canManageDailyAwareness.value)
const availableRoles = computed(() => roles.value.length ? roles.value : fallbackRoles)
const selectedRole = computed(() => availableRoles.value.find((role) => role.id === selectedRoleId.value) || availableRoles.value[0] || null)
const selectedRoleModules = computed(() => roleModules(selectedRole.value))
const createPasswordState = computed(() => userPasswordValidationState(createForm.password))
const resetPasswordState = computed(() => userPasswordValidationState(passwordValue.value))
const filteredUsers = computed(() => filterUsers(users.value, searchKeyword.value))
const userPagination = computed(() => paginateUsers(filteredUsers.value, currentPage.value))
const paginatedUsers = computed(() => userPagination.value.items)
const totalPages = computed(() => userPagination.value.totalPages)
const activeUsersCount = computed(() => users.value.filter((user) => user?.isActive !== false).length)
const disabledUsersCount = computed(() => users.value.filter((user) => user?.isActive === false).length)
const adminUsersCount = computed(() => users.value.filter((user) => userRoleNames(user).includes('admin')).length)
const currentUserModules = computed(() => deriveUserModules(props.currentUser))
const visiblePageNumbers = computed(() => {
  const count = totalPages.value
  if (count <= 5) return Array.from({ length: count }, (_, index) => index + 1)
  const start = Math.min(Math.max(1, currentPage.value - 2), count - 4)
  return Array.from({ length: 5 }, (_, index) => start + index)
})

watch(searchKeyword, () => {
  currentPage.value = 1
})

watch(totalPages, (value) => {
  if (currentPage.value > value) currentPage.value = value
})

onMounted(() => {
  if (canAccessManagement.value) {
    activeTab.value = canManageUsers.value ? 'users' : canManageRoles.value ? 'roles' : 'daily-awareness'
    void loadAll()
  }
})

function roleLabel(role) {
  return roleLabels[role] || role || '--'
}

function roleDisplayName(role) {
  return roleLabel(role?.name)
}

function moduleLabel(module) {
  return moduleLabels[module] || module
}

function roleModules(role) {
  return deriveRoleModules(role)
}

function userModules(user) {
  return deriveUserModules(user)
}

function moduleChecked(module) {
  return roleForm.modules.includes(module)
}

function selectedRoleHasModule(module) {
  return selectedRoleModules.value.includes(module)
}

function toggleModule(module) {
  const next = new Set(roleForm.modules)
  if (next.has(module)) next.delete(module)
  else next.add(module)
  roleForm.modules = moduleOptions.map((item) => item.key).filter((key) => next.has(key))
}

function statusLabel(user) {
  return user?.isActive ? '启用' : '禁用'
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function canOpenWorkspace(module) {
  return currentUserModules.value.includes(module)
}

function openWorkspace(module) {
  if (!canOpenWorkspace(module)) return
  emit('open-workspace', module)
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
  await Promise.all([
    canManageUsers.value ? loadUsers() : Promise.resolve(),
    canManageRoles.value ? loadRoleData() : Promise.resolve(),
  ])
}

async function loadUsers() {
  if (!isLoggedIn.value) {
    errorMessage.value = '请先登录'
    return
  }
  if (!canManageUsers.value) {
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
  if (!canManageRoles.value) return
  loading.value = true
  clearMessages()
  try {
    const roleResult = await getRoles()
    roles.value = Array.isArray(roleResult) ? roleResult : []
    if (!selectedRoleId.value && roles.value[0]) selectedRoleId.value = roles.value[0].id
  } catch (error) {
    setError(error)
  } finally {
    loading.value = false
  }
}

function switchTab(tab) {
  if (tab === 'users' && !canManageUsers.value) return
  if (tab === 'roles' && !canManageRoles.value) return
  if (tab === 'daily-awareness' && !canManageDailyAwareness.value) return
  activeTab.value = tab
  clearMessages()
  if (tab === 'roles') void loadRoleData()
  if (tab === 'users') void loadUsers()
}

function userRoleNames(user) {
  if (user && Object.prototype.hasOwnProperty.call(user, 'roles') && Array.isArray(user.roles)) {
    return user.roles.filter(Boolean)
  }
  return user?.role ? [user.role] : []
}

function toggleRole(target, roleName) {
  const next = new Set(target.roles)
  if (next.has(roleName)) next.delete(roleName)
  else next.add(roleName)
  target.roles = Array.from(next)
}

function roleChecked(target, roleName) {
  return target.roles.includes(roleName)
}

function resetCreateForm() {
  createForm.username = ''
  createForm.password = ''
  createForm.displayName = ''
  createForm.email = ''
  createForm.roles = []
}

function openCreateUserDialog() {
  if (saving.value) return
  clearMessages()
  resetCreateForm()
  createDialogError.value = ''
  createDialogOpen.value = true
  nextTick(() => createUsernameInputRef.value?.focus())
}

function closeCreateUserDialog() {
  if (saving.value) return
  createDialogOpen.value = false
  createDialogError.value = ''
  resetCreateForm()
}

function clearUserSearch() {
  searchKeyword.value = ''
}

function setUserPage(page) {
  currentPage.value = Math.min(totalPages.value, Math.max(1, Number(page) || 1))
}

function selectRole(role) {
  if (!role?.id) return
  selectedRoleId.value = role.id
}

function roleTypeLabel(role) {
  return role?.isSystem ? '系统角色' : '自定义角色'
}

function roleProtectionLabel(role) {
  if (role?.name === 'admin') return '受保护'
  if (role?.isSystem) return '不可删除'
  return '可配置'
}

function roleCreatedAt(role) {
  return formatTime(role?.createdAt || role?.created_at)
}

function roleUsageHint(role) {
  if (role?.name === 'admin') return '系统最高权限角色，拥有所有功能模块和系统管理权限，可进行用户、角色、模块及系统设置管理。'
  return '该角色由管理员创建，可根据业务需要配置功能模块权限。'
}

function roleActionHint(role) {
  if (role?.name === 'admin') return '受保护系统角色，不能删除。'
  if (role?.isSystem) return '系统角色，不能删除。'
  return '自定义角色未被用户使用时可以删除。'
}

function openCreateRoleDrawer() {
  clearMessages()
  resetRoleForm()
  roleDrawerMode.value = 'create'
  roleDrawerOpen.value = true
}

function openEditRoleDrawer(role) {
  if (!role?.id || role.name === 'admin') return
  clearMessages()
  selectedRoleId.value = role.id
  editingRoleId.value = role.id
  roleDrawerMode.value = 'edit'
  roleForm.name = role.name || ''
  roleForm.description = String(role.description || '').slice(0, 200)
  roleForm.modules = roleModules(role).slice()
  roleDrawerOpen.value = true
}

function closeRoleDrawer() {
  if (saving.value) return
  roleDrawerOpen.value = false
  resetRoleForm()
}

async function submitCreateUser() {
  if (saving.value) return
  createDialogError.value = ''
  const passwordError = userPasswordValidationMessage(createForm.password)
  if (passwordError) {
    createDialogError.value = passwordError
    return
  }
  saving.value = true
  try {
    await createUser({
      username: createForm.username.trim(),
      password: createForm.password,
      displayName: createForm.displayName.trim(),
      email: createForm.email.trim() || null,
      role: createForm.roles[0] || undefined,
      roles: createForm.roles,
    })
    await loadUsers()
    searchKeyword.value = ''
    currentPage.value = 1
    createDialogOpen.value = false
    createDialogError.value = ''
    resetCreateForm()
    noticeMessage.value = '用户已创建'
  } catch (error) {
    createDialogError.value = error?.status === 403
      ? '无权限访问用户管理'
      : (error instanceof Error ? error.message : String(error))
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
      role: editForm.roles[0] || undefined,
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
  clearMessages()
  const passwordError = userPasswordValidationMessage(passwordValue.value)
  if (passwordError) {
    errorMessage.value = passwordError
    return
  }
  saving.value = true
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
  roleForm.modules = []
  editingRoleId.value = ''
}

function startEditRole(role) {
  openEditRoleDrawer(role)
}

async function submitRoleForm() {
  if (!roleForm.name.trim()) {
    errorMessage.value = '请填写角色名称'
    return
  }
  saving.value = true
  clearMessages()
  const wasEditing = Boolean(editingRoleId.value)
  const currentRoleId = editingRoleId.value
  try {
    const payload = {
      name: roleForm.name.trim(),
      description: roleForm.description.trim().slice(0, 200),
      modules: roleForm.modules,
    }
    let savedRole = null
    if (editingRoleId.value) {
      savedRole = await updateRole(editingRoleId.value, payload)
      noticeMessage.value = '角色已更新'
    } else {
      savedRole = await createRole(payload)
      noticeMessage.value = '角色已创建'
    }
    const nextSelectedId = savedRole?.id || currentRoleId || ''
    roleDrawerOpen.value = false
    resetRoleForm()
    await loadRoleData()
    if (nextSelectedId) selectedRoleId.value = nextSelectedId
    else if (!wasEditing && roles.value[0]) selectedRoleId.value = roles.value[0].id
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
  <div class="user-management-layout" :class="{ 'is-sidebar-collapsed': sidebarCollapsed }">
    <aside class="user-management-sidebar" :class="{ 'is-collapsed': sidebarCollapsed }" aria-label="系统管理导航">
      <div class="user-management-sidebar__brand">
        <span class="user-management-sidebar__logo">A</span>
        <span class="user-management-sidebar__brand-copy">
          <strong>AI深度编报</strong>
          <small>智能内容生产与管理平台</small>
        </span>
      </div>

      <nav class="user-management-sidebar__nav">
        <button type="button" title="工作台" @click="emit('back')">
          <House :size="18" aria-hidden="true" />
          <span>工作台</span>
        </button>

        <div class="user-management-sidebar__group">
          <div class="user-management-sidebar__group-title">
            <FileCheck2 :size="18" aria-hidden="true" />
            <span>AI深度编报</span>
            <ChevronDown :size="15" aria-hidden="true" />
          </div>
          <button v-if="canOpenWorkspace('report')" type="button" title="智能编报" @click="openWorkspace('report')">
            <Bot :size="17" aria-hidden="true" />
            <span>智能编报</span>
          </button>
          <button v-if="canOpenWorkspace('qa')" type="button" title="QA问答" @click="openWorkspace('qa')">
            <MessageSquareText :size="17" aria-hidden="true" />
            <span>QA问答</span>
          </button>
          <button v-if="canOpenWorkspace('daily')" type="button" title="动态感知" @click="openWorkspace('daily')">
            <Radio :size="17" aria-hidden="true" />
            <span>动态感知</span>
          </button>
          <button v-if="canOpenWorkspace('draft')" type="button" title="拟稿助手" @click="openWorkspace('draft')">
            <PenLine :size="17" aria-hidden="true" />
            <span>拟稿助手</span>
          </button>
        </div>

        <div class="user-management-sidebar__group is-active">
          <div class="user-management-sidebar__group-title">
            <UserRoundCog :size="18" aria-hidden="true" />
            <span>用户管理</span>
            <ChevronDown :size="15" aria-hidden="true" />
          </div>
          <button v-if="canManageUsers" type="button" :class="{ active: activeTab === 'users' }" title="用户管理" @click="switchTab('users')">
            <Users :size="17" aria-hidden="true" />
            <span>用户管理</span>
          </button>
          <button v-if="canManageRoles" type="button" :class="{ active: activeTab === 'roles' }" title="角色管理" @click="switchTab('roles')">
            <ShieldCheck :size="17" aria-hidden="true" />
            <span>角色管理</span>
          </button>
          <button v-if="canManageDailyAwareness" type="button" :class="{ active: activeTab === 'daily-awareness' }" title="动态感知管理" @click="switchTab('daily-awareness')">
            <Radio :size="17" aria-hidden="true" />
            <span>动态感知</span>
          </button>
        </div>

        <button type="button" title="系统设置" @click="emit('open-settings', $event)">
          <Settings :size="18" aria-hidden="true" />
          <span>系统设置</span>
        </button>
      </nav>

      <button class="user-management-sidebar__collapse" type="button" :aria-label="sidebarCollapsed ? '展开菜单' : '收起菜单'" @click="sidebarCollapsed = !sidebarCollapsed">
        <ChevronLeft :size="17" aria-hidden="true" />
        <span>{{ sidebarCollapsed ? '展开菜单' : '收起菜单' }}</span>
      </button>
    </aside>

    <section class="user-management-workspace">
      <div class="user-management__breadcrumb"><span>系统管理</span><b>/</b><strong>{{ activeTab === 'users' ? '用户管理' : activeTab === 'roles' ? '角色管理' : '动态感知' }}</strong></div>

      <section class="user-management">
        <header class="user-management__header">
          <div>
            <div class="user-management__eyebrow">ACCESS CONTROL</div>
            <h1>系统管理</h1>
            <p>管理账号权限与每日动态感知运行状态。</p>
          </div>
          <ShieldCheck class="user-management__hero-mark" :size="124" stroke-width="1" aria-hidden="true" />
        </header>

        <section v-if="canManageUsers" class="user-management__metrics" aria-label="用户概览">
          <article>
            <span class="user-management__metric-icon is-blue"><Users :size="25" aria-hidden="true" /></span>
            <div><span>用户总数</span><strong>{{ loading ? '—' : users.length }}</strong></div>
          </article>
          <article>
            <span class="user-management__metric-icon is-green"><UserRoundCheck :size="25" aria-hidden="true" /></span>
            <div><span>启用用户</span><strong>{{ loading ? '—' : activeUsersCount }}</strong></div>
          </article>
          <article>
            <span class="user-management__metric-icon is-blue"><ShieldCheck :size="25" aria-hidden="true" /></span>
            <div><span>管理员</span><strong>{{ loading ? '—' : adminUsersCount }}</strong></div>
          </article>
          <article>
            <span class="user-management__metric-icon is-red"><UserX :size="25" aria-hidden="true" /></span>
            <div><span>禁用用户</span><strong>{{ loading ? '—' : disabledUsersCount }}</strong></div>
          </article>
        </section>

        <div v-if="!isLoggedIn" class="user-management__empty">请先登录后再访问用户管理。</div>
        <div v-else-if="!canAccessManagement" class="user-management__empty">无权限访问系统管理。</div>
        <section v-else class="user-management__content">
          <div class="user-management__tabs" role="tablist">
        <button v-if="canManageUsers" type="button" :class="{ active: activeTab === 'users' }" @click="switchTab('users')">用户管理</button>
        <button v-if="canManageRoles" type="button" :class="{ active: activeTab === 'roles' }" @click="switchTab('roles')">角色管理</button>
        <button v-if="canManageDailyAwareness" type="button" :class="{ active: activeTab === 'daily-awareness' }" @click="switchTab('daily-awareness')">动态感知</button>
            <button v-if="activeTab === 'roles'" class="user-management__tab-refresh" type="button" :disabled="loading || !canManageRoles" @click="loadRoleData">
              <RefreshCw :size="15" aria-hidden="true" />
              {{ loading ? '刷新中...' : '刷新列表' }}
            </button>
          </div>

          <div v-if="errorMessage" class="user-management__error">{{ errorMessage }}</div>
          <div v-if="noticeMessage" class="user-management__notice">{{ noticeMessage }}</div>

          <template v-if="activeTab === 'users'">
            <div class="user-management__toolbar">
          <div class="user-management__search">
            <Search class="user-management__search-icon" :size="16" aria-hidden="true" />
            <input
              v-model="searchKeyword"
              class="sci-input"
              type="search"
              placeholder="搜索用户名、邮箱或备注"
              aria-label="搜索用户"
            />
            <button
              v-if="searchKeyword"
              class="user-management__search-clear"
              type="button"
              aria-label="清空用户搜索"
              title="清空搜索"
              @click="clearUserSearch"
            >×</button>
          </div>
          <div class="user-management__toolbar-actions">
            <button class="sci-btn" type="button" :disabled="loading" @click="loadUsers">
              <RefreshCw :size="15" aria-hidden="true" />
              {{ loading ? '刷新中...' : '刷新列表' }}
            </button>
            <button class="sci-btn sci-btn-primary" type="button" :disabled="saving" @click="openCreateUserDialog">
              <Plus :size="16" aria-hidden="true" />
              新增用户
            </button>
          </div>
        </div>

        <div class="user-management__table">
          <div class="user-management__table-head">
            <div>用户名</div>
            <div>角色</div>
            <div>可用模块</div>
            <div>状态</div>
            <div>创建时间</div>
            <div>操作</div>
          </div>

          <div v-if="loading" class="user-management__empty">正在读取用户列表...</div>
          <div v-else-if="!users.length" class="user-management__empty">暂无用户。</div>
          <div v-else-if="!filteredUsers.length" class="user-management__empty">未找到匹配用户。</div>

          <template v-else>
            <div v-for="user in paginatedUsers" :key="user.id" class="user-management__row">
              <div class="user-management__cell user-management__username">{{ user.username }}</div>
              <div class="user-management__cell user-management__roles">
                <span v-for="role in userRoleNames(user)" :key="role" class="user-management__role">{{ roleLabel(role) }}</span>
                <span v-if="!userRoleNames(user).length" class="user-management__muted">暂无角色</span>
              </div>
              <div class="user-management__cell user-management__modules">
                <span v-for="module in userModules(user)" :key="module" class="user-management__module">{{ moduleLabel(module) }}</span>
                <span v-if="!userModules(user).length" class="user-management__muted">暂无模块</span>
              </div>
              <div class="user-management__cell">
                <span class="user-management__status" :class="{ 'is-disabled': !user.isActive }">
                  <span class="user-management__status-dot" aria-hidden="true"></span>
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
                  <span>备注</span>
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
                  <input
                    v-model="passwordValue"
                    class="sci-input"
                    :class="{ 'is-invalid': resetPasswordState.touched && !resetPasswordState.valid, 'is-valid': resetPasswordState.valid }"
                    required
                    type="password"
                    minlength="8"
                    pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,}"
                    title="至少 8 位，并同时包含字母和数字"
                    autocomplete="new-password"
                    :aria-invalid="resetPasswordState.touched && !resetPasswordState.valid"
                    :aria-describedby="`reset-password-hint-${user.id}`"
                  />
                  <small
                    :id="`reset-password-hint-${user.id}`"
                    class="password-validation-hint"
                    :class="{ error: resetPasswordState.touched && !resetPasswordState.valid, success: resetPasswordState.valid }"
                    aria-live="polite"
                  >{{ resetPasswordState.message }}</small>
                </label>
                <div class="user-management__inline-actions">
                  <button class="sci-btn" type="button" :disabled="saving" @click="cancelResetPassword">取消</button>
                  <button class="sci-btn sci-btn-primary" type="submit" :disabled="saving">确认重置</button>
                </div>
              </form>
            </div>
          </template>

          <footer v-if="!loading && users.length" class="user-management__pagination">
            <span>共 {{ filteredUsers.length }} 条</span>
            <span class="user-management__sr-only">第 {{ currentPage }} / {{ totalPages }} 页 · 共 {{ filteredUsers.length }} 条</span>
            <div class="user-management__page-controls">
              <span class="user-management__page-size">10 条 / 页</span>
              <button type="button" aria-label="上一页" :disabled="currentPage <= 1" @click="setUserPage(currentPage - 1)"><ChevronLeft :size="16" /></button>
              <button v-for="page in visiblePageNumbers" :key="page" type="button" :class="{ active: page === currentPage }" :aria-current="page === currentPage ? 'page' : undefined" @click="setUserPage(page)">{{ page }}</button>
              <button type="button" aria-label="下一页" :disabled="currentPage >= totalPages" @click="setUserPage(currentPage + 1)"><ChevronRight :size="16" /></button>
            </div>
          </footer>
        </div>
      </template>

      <template v-else-if="activeTab === 'roles'">
        <div class="role-management">
          <div class="role-management__list panel">
            <div class="user-management__section-title">
              <span>角色列表</span>
              <small>{{ availableRoles.length }} 个角色</small>
            </div>
            <button class="sci-btn sci-btn-primary role-management__new" type="button" :disabled="saving" @click="openCreateRoleDrawer">
              新建角色
            </button>
            <button
              v-for="role in availableRoles"
              :key="role.id"
              class="role-management__item"
              :class="{ active: selectedRole?.id === role.id }"
              type="button"
              @click="selectRole(role)"
            >
              <span>
                <strong>{{ roleDisplayName(role) }}</strong>
                <small>{{ role.description || role.name }}</small>
              </span>
              <em>{{ roleModules(role).length }} 个模块 · {{ roleTypeLabel(role) }}</em>
            </button>
          </div>

          <div class="role-management__detail panel">
            <div v-if="selectedRole" class="role-management__summary">
              <div>
                <div class="role-management__title-row">
                  <h2>{{ roleDisplayName(selectedRole) }}</h2>
                  <span class="role-management__badge">{{ roleTypeLabel(selectedRole) }}</span>
                  <span class="role-management__badge muted">{{ roleProtectionLabel(selectedRole) }}</span>
                </div>
                <dl class="role-management__meta">
                  <div>
                    <dt>角色标识</dt>
                    <dd>{{ selectedRole.name }}</dd>
                  </div>
                  <div>
                    <dt>创建时间</dt>
                    <dd>{{ roleCreatedAt(selectedRole) }}</dd>
                  </div>
                  <div>
                    <dt>描述</dt>
                    <dd>{{ selectedRole.description || '--' }}</dd>
                  </div>
                </dl>
              </div>
              <div class="user-management__actions">
                <button class="sci-btn" type="button" :disabled="saving || selectedRole.name === 'admin'" @click="startEditRole(selectedRole)">编辑</button>
                <button class="sci-btn user-management__danger" type="button" :disabled="saving || selectedRole.isSystem" @click="confirmDeleteRole(selectedRole)">删除</button>
              </div>
            </div>

            <div v-if="selectedRole" class="role-management__content">
              <section class="role-detail-section">
                <div class="user-management__section-title">
                  <span>已开通功能</span>
                  <small>{{ selectedRoleModules.length }} / {{ moduleOptions.length }} 个模块</small>
                </div>
                <div class="role-module-grid">
                  <article
                    v-for="module in moduleOptions"
                    :key="module.key"
                    class="role-module-card"
                    :class="{ enabled: selectedRoleHasModule(module.key) }"
                  >
                    <div class="role-module-card__icon">{{ module.icon }}</div>
                    <div>
                      <div class="role-module-card__head">
                        <strong>{{ module.label }}</strong>
                        <span>{{ selectedRoleHasModule(module.key) ? '已开通' : '未开通' }}</span>
                      </div>
                      <p>{{ module.description }}</p>
                    </div>
                  </article>
                </div>
              </section>

              <section class="role-note-card">
                <div class="user-management__section-title">
                  <span>角色说明</span>
                  <small>{{ roleActionHint(selectedRole) }}</small>
                </div>
                <p>{{ roleUsageHint(selectedRole) }}</p>
              </section>
            </div>

            <div v-else class="user-management__empty">请选择左侧角色以显示详情。</div>
          </div>
        </div>

        <div v-if="roleDrawerOpen" class="role-drawer-backdrop" @click="closeRoleDrawer"></div>
        <aside v-if="roleDrawerOpen" class="role-drawer" aria-modal="true" role="dialog">
          <form class="role-drawer__form" @submit.prevent="submitRoleForm">
            <header class="role-drawer__header">
              <div>
                <p>{{ roleDrawerMode === 'edit' ? 'EDIT ROLE' : 'NEW ROLE' }}</p>
                <h2>{{ roleDrawerMode === 'edit' ? '编辑角色' : '新建角色' }}</h2>
              </div>
              <button class="sci-btn" type="button" :disabled="saving" @click="closeRoleDrawer">关闭</button>
            </header>

            <div class="role-drawer__body">
              <label class="role-drawer__field">
                <span>角色名称</span>
                <input
                  v-model="roleForm.name"
                  class="sci-input"
                  required
                  maxlength="64"
                  autocomplete="off"
                  :disabled="Boolean(editingRoleId && selectedRole?.isSystem)"
                />
              </label>

              <label class="role-drawer__field">
                <span>角色描述</span>
                <textarea v-model="roleForm.description" class="sci-input" maxlength="200" rows="4"></textarea>
                <small>{{ roleForm.description.length }} / 200</small>
              </label>

              <div class="module-permission-section">
                <div class="user-management__section-title">
                  <span>功能权限</span>
                  <small>只选择业务模块，具体接口权限由系统自动处理</small>
                </div>
                <div class="drawer-module-grid">
                  <label
                    v-for="module in moduleOptions"
                    :key="module.key"
                    class="drawer-module-card"
                    :class="{ selected: moduleChecked(module.key) }"
                  >
                    <input type="checkbox" :checked="moduleChecked(module.key)" @change="toggleModule(module.key)" />
                    <span class="drawer-module-card__icon">{{ module.icon }}</span>
                    <span>
                      <strong>{{ module.label }}</strong>
                      <small>{{ module.description }}</small>
                    </span>
                  </label>
                </div>
                <div v-if="roleForm.name === 'admin'" class="system-permission-hint">
                  系统管理员默认拥有用户管理、角色管理、密钥配置、向量源配置和报告删除权限，这些系统权限不会出现在业务模块卡片中，也不会被移除。
                </div>
              </div>
            </div>

            <footer class="role-drawer__footer">
              <button class="sci-btn" type="button" :disabled="saving" @click="closeRoleDrawer">取消</button>
              <button class="sci-btn sci-btn-primary" type="submit" :disabled="saving">
                {{ saving ? '保存中...' : '保存角色' }}
              </button>
            </footer>
          </form>
        </aside>
      </template>

      <DailyAwarenessAdmin
        v-else-if="activeTab === 'daily-awareness' && canManageDailyAwareness"
        :current-user="currentUser"
        @open-daily-awareness="emit('open-daily-awareness')"
      />
        </section>
      </section>
    </section>

    <Teleport to="body">
      <div
        v-if="createDialogOpen"
        class="user-management__create-backdrop"
        @click.self="closeCreateUserDialog"
        @keydown.esc.stop="closeCreateUserDialog"
      >
        <section class="user-management__create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-user-dialog-title">
          <form class="user-management__create-dialog-form" @submit.prevent="submitCreateUser">
            <header class="user-management__create-dialog-header">
              <div>
                <p>NEW USER</p>
                <h2 id="create-user-dialog-title">新增用户</h2>
              </div>
              <button class="user-management__create-dialog-close" type="button" :disabled="saving" aria-label="关闭新增用户窗口" @click="closeCreateUserDialog">×</button>
            </header>

            <div class="user-management__create-dialog-body">
              <div v-if="createDialogError" class="user-management__error" role="alert">{{ createDialogError }}</div>
              <div class="user-management__form-grid">
                <label>
                  <span>用户名</span>
                  <input ref="createUsernameInputRef" v-model="createForm.username" class="sci-input" required maxlength="64" autocomplete="off" />
                </label>
                <label>
                  <span>密码</span>
                  <input
                    v-model="createForm.password"
                    class="sci-input"
                    :class="{ 'is-invalid': createPasswordState.touched && !createPasswordState.valid, 'is-valid': createPasswordState.valid }"
                    required
                    type="password"
                    minlength="8"
                    pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,}"
                    title="至少 8 位，并同时包含字母和数字"
                    autocomplete="new-password"
                    :aria-invalid="createPasswordState.touched && !createPasswordState.valid"
                    aria-describedby="create-password-hint"
                  />
                  <small
                    id="create-password-hint"
                    class="password-validation-hint"
                    :class="{ error: createPasswordState.touched && !createPasswordState.valid, success: createPasswordState.valid }"
                    aria-live="polite"
                  >{{ createPasswordState.message }}</small>
                </label>
                <label>
                  <span>备注</span>
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
              </div>
            </div>

            <footer class="user-management__create-dialog-footer">
              <button class="sci-btn" type="button" :disabled="saving" @click="closeCreateUserDialog">取消</button>
              <button class="sci-btn sci-btn-primary" type="submit" :disabled="saving">
                {{ saving ? '创建中...' : '创建用户' }}
              </button>
            </footer>
          </form>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.user-management-layout {
  height: 100%;
  min-height: 0;
  background: #f5f7fb;
}

.user-management-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 70;
  display: flex;
  width: 258px;
  flex-direction: column;
  border-right: 1px solid #e5eaf2;
  background: #fff;
  color: #183153;
  transition: width 0.18s ease;
}

.user-management-sidebar__brand {
  display: flex;
  height: 68px;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #eef1f5;
  padding: 0 24px;
}

.user-management-sidebar__logo {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: #2157d5;
  color: #fff;
  font-size: 20px;
  font-weight: 850;
  box-shadow: 0 7px 16px rgba(33, 87, 213, 0.2);
}

.user-management-sidebar__brand-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
  white-space: nowrap;
}

.user-management-sidebar__brand-copy strong {
  color: #0f213e;
  font-size: 18px;
  font-weight: 850;
}

.user-management-sidebar__brand-copy small {
  color: #8a98ac;
  font-size: 11px;
}

.user-management-sidebar__nav {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding: 20px 14px;
}

.user-management-sidebar__nav button,
.user-management-sidebar__group-title,
.user-management-sidebar__collapse {
  display: flex;
  width: 100%;
  min-height: 42px;
  align-items: center;
  gap: 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 0 12px;
  color: #405575;
  font-size: 13px;
  font-weight: 650;
  text-align: left;
}

.user-management-sidebar__nav button {
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.user-management-sidebar__nav button:hover {
  background: #f4f7fc;
  color: #2157d5;
}

.user-management-sidebar__group {
  position: relative;
  display: grid;
  gap: 4px;
  margin: 2px -14px;
  padding: 5px 14px;
}

.user-management-sidebar__group.is-active::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: #2563eb;
  content: "";
}

.user-management-sidebar__group-title {
  color: #263b5d;
  font-weight: 750;
}

.user-management-sidebar__group-title svg:last-child {
  margin-left: auto;
}

.user-management-sidebar__group > button {
  padding-left: 36px;
}

.user-management-sidebar__group > button.active {
  background: #eef4ff;
  color: #2157d5;
  font-weight: 750;
}

.user-management-sidebar__collapse {
  flex: 0 0 auto;
  border-top: 1px solid #eef1f5;
  border-radius: 0;
  padding: 0 24px;
  cursor: pointer;
}

.user-management-sidebar__collapse:hover {
  background: #f8fafc;
  color: #2157d5;
}

.user-management-sidebar.is-collapsed {
  width: 76px;
}

.user-management-sidebar.is-collapsed .user-management-sidebar__brand {
  justify-content: center;
  padding: 0;
}

.user-management-sidebar.is-collapsed .user-management-sidebar__brand-copy,
.user-management-sidebar.is-collapsed .user-management-sidebar__nav button span,
.user-management-sidebar.is-collapsed .user-management-sidebar__group-title span,
.user-management-sidebar.is-collapsed .user-management-sidebar__group-title svg:last-child,
.user-management-sidebar.is-collapsed .user-management-sidebar__collapse span {
  display: none;
}

.user-management-sidebar.is-collapsed .user-management-sidebar__nav button,
.user-management-sidebar.is-collapsed .user-management-sidebar__group-title,
.user-management-sidebar.is-collapsed .user-management-sidebar__collapse {
  justify-content: center;
  padding: 0;
}

.user-management-sidebar.is-collapsed .user-management-sidebar__group > button {
  padding-left: 0;
}

.user-management-sidebar.is-collapsed .user-management-sidebar__collapse svg {
  transform: rotate(180deg);
}

.user-management-workspace {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  background: #f5f7fb;
}

.user-management__breadcrumb {
  display: flex;
  width: min(1520px, calc(100% - 64px));
  min-height: 52px;
  align-items: center;
  gap: 12px;
  margin: 0 auto;
  color: #8593a8;
  font-size: 12px;
}

.user-management__breadcrumb b {
  color: #b1bccb;
  font-weight: 500;
}

.user-management__breadcrumb strong {
  color: #405575;
  font-weight: 700;
}

.user-management {
  width: min(1520px, calc(100% - 64px));
  min-height: 0;
  margin: 0 auto;
  padding: 0 0 32px;
  color: #111827;
}

.user-management__header,
.role-management__list,
.role-management__detail {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 5px 16px rgba(30, 50, 80, 0.04);
}

.user-management__header {
  position: relative;
  display: flex;
  min-height: 128px;
  align-items: center;
  justify-content: space-between;
  overflow: hidden;
  gap: 24px;
  margin-bottom: 14px;
  padding: 22px 26px;
}

.user-management__hero-mark {
  position: absolute;
  right: 24px;
  bottom: -20px;
  color: #edf3fb;
  opacity: 0.9;
}

.user-management__eyebrow {
  margin-bottom: 6px;
  color: #8090a8;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.user-management h1,
.role-management__summary h2 {
  color: #0f172a;
  font-size: 27px;
  font-weight: 850;
  line-height: 1.2;
}

.user-management p,
.role-management__summary p {
  margin-top: 8px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.user-management__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.user-management__metrics article {
  display: flex;
  min-height: 92px;
  align-items: center;
  gap: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 17px 20px;
  box-shadow: 0 5px 16px rgba(30, 50, 80, 0.04);
}

.user-management__metric-icon {
  display: grid;
  width: 50px;
  height: 50px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
}

.user-management__metric-icon.is-blue {
  background: #edf3ff;
  color: #2563eb;
}

.user-management__metric-icon.is-green {
  background: #eaf8f2;
  color: #18a66a;
}

.user-management__metric-icon.is-red {
  background: #fff1f1;
  color: #dc4955;
}

.user-management__metrics article > div {
  display: grid;
  gap: 4px;
}

.user-management__metrics article span {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.user-management__metrics article strong {
  color: #0f213e;
  font-size: 25px;
  font-weight: 800;
  line-height: 1;
}

.user-management__content {
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 5px 16px rgba(30, 50, 80, 0.04);
}

.user-management__actions,
.user-management__toolbar-actions,
.user-management__form-actions,
.user-management__inline-actions,
.user-management__ops,
.user-management__roles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.user-management__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 0;
  padding: 16px 18px;
}

.user-management__search {
  position: relative;
  width: min(300px, 100%);
}

.user-management__search .sci-input {
  width: 100%;
  min-height: 40px;
  padding-left: 40px !important;
  padding-right: 36px !important;
}

.user-management__search input::-webkit-search-cancel-button {
  appearance: none;
}

.user-management__search-icon,
.user-management__search-clear {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}

.user-management__search-icon {
  left: 13px;
  color: #64748b;
  pointer-events: none;
}

.user-management__search-clear {
  right: 7px;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #64748b;
  font-size: 18px;
  cursor: pointer;
}

.user-management__search-clear:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.user-management__toolbar-actions {
  flex: 0 0 auto;
}

.user-management__toolbar-actions .sci-btn {
  display: inline-flex;
  min-width: 108px;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 6px !important;
  padding: 0 14px;
  box-shadow: none !important;
  white-space: nowrap;
}

.user-management__toolbar-actions .sci-btn-primary {
  border-color: #2563eb !important;
  background: #2563eb !important;
  color: #fff !important;
}

.user-management__toolbar-actions .sci-btn-primary:hover:not(:disabled) {
  border-color: #1d4ed8 !important;
  background: #1d4ed8 !important;
  color: #fff !important;
}

.user-management__tabs {
  display: flex;
  min-height: 46px;
  align-items: stretch;
  gap: 6px;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 18px;
}

.user-management__tabs button {
  position: relative;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0 14px;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.user-management__tabs button.active {
  color: #2563eb;
}

.user-management__tabs button.active::after {
  position: absolute;
  right: 8px;
  bottom: -1px;
  left: 8px;
  height: 2px;
  background: #2563eb;
  content: "";
}

.user-management__tabs .user-management__tab-refresh {
  display: inline-flex;
  min-height: 32px;
  align-self: center;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  border: 1px solid #d7e0ec;
  border-radius: 6px;
  padding: 0 11px;
  color: #405575;
}

.user-management__tabs .user-management__tab-refresh::after {
  display: none;
}

.user-management__error,
.user-management__notice,
.user-management__empty {
  margin: 12px 18px;
  border-radius: 6px;
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

.sci-input.is-invalid {
  border-color: #f87171;
  box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.12);
}

.sci-input.is-valid {
  border-color: #34d399;
}

.password-validation-hint {
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.45;
}

.password-validation-hint.error {
  color: #be123c;
}

.password-validation-hint.success {
  color: #047857;
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

.user-management__role-picker label {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.user-management__table {
  overflow-x: auto;
  margin: 0 18px;
  border: 1px solid #dfe5ee;
  border-radius: 6px;
}

.user-management__table-head,
.user-management__row {
  display: grid;
  grid-template-columns: minmax(150px, 1.1fr) minmax(105px, 0.7fr) minmax(250px, 1.8fr) minmax(90px, 0.65fr) minmax(160px, 1fr) minmax(228px, 1.45fr);
  min-width: 1010px;
  gap: 10px;
  align-items: center;
}

.user-management__table-head {
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  padding: 11px 16px;
  color: #475569;
  font-size: 12px;
  font-weight: 800;
}

.user-management__row {
  border-bottom: 1px solid #edf2f7;
  padding: 9px 16px;
  transition: background 0.15s ease;
}

.user-management__row:hover {
  background: #f8fbff;
}

.user-management__row:last-child {
  border-bottom: 0;
}

.user-management__pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-top: 0;
  background: #fff;
  padding: 14px 18px 18px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.user-management__page-controls {
  display: flex;
  align-items: center;
  gap: 5px;
}

.user-management__page-size {
  min-width: 96px;
  margin-right: 6px;
  border: 1px solid #d7e0ec;
  border-radius: 6px;
  padding: 7px 10px;
  background: #fff;
  color: #405575;
  text-align: center;
}

.user-management__page-controls button {
  display: grid;
  min-width: 30px;
  height: 30px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #334155;
  font-size: 12px;
  cursor: pointer;
}

.user-management__page-controls button:hover:not(:disabled) {
  background: #eff4fb;
  color: #2563eb;
}

.user-management__page-controls button.active {
  background: #2563eb;
  color: #fff;
}

.user-management__page-controls button:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.user-management__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
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

.user-management__modules,
.role-management__module-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.user-management__role,
.user-management__module {
  display: inline-flex;
  align-items: center;
  min-height: 23px;
  border-radius: 5px;
  padding: 3px 8px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 700;
}

.user-management__module {
  background: #eff6ff;
  color: #2563eb;
}

.user-management__muted {
  color: #94a3b8;
  font-size: 12px;
}

.user-management__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #334155;
  font-size: 12px;
  font-weight: 650;
}

.user-management__status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #20b766;
}

.user-management__status.is-disabled {
  color: #475569;
}

.user-management__status.is-disabled .user-management__status-dot {
  background: #ef4444;
}

.user-management__danger {
  border-color: #fecaca !important;
  color: #be123c !important;
}

.user-management__ops {
  flex-wrap: nowrap;
}

.user-management__ops .sci-btn {
  min-height: 31px;
  border-radius: 6px !important;
  padding: 6px 11px;
  box-shadow: none !important;
  font-size: 11px;
  white-space: nowrap;
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
  grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.role-management__list,
.role-management__detail {
  padding: 20px;
}

.role-management__list {
  max-height: calc(100vh - 260px);
  overflow-y: auto;
}

.role-management__detail {
  display: flex;
  min-height: 520px;
  max-height: none;
  flex-direction: column;
  overflow: visible;
}

.role-management__new {
  width: 100%;
  margin-bottom: 12px;
  justify-content: center;
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
  padding: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.role-management__item.active {
  border-color: #60a5fa;
  background: #eff6ff;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.1);
}

.role-management__item strong,
.role-management__item small {
  display: block;
}

.role-management__item strong {
  color: #0f172a;
  font-size: 13px;
}

.role-management__item > span {
  min-width: 0;
}

.role-management__item > span small {
  overflow: hidden;
  max-width: 190px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-management__item small,
.role-management__item em {
  color: #64748b;
  font-size: 12px;
  font-style: normal;
}

.role-management__item em {
  flex: 0 0 auto;
  max-width: 96px;
  text-align: right;
}

.role-management__summary {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 18px;
}

.role-management__summary h2 {
  font-size: 20px;
}

.role-management__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.role-management__badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 3px 9px;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 800;
}

.role-management__badge.muted {
  background: #f1f5f9;
  color: #475569;
}

.role-management__meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.role-management__meta div {
  min-width: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 10px;
}

.role-management__meta dt {
  color: #64748b;
  font-size: 11px;
  font-weight: 800;
}

.role-management__meta dd {
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
}

.role-management__content {
  display: grid;
  gap: 18px;
}

.role-detail-section,
.role-note-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 16px;
}

.role-module-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.role-module-card {
  display: flex;
  min-height: 128px;
  gap: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 14px;
  color: #64748b;
}

.role-module-card.enabled {
  border-color: #60a5fa;
  background: #eff6ff;
  box-shadow: 0 8px 22px rgba(37, 99, 235, 0.1);
  color: #1e40af;
}

.role-module-card__icon,
.drawer-module-card__icon {
  display: inline-grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 8px;
  background: #e2e8f0;
  color: #475569;
  font-size: 13px;
  font-weight: 900;
}

.role-module-card.enabled .role-module-card__icon,
.drawer-module-card.selected .drawer-module-card__icon {
  background: #bfdbfe;
  color: #1d4ed8;
}

.role-module-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.role-module-card strong,
.drawer-module-card strong {
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

.role-module-card__head span {
  flex: 0 0 auto;
  border-radius: 999px;
  background: #e2e8f0;
  padding: 3px 8px;
  color: #64748b;
  font-size: 11px;
  font-weight: 800;
}

.role-module-card.enabled .role-module-card__head span {
  background: #dbeafe;
  color: #1d4ed8;
}

.role-module-card p,
.role-note-card p,
.drawer-module-card small {
  margin-top: 8px;
  color: #64748b;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
}

.module-permission-section {
  display: grid;
  gap: 12px;
}

.drawer-module-grid {
  display: grid;
  gap: 10px;
}

.drawer-module-card {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: 10px;
  align-items: flex-start;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 12px;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.drawer-module-card.selected {
  border-color: #60a5fa;
  background: #eff6ff;
  box-shadow: 0 8px 22px rgba(37, 99, 235, 0.1);
}

.drawer-module-card input {
  margin-top: 9px;
  width: 16px;
  height: 16px;
}

.drawer-module-card > span:last-child {
  min-width: 0;
}

.system-permission-hint {
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  padding: 10px 12px;
  color: #1e40af;
  font-size: 12px;
  line-height: 1.7;
}

.role-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 990;
  background: rgba(15, 23, 42, 0.24);
}

.role-drawer {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 1000;
  width: min(460px, 100vw);
  height: 100vh;
  background: #fff;
  box-shadow: -22px 0 48px rgba(15, 23, 42, 0.18);
}

.role-drawer__form {
  display: flex;
  height: 100%;
  flex-direction: column;
}

.role-drawer__header {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #e2e8f0;
  padding: 22px 24px 18px;
}

.role-drawer__header p {
  margin: 0 0 6px;
  color: #0369a1;
  font-family: "Fira Code", monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.role-drawer__header h2 {
  color: #0f172a;
  font-size: 22px;
  font-weight: 900;
}

.role-drawer__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 22px 24px 28px;
}

.role-drawer__field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 16px;
  color: #334155;
  font-size: 12px;
  font-weight: 800;
}

.role-drawer__field textarea {
  min-height: 112px;
  resize: vertical;
}

.role-drawer__field small {
  align-self: flex-end;
  color: #94a3b8;
  font-size: 11px;
}

.role-drawer__footer {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid #e2e8f0;
  background: rgba(255, 255, 255, 0.98);
  padding: 16px 24px;
}

.user-management__create-backdrop {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: 24px 16px;
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(4px);
}

.user-management__create-dialog {
  width: min(640px, 100%);
  max-height: calc(100vh - 48px);
  overflow: hidden;
  border: 1px solid #dbe3ee;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
}

.user-management__create-dialog-form {
  display: flex;
  max-height: calc(100vh - 48px);
  flex-direction: column;
}

.user-management__create-dialog-header,
.user-management__create-dialog-footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
}

.user-management__create-dialog-header {
  border-bottom: 1px solid #e2e8f0;
}

.user-management__create-dialog-header p {
  margin: 0 0 4px;
  color: #0369a1;
  font-family: "Fira Code", monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.user-management__create-dialog-header h2 {
  margin: 0;
  color: #0f172a;
  font-size: 20px;
  font-weight: 800;
}

.user-management__create-dialog-close {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #64748b;
  font-size: 20px;
  cursor: pointer;
}

.user-management__create-dialog-close:hover:not(:disabled) {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.user-management__create-dialog-close:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.user-management__create-dialog-body {
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
}

.user-management__create-dialog-body .user-management__error {
  margin-bottom: 16px;
}

.user-management__create-dialog .user-management__form-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.user-management__create-dialog .user-management__form-grid > label {
  grid-column: span 1;
}

.user-management__create-dialog .user-management__role-picker {
  grid-column: 1 / -1;
}

.user-management__create-dialog-footer {
  justify-content: flex-end;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

@media (max-width: 1100px) {
  .user-management__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .role-management {
    grid-template-columns: 1fr;
  }

  .role-management__list {
    max-height: 360px;
  }

  .role-management__meta,
  .role-module-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 920px) {
  .user-management-sidebar {
    display: none;
  }

  .user-management__breadcrumb,
  .user-management {
    width: min(100% - 32px, 1520px);
  }
}

@media (max-width: 760px) {
  .user-management {
    width: min(100% - 24px, 1520px);
  }

  .user-management__breadcrumb {
    width: min(100% - 24px, 1520px);
  }

  .user-management__metrics {
    grid-template-columns: 1fr;
  }

  .user-management__header {
    min-height: 118px;
    padding: 20px;
  }

  .user-management__hero-mark {
    right: -20px;
    opacity: 0.55;
  }

  .user-management__header,
  .role-management__summary {
    flex-direction: column;
  }

  .user-management__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .user-management__search {
    width: 100%;
  }

  .user-management__toolbar-actions {
    justify-content: flex-end;
  }

  .user-management__form-grid,
  .user-management__inline-form,
  .user-management__inline-form.is-password,
  .role-management__meta,
  .role-module-grid {
    grid-template-columns: 1fr;
  }

  .user-management__form-grid label,
  .user-management__form-actions,
  .user-management__role-picker,
  .user-management__role-picker.compact {
    grid-column: auto;
  }

  .role-drawer {
    width: 100vw;
  }

  .user-management__pagination {
    align-items: stretch;
    flex-direction: column;
  }

  .user-management__page-controls {
    overflow-x: auto;
  }

  .user-management__create-backdrop {
    align-items: flex-end;
    padding: 12px;
  }

  .user-management__create-dialog,
  .user-management__create-dialog-form {
    max-height: calc(100vh - 24px);
  }

  .user-management__create-dialog .user-management__form-grid {
    grid-template-columns: 1fr;
  }

  .user-management__create-dialog .user-management__role-picker {
    grid-column: auto;
  }
}
</style>
