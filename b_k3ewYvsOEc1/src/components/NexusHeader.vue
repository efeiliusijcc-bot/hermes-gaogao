<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { fetchResearchKeys, fetchVectorSourceStatus, switchVectorSourceProfile, updateResearchKeys } from '../lib/api.js'

const props = defineProps({
  user: {
    type: Object,
    default: null,
  },
  authLoading: {
    type: Boolean,
    default: false,
  },
  authError: {
    type: String,
    default: '',
  },
  authNotice: {
    type: String,
    default: '',
  },
  currentWorkspace: {
    type: String,
    default: 'report',
  },
})

const emit = defineEmits(['return-home', 'login', 'logout', 'open-user-management', 'open-personal-settings', 'switch-workspace'])

const currentTime = ref('')
const canvasRef = ref(null)
const workspaceNavRef = ref(null)
const settingsButtonRef = ref(null)
const settingsMenuRef = ref(null)
const workspaceNavOpen = ref(false)
const showSettingsMenu = ref(false)
const settingsMenuStyle = ref({})
const showKeySettings = ref(false)
const keyStatus = ref(null)
const keyForm = ref({
  tavilyApiKey: '',
  exaApiKey: '',
  firecrawlApiKey: '',
  openaiEmbeddingApiKey: '',
})
const keyClears = ref({
  tavilyApiKey: false,
  exaApiKey: false,
  firecrawlApiKey: false,
  openaiEmbeddingApiKey: false,
})
const keyLoading = ref(false)
const keySaving = ref(false)
const keyError = ref('')
const keyNotice = ref('')
const vectorStatus = ref(null)
const vectorRefreshing = ref(false)
const vectorSwitching = ref(false)
const showLoginDialog = ref(false)
const showPassword = ref(false)
const loginError = ref('')
const loginTouched = reactive({
  username: false,
  password: false,
})
const usernameInputRef = ref(null)
const loginForm = reactive({
  username: '',
  password: '',
})

const isAdmin = computed(() => props.user?.role === 'admin')
const displayUserName = computed(() => props.user?.displayName || props.user?.username || '')
const loginExpiredNotice = computed(() => {
  const notice = String(props.authNotice || '')
  return /失效|重新登录|过期/i.test(notice) ? '登录状态已失效，请重新登录。' : ''
})
const usernameRequired = computed(() => loginTouched.username && !loginForm.username.trim())
const passwordRequired = computed(() => loginTouched.password && !loginForm.password.trim())
const loginStatusMessage = computed(() => loginError.value || loginExpiredNotice.value)
const workspaceItems = [
  { key: 'report', title: 'AI智能体深度编报' },
  { key: 'qa', title: 'QA问答' },
  { key: 'daily', title: '每日动态感知' },
  { key: 'draft', title: '拟稿助手' },
]
const activeWorkspaceItem = computed(() => {
  return workspaceItems.find((item) => item.key === props.currentWorkspace) || workspaceItems[0]
})

const keyFields = [
  { key: 'tavilyApiKey', label: 'Tavily', placeholder: 'tvly-...，每行一个，可配置多个' },
  { key: 'exaApiKey', label: 'Exa', placeholder: 'Exa API Key，每行一个，可配置多个' },
  { key: 'firecrawlApiKey', label: 'Firecrawl', placeholder: 'fc-...，每行一个，可配置多个' },
  { key: 'openaiEmbeddingApiKey', label: 'OpenAI Embedding', placeholder: 'sk-...，每行一个，可配置多个' },
]

const emptyKeyForm = () => ({
  tavilyApiKey: '',
  exaApiKey: '',
  firecrawlApiKey: '',
  openaiEmbeddingApiKey: '',
})

const emptyKeyClears = () => ({
  tavilyApiKey: false,
  exaApiKey: false,
  firecrawlApiKey: false,
  openaiEmbeddingApiKey: false,
})

function updateTime() {
  currentTime.value = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

async function loadResearchKeys() {
  keyLoading.value = true
  keyError.value = ''
  try {
    const [keys, vector] = await Promise.allSettled([fetchResearchKeys(), fetchVectorSourceStatus()])
    if (keys.status === 'fulfilled') keyStatus.value = keys.value
    else throw keys.reason
    if (vector.status === 'fulfilled') vectorStatus.value = vector.value
  } catch (error) {
    keyError.value = error instanceof Error ? error.message : String(error)
  } finally {
    keyLoading.value = false
  }
}

async function refreshVectorStatus() {
  vectorRefreshing.value = true
  try {
    vectorStatus.value = await fetchVectorSourceStatus()
  } catch (error) {
    keyError.value = error instanceof Error ? error.message : String(error)
  } finally {
    vectorRefreshing.value = false
  }
}

function vectorStatusTime(value) {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

async function changeVectorProfile(profile) {
  if (!profile || profile === vectorStatus.value?.activeProfile) return
  vectorSwitching.value = true
  keyError.value = ''
  keyNotice.value = ''
  try {
    vectorStatus.value = await switchVectorSourceProfile(profile)
    keyNotice.value = '向量检索配置已切换，后续主题召回立即使用当前模型。'
  } catch (error) {
    keyError.value = error instanceof Error ? error.message : String(error)
  } finally {
    vectorSwitching.value = false
  }
}

function openKeySettings() {
  showSettingsMenu.value = false
  showKeySettings.value = true
  keyNotice.value = ''
  keyError.value = ''
  keyForm.value = emptyKeyForm()
  keyClears.value = emptyKeyClears()
  startVectorStatusPolling()
  void loadResearchKeys()
}

function openLoginDialog() {
  closeSettingsMenu()
  loginError.value = ''
  loginTouched.username = false
  loginTouched.password = false
  loginForm.password = ''
  showPassword.value = false
  showLoginDialog.value = true
  nextTick(() => usernameInputRef.value?.focus())
}

function closeLoginDialog() {
  if (!props.authLoading) {
    showLoginDialog.value = false
    loginError.value = ''
    loginTouched.username = false
    loginTouched.password = false
    showPassword.value = false
  }
}

function submitLogin() {
  if (props.authLoading) return
  loginTouched.username = true
  loginTouched.password = true
  loginError.value = ''
  if (!loginForm.username.trim() || !loginForm.password.trim()) {
    loginError.value = '请填写用户名和密码。'
    return
  }
  emit('login', {
    username: loginForm.username.trim(),
    password: loginForm.password,
  })
}

function togglePasswordVisibility() {
  showPassword.value = !showPassword.value
}

function logout() {
  closeSettingsMenu()
  emit('logout')
}

function openUserManagement() {
  closeSettingsMenu()
  emit('open-user-management')
}

function openPersonalSettings() {
  closeSettingsMenu()
  emit('open-personal-settings')
}

function roleLabel(role) {
  if (role === 'admin') return '管理员'
  if (role === 'operator') return '操作员'
  if (role === 'viewer') return '观察员'
  return role || '--'
}

function closeKeySettings() {
  if (!keySaving.value) {
    showKeySettings.value = false
    stopVectorStatusPolling()
  }
}

function updateSettingsMenuPosition() {
  const button = settingsButtonRef.value
  if (!button) return
  const rect = button.getBoundingClientRect()
  settingsMenuStyle.value = {
    top: `${rect.bottom + 8}px`,
    right: `${Math.max(16, window.innerWidth - rect.right)}px`,
  }
}

function toggleSettingsMenu(event) {
  event?.stopPropagation()
  if (!showSettingsMenu.value) updateSettingsMenuPosition()
  showSettingsMenu.value = !showSettingsMenu.value
}

function closeSettingsMenu() {
  showSettingsMenu.value = false
}

let workspaceNavCloseTimer = null

function openWorkspaceNav() {
  if (workspaceNavCloseTimer) {
    clearTimeout(workspaceNavCloseTimer)
    workspaceNavCloseTimer = null
  }
  workspaceNavOpen.value = true
}

function scheduleWorkspaceNavClose() {
  if (workspaceNavCloseTimer) clearTimeout(workspaceNavCloseTimer)
  workspaceNavCloseTimer = window.setTimeout(() => {
    workspaceNavOpen.value = false
    workspaceNavCloseTimer = null
  }, 180)
}

function closeWorkspaceNav() {
  if (workspaceNavCloseTimer) {
    clearTimeout(workspaceNavCloseTimer)
    workspaceNavCloseTimer = null
  }
  workspaceNavOpen.value = false
}

function toggleWorkspaceNav() {
  if (workspaceNavOpen.value) closeWorkspaceNav()
  else openWorkspaceNav()
}

function switchWorkspace(key) {
  closeWorkspaceNav()
  emit('switch-workspace', key)
}

function handleDocumentClick(event) {
  const menu = settingsMenuRef.value
  const button = settingsButtonRef.value
  if (menu?.contains(event.target) || button?.contains(event.target)) return
  if (workspaceNavRef.value?.contains(event.target)) return
  closeSettingsMenu()
  closeWorkspaceNav()
}

function handleDocumentKeydown(event) {
  if (event.key === 'Escape') closeSettingsMenu()
  if (event.key === 'Escape') closeLoginDialog()
  if (event.key === 'Escape') closeWorkspaceNav()
}

function handleWindowResize() {
  if (showSettingsMenu.value) updateSettingsMenuPosition()
}

function configuredLabel(name) {
  const item = keyStatus.value?.[name]
  const count = Number(item?.configuredCount || 0)
  if (count > 0) return `已配置 ${count} 个`
  return item?.configured ? '已配置' : '未配置'
}

function configuredClass(name) {
  return keyStatus.value?.[name]?.configured ? 'text-emerald-600' : 'text-slate-500'
}

function toggleClear(name) {
  keyClears.value = {
    ...keyClears.value,
    [name]: !keyClears.value[name],
  }
  if (keyClears.value[name]) {
    keyForm.value = { ...keyForm.value, [name]: '' }
  }
}

async function saveResearchKeys() {
  keySaving.value = true
  keyError.value = ''
  keyNotice.value = ''

  const body = {}
  for (const field of keyFields) {
    const value = keyForm.value[field.key]?.trim()
    if (keyClears.value[field.key]) body[field.key] = null
    else if (value) body[field.key] = value
  }

  try {
    keyStatus.value = await updateResearchKeys(body)
    await refreshVectorStatus()
    keyNotice.value = '配置已保存，下一次编报和向量检索会按顺序自动切换可用 Key。'
    keyForm.value = emptyKeyForm()
    keyClears.value = emptyKeyClears()
  } catch (error) {
    keyError.value = error instanceof Error ? error.message : String(error)
  } finally {
    keySaving.value = false
  }
}

let timeInterval = null
let vectorStatusInterval = null
let animFrameId = null
const barCount = 40
const barHeights = new Float32Array(barCount)
const targetHeights = new Float32Array(barCount)

for (let i = 0; i < barCount; i++) {
  barHeights[i] = Math.random() * 28 + 8
  targetHeights[i] = barHeights[i]
}

function drawWave() {
  const canvas = canvasRef.value
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()

  if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
  }

  ctx.clearRect(0, 0, rect.width, rect.height)

  const barWidth = 3
  const gap = (rect.width - barCount * barWidth) / (barCount - 1)

  for (let i = 0; i < barCount; i++) {
    barHeights[i] += (targetHeights[i] - barHeights[i]) * 0.15

    if (Math.random() < 0.08) {
      targetHeights[i] = Math.random() * 30 + 8
    }

    const x = i * (barWidth + gap)
    const y = rect.height - barHeights[i]
    const h = barHeights[i]
    const alpha = 0.25 + (h / 38) * 0.45
    ctx.fillStyle = `rgba(14, 165, 233, ${alpha.toFixed(2)})`
    ctx.fillRect(x, y, barWidth, h)

    if (h > 20) {
      const tipH = Math.min(h * 0.35, 12)
      ctx.fillStyle = 'rgba(0, 200, 220, 0.55)'
      ctx.fillRect(x, y, barWidth, tipH)
    }
  }

  animFrameId = requestAnimationFrame(drawWave)
}

function startVectorStatusPolling() {
  stopVectorStatusPolling()
  vectorStatusInterval = window.setInterval(() => {
    if (showKeySettings.value && !vectorRefreshing.value) void refreshVectorStatus()
  }, 15000)
}

function stopVectorStatusPolling() {
  if (vectorStatusInterval) {
    window.clearInterval(vectorStatusInterval)
    vectorStatusInterval = null
  }
}

onMounted(() => {
  updateTime()
  timeInterval = window.setInterval(updateTime, 1000)
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleDocumentKeydown)
  window.addEventListener('resize', handleWindowResize)
  drawWave()
})

onUnmounted(() => {
  window.clearInterval(timeInterval)
  stopVectorStatusPolling()
  closeWorkspaceNav()
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleDocumentKeydown)
  window.removeEventListener('resize', handleWindowResize)
  if (animFrameId) cancelAnimationFrame(animFrameId)
})

watch(() => props.user, (user) => {
  if (user) showLoginDialog.value = false
})

watch(() => props.authNotice, (notice) => {
  if (!props.user && /失效|重新登录|过期/i.test(String(notice || ''))) showLoginDialog.value = true
})

watch(() => props.authError, (error) => {
  if (!error || props.user) return
  loginError.value = '用户名或密码错误，请重新输入。'
  loginForm.password = ''
  loginTouched.password = false
})
</script>

<template>
  <header class="topbar flex items-center justify-between px-6">
    <div class="header-brand flex items-center">
      <button
        class="header-home-btn"
        type="button"
        aria-label="返回首页"
        title="返回首页"
        @click="emit('return-home')"
      >
        ‹
      </button>
      <span class="font-mono tracking-wide" style="font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: 0.02em; line-height: 1.2;">
        AI深度编报
      </span>
    </div>

    <div class="header-center">
      <div
        ref="workspaceNavRef"
        class="workspace-quick-nav header-workspace-nav"
        :class="{ expanded: workspaceNavOpen }"
        @mouseenter="openWorkspaceNav"
        @mouseleave="scheduleWorkspaceNavClose"
        @focusin="openWorkspaceNav"
      >
        <button
          class="workspace-quick-trigger"
          type="button"
          :aria-expanded="workspaceNavOpen"
          aria-controls="global-workspace-quick-options"
          @click.stop="toggleWorkspaceNav"
        >
          <span>当前模块：{{ activeWorkspaceItem.title }}</span>
          <span class="workspace-quick-chevron">▾</span>
        </button>
        <div id="global-workspace-quick-options" class="workspace-quick-options" role="tablist" aria-label="全局工作区导航">
          <button
            v-for="item in workspaceItems"
            :key="item.key"
            class="workspace-quick-option"
            :class="{ active: item.key === currentWorkspace }"
            type="button"
            role="tab"
            :aria-selected="item.key === currentWorkspace"
            @click.stop="switchWorkspace(item.key)"
          >
            {{ item.title }}
          </button>
        </div>
      </div>
    </div>

    <div class="header-tech-line flex-1 mx-8 h-10">
      <canvas ref="canvasRef" class="w-full h-full"></canvas>
    </div>

    <div class="header-right-actions">
      <div class="header-time flex flex-col items-end">
        <span class="font-mono text-[8px] text-slate-400 tracking-widest mb-1">系统时间</span>
        <span class="font-mono text-xs text-slate-700 tracking-wider">{{ currentTime }}</span>
      </div>

      <button
        v-if="!user"
        class="sci-btn header-login-btn"
        type="button"
        :disabled="authLoading"
        @click="openLoginDialog"
      >
        登录
      </button>

      <div v-else class="header-user-chip">
        <span class="header-user-name">{{ displayUserName }}</span>
        <span class="header-user-role">{{ roleLabel(user.role) }}</span>
      </div>

      <button
        v-if="isAdmin"
        class="sci-btn header-login-btn"
        type="button"
        @click="openUserManagement"
      >
        用户管理
      </button>

      <button
        v-if="user"
        class="sci-btn header-login-btn"
        type="button"
        @click="logout"
      >
        退出登录
      </button>

      <div class="header-settings relative">
        <button
          ref="settingsButtonRef"
          class="settings-icon-btn"
          type="button"
          aria-label="设置"
          :aria-expanded="showSettingsMenu"
          title="设置"
          @click.stop="toggleSettingsMenu"
        >
          ⚙
        </button>
      </div>
    </div>
  </header>

  <Teleport to="body">
    <div
      v-if="showSettingsMenu"
      ref="settingsMenuRef"
      class="settings-dropdown"
      role="menu"
      :style="settingsMenuStyle"
      @click.stop
    >
      <button v-if="user" class="settings-dropdown-item" type="button" role="menuitem" @click="openPersonalSettings">
        <span class="settings-menu-icon">◌</span>
        <span>个人设置</span>
      </button>
      <button class="settings-dropdown-item" type="button" role="menuitem" @click="openKeySettings">
        <span class="settings-menu-icon">⌁</span>
        <span>信源设置</span>
      </button>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="showLoginDialog"
      class="login-modal-backdrop"
      @click.self="closeLoginDialog"
    >
      <section class="login-dialog" role="dialog" aria-modal="true" aria-labelledby="login-dialog-title">
        <div class="login-dialog-head">
          <div>
            <h2 id="login-dialog-title">账号登录</h2>
            <p>登录后进入 AI 深度编报系统</p>
          </div>
          <button class="login-close-btn" type="button" :disabled="authLoading" aria-label="关闭登录窗口" @click="closeLoginDialog">×</button>
        </div>
        <form class="login-dialog-body" @submit.prevent="submitLogin">
          <label class="login-field" :class="{ invalid: usernameRequired }">
            <span>用户名</span>
            <input
              ref="usernameInputRef"
              v-model="loginForm.username"
              autocomplete="username"
              placeholder="请输入用户名"
              @blur="loginTouched.username = true"
            />
            <small v-if="usernameRequired">请输入用户名</small>
          </label>
          <label class="login-field" :class="{ invalid: passwordRequired }">
            <span>密码</span>
            <div class="login-password-control">
              <input
                v-model="loginForm.password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="请输入密码"
                @blur="loginTouched.password = true"
              />
              <button type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="togglePasswordVisibility">
                {{ showPassword ? '隐藏' : '显示' }}
              </button>
            </div>
            <small v-if="passwordRequired">请输入密码</small>
          </label>
          <div
            v-if="loginStatusMessage"
            class="login-dialog-message"
            :class="loginExpiredNotice && !loginError ? 'warning' : 'error'"
          >
            {{ loginStatusMessage }}
          </div>
          <p class="login-helper-text">请使用管理员分配的账号登录</p>
          <div class="login-dialog-actions">
            <button class="login-secondary-btn" type="button" :disabled="authLoading" @click="closeLoginDialog">取消</button>
            <button class="login-primary-btn" type="submit" :disabled="authLoading">
              {{ authLoading ? '登录中...' : '登录' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="showKeySettings"
      class="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-slate-900/30 px-4 py-6 backdrop-blur-sm"
      @click.self="closeKeySettings"
    >
      <section class="flex max-h-[calc(100vh-3rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div class="shrink-0 border-b border-slate-100 px-5 pb-4 pt-5">
          <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="font-mono text-lg font-bold text-slate-900">信源设置</h2>
            <p class="mt-1 text-xs leading-relaxed text-slate-500">配置 Tavily、Exa、Firecrawl 和向量检索 API Key。密钥只保存在服务器，前端不回显明文。</p>
          </div>
          <button class="sci-btn px-3 py-2 text-[10px]" type="button" @click="closeKeySettings">关闭</button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 overscroll-contain">
          <div v-if="keyLoading" class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            正在读取配置状态...
          </div>

          <div v-else class="space-y-3">
          <div
            v-for="field in keyFields"
            :key="field.key"
            class="rounded-xl border border-slate-200 bg-slate-50/80 p-3"
          >
            <div class="mb-2 flex items-center justify-between gap-3">
              <div class="font-mono text-sm font-semibold text-slate-900">{{ field.label }}</div>
              <div class="font-mono text-[11px]" :class="configuredClass(field.key)">
                {{ configuredLabel(field.key) }}
              </div>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <textarea
                class="sci-input min-h-24 flex-1 resize-y text-sm"
                autocomplete="off"
                :disabled="keyClears[field.key]"
                :placeholder="keyClears[field.key] ? '保存后清除该 Key' : field.placeholder"
                :value="keyForm[field.key]"
                @input="keyForm = { ...keyForm, [field.key]: $event.target.value }"
              ></textarea>
              <button
                class="sci-btn shrink-0 px-3 py-2 text-[10px]"
                type="button"
                @click="toggleClear(field.key)"
              >
                {{ keyClears[field.key] ? '取消清除' : '清除' }}
              </button>
            </div>
          </div>
          <div v-if="vectorStatus" class="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
            <div class="mb-2 flex items-center justify-between gap-3">
              <div class="font-mono text-[11px] font-bold tracking-widest text-slate-500">向量检索配置</div>
              <button
                class="sci-btn px-2 py-1 text-[10px]"
                type="button"
                :disabled="vectorRefreshing"
                @click="refreshVectorStatus"
              >
                {{ vectorRefreshing ? '刷新中...' : '刷新' }}
              </button>
            </div>
            <label class="mb-3 block">
              <span class="mb-1 block text-[10px] text-slate-400">当前主题向量模型</span>
              <select
                class="sci-input w-full text-sm"
                :value="vectorStatus.activeProfile"
                :disabled="vectorSwitching"
                @change="changeVectorProfile($event.target.value)"
              >
                <option
                  v-for="profile in vectorStatus.availableProfiles || []"
                  :key="profile.key"
                  :value="profile.key"
                >
                  {{ profile.label }} / {{ profile.sourceTable }}
                </option>
              </select>
            </label>
            <div class="grid gap-2 sm:grid-cols-2">
              <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <span class="block text-[10px] text-slate-400">状态</span>
                <strong :class="vectorStatus.available ? 'text-emerald-600' : 'text-amber-600'">{{ vectorStatus.available ? '可用' : '未就绪' }}</strong>
              </div>
              <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <span class="block text-[10px] text-slate-400">已索引数据量</span>
                <strong class="text-slate-900">{{ Number(vectorStatus.indexedRows || 0).toLocaleString('zh-CN') }} 条</strong>
              </div>
              <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 sm:col-span-2">
                <span class="block text-[10px] text-slate-400">当前表</span>
                <strong class="break-all text-slate-900">{{ vectorStatus.activeTable || vectorStatus.sourceTable || '--' }}</strong>
              </div>
              <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <span class="block text-[10px] text-slate-400">模型</span>
                <strong class="text-slate-900">{{ vectorStatus.embeddingModel || '--' }}</strong>
              </div>
              <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <span class="block text-[10px] text-slate-400">更新时间</span>
                <strong class="text-slate-900">{{ vectorStatusTime(vectorStatus.lastIndexedAt) }}</strong>
              </div>
            </div>
            <div v-if="vectorStatus.fallbackReason" class="mt-1 text-amber-600">{{ vectorStatus.fallbackReason }}</div>
          </div>

          <div v-if="keyError" class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {{ keyError }}
          </div>
          <div v-if="keyNotice" class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {{ keyNotice }}
          </div>
        </div>
        </div>

        <div class="shrink-0 border-t border-slate-100 bg-white px-5 py-4 flex items-center justify-end gap-2">
          <button class="sci-btn px-4 py-2 text-[10px]" type="button" :disabled="keySaving" @click="closeKeySettings">
            取消
          </button>
          <button class="sci-btn sci-btn-primary px-4 py-2 text-[10px]" type="button" :disabled="keySaving || keyLoading" @click="saveResearchKeys">
            {{ keySaving ? '保存中...' : '保存配置' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
