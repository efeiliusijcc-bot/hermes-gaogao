<script setup>
import NexusHeader from './components/NexusHeader.vue'
import ControlPanel from './components/ControlPanel.vue'
import DataCanvas from './components/DataCanvas.vue'
import DailyAwareness from './components/DailyAwareness.vue'
import DraftAssistant from './components/DraftAssistant.vue'
import DraftAnalysisNotice from './components/DraftAnalysisNotice.vue'
import { createDraftAnalysisStore } from './lib/draftAnalysisStore.js'
import { AUTH_USER_KEY, getStoredAuthUser, submitDraftAnalysisJob, getDraftAnalysisJobs, retryDraftAnalysisJob } from './lib/api.js'
import PersonalSettings from './components/PersonalSettings.vue'
import UserManual from './components/UserManual.vue'
import UserManagement from './components/UserManagement.vue'
import { useAuth } from './composables/useAuth.js'
import { useReportJobs } from './composables/useReportJobs.js'
import { deriveUserModules } from './lib/permissionModules.js'
import { normalizeManualSection } from './lib/userManualNavigation.js'
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Trash2 } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const {
  updatePlanningBuffer,
  planningDraft,
  planningVisible,
  planningStorageWarning,
  planningConflict,
  setPlanningAccount,
  suspendPlanning,
  resumePlanning,
  discardPlanning,
  requestNewPlanning,
  resolvePlanningConflict,
  retryPlanning,
  retryPlanningSubmission,
  currentView,
  title,
  reportType,
  countryOrRegion,
  currentPosition,
  scenario,
  targetCity,
  visitTime,
  contextText,
  parameterValues,
  activeParameters,
  outputDepth,
  isGenerating,
  isPlanning,
  reportPlan,
  planStepIndex,
  planSelections,
  planSearchSelections,
  planSourceInput,
  planSupplement,
  databaseSourceEnabled,
  useMyPreferences,
  deepReportEnabled,
  databaseSources,
  databaseSourcesLoading,
  planError,
  generatedHtml,
  phase,
  processLogs,
  loadingStep,
  job,
  recentJobs,
  recentLoadingMore,
  recentHasMore,
  recentLoadError,
  health,
  errorMessage,
  detailLoading,
  detailLoadError,
  filteredJobs,
  openedHistoryJobId,
  listSearch,
  listPage,
  listPageSize,
  listTotal,
  listTotalPages,
  listTrashMode,
  isHistoryMode,
  hasActiveWorkspace,
  activeWorkspaceJobId,
  activeWorkspaceStatus,
  returnableWorkspaceJobId,
  savedNotice,
  executionLogs,
  progressState,
  unreadLogCount,
  isLogDrawerOpen,
  vectorSourceStatus,
  vectorSourceStatusLoading,
  getJobTitle,
  handleGenerate,
  confirmReportPlan,
  cancelReportPlan,
  togglePlanOption,
  addPlanOption,
  togglePlanSearchQuery,
  resolvePlanIntent,
  updatePlanEventTask,
  nextPlanStep,
  prevPlanStep,
  refreshHealth,
  refreshRecentReports,
  clearReportHistoryState,
  loadMoreRecentReports,
  loadJobList,
  updateListSearch,
  updateListPage,
  updateListPageSize,
  monitorJobFromList,
  deleteReportFromList,
  restoreReportFromTrash,
  permanentlyDeleteReportFromTrash,
  retryOpenCurrentHistoryReport,
  showGenerator,
  backgroundActiveWorkspace,
  resetForNewReport,
  saveCurrentReportDraft,
  toggleLogDrawer,
} = useReportJobs()

const QA_HISTORY_KEY = 'nexus-qa-history'
const homeMode = ref('report')
const selectedQaSessionId = ref('')
const showUserManagement = ref(false)
const showDraftAssistant = ref(false)
const showDailyAwareness = ref(false)
const accountInSidebar = computed(() => (
  !showUserManagement.value &&
  (showDraftAssistant.value || showDailyAwareness.value || currentView.value === 'generator')
))
const showPersonalSettings = ref(false)
const showUserManual = ref(false)
const manualInitialSection = ref('report')
const draftInitialEventId = ref('')
const draftOpenRequest = ref(null)
const nexusHeaderRef = ref(null)
const {
  currentUser: authUser,
  isLoading: authLoading,
  errorMessage: authError,
  notice: authNotice,
  initializeAuth,
  login: loginUser,
  logout: logoutUser,
  setNotice: setAuthNotice,
} = useAuth()
const draftAnalysis = createDraftAnalysisStore({
  api: { submit: submitDraftAnalysisJob, list: getDraftAnalysisJobs, retry: retryDraftAnalysisJob },
})
const refreshDraftAnalysis = () => { void draftAnalysis.refresh() }
const syncDraftAccount = (event) => {
  if (event.key !== AUTH_USER_KEY || getStoredAuthUser()?.id === authUser.value?.id) return
  draftAnalysis.logout()
  authUser.value = null
  void initializeAuth()
}
onMounted(() => {
  window.addEventListener('online', refreshDraftAnalysis)
  window.addEventListener('offline', refreshDraftAnalysis)
  document.addEventListener('visibilitychange', refreshDraftAnalysis)
  window.addEventListener('storage', syncDraftAccount)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', refreshDraftAnalysis)
  window.removeEventListener('offline', refreshDraftAnalysis)
  document.removeEventListener('visibilitychange', refreshDraftAnalysis)
  window.removeEventListener('storage', syncDraftAccount)
  draftAnalysis.dispose()
})
const qaSessions = ref(loadStoredQaSessions())
const authReady = ref(false)
const planningConflictPanel = ref(null)
watch(planningConflict, async (open) => {
  if (open) {
    await nextTick()
    planningConflictPanel.value?.focus()
  }
})

watch(() => authUser.value?.id, (id) => {
  if (authReady.value) setPlanningAccount(id)
}, { flush: 'sync' })

const selectedQaSession = computed(() => {
  return qaSessions.value.find((session) => session.id === selectedQaSessionId.value) || null
})

const qaTotal = computed(() => {
  return qaSessions.value.reduce((total, session) => total + countQaSessionTurns(session), 0)
})

const archivePageNumbers = computed(() => {
  const total = Math.max(1, Number(listTotalPages.value) || 1)
  const current = Math.min(total, Math.max(1, Number(listPage.value) || 1))
  const visibleCount = Math.min(5, total)
  const start = Math.min(Math.max(1, current - 2), total - visibleCount + 1)
  return Array.from({ length: visibleCount }, (_, index) => start + index)
})

const hasGeneratingWorkspace = computed(() => {
  return Boolean(activeWorkspaceJobId.value) && (
    phase.value === 'loading' ||
    isGenerating.value ||
    activeWorkspaceStatus.value === 'running' ||
    activeWorkspaceStatus.value === 'queued'
  )
})

const hasReturnableWorkspace = computed(() => {
  return Boolean(returnableWorkspaceJobId.value)
})

const userModules = computed(() => deriveUserModules(authUser.value))
const userPermissions = computed(() => Array.isArray(authUser.value?.permissions) ? authUser.value.permissions : [])
const canAccessSystemManagement = computed(() => hasPermission('user:manage') || hasPermission('role:manage') || hasPermission('system:daily-awareness:manage'))
const canDeleteReports = computed(() => userPermissions.value.includes('report:delete'))
const canViewDailyAwareness = computed(() => hasPermission('daily-awareness:view'))
const hasAnyBusinessModule = computed(() => userModules.value.some((module) => ['report', 'qa', 'draft', 'daily'].includes(module)))

const sidebarCurrentJobId = computed(() => {
  return openedHistoryJobId.value || job.value?.jobId || activeWorkspaceJobId.value
})

const currentWorkspace = computed(() => {
  if (showDraftAssistant.value) return 'draft'
  if (showDailyAwareness.value) return 'daily'
  if (!showUserManagement.value && !showDraftAssistant.value && homeMode.value === 'qa') return 'qa'
  return 'report'
})
watch(currentWorkspace, workspace => draftAnalysis.setWorkspace(workspace))
watch(() => authUser.value?.id, id => {
  if (!id || !hasModule('draft')) draftAnalysis.logout()
  else {
    draftAnalysis.setAccount(id)
    if (draftAnalysis.state.workspace === 'draft' && hasModule('draft')) openDraftAssistant()
  }
}, { immediate: true })

watch([currentWorkspace, currentView, showUserManagement], () => {
  if (currentWorkspace.value !== 'report' || currentView.value !== 'generator' || showUserManagement.value) {
    suspendPlanning()
  }
}, { flush: 'sync' })

function continueReportPlanning() {
  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  homeMode.value = 'report'
  resumePlanning()
}

function choosePlanningConflict(choice) {
  if (choice === 'continue') {
    showUserManagement.value = false
    showDraftAssistant.value = false
    showDailyAwareness.value = false
    homeMode.value = 'report'
  }
  resolvePlanningConflict(choice)
}

function importReportContext(input) {
  const preserveInput = input.append && !planningDraft.value && !isHistoryMode.value
  const importedTitle = preserveInput ? (title.value.trim() || input.title) : input.title
  const importedContext = preserveInput
    ? [contextText.value, input.contextText].filter(Boolean).join('\n\n')
    : input.contextText
  requestNewPlanning(() => {
    returnHome()
    title.value = importedTitle || ''
    contextText.value = importedContext || ''
  })
}

function hasModule(module) {
  return userModules.value.includes(module)
}

function hasPermission(permission) {
  return userPermissions.value.includes(permission)
}

function firstAvailableBusinessModule() {
  return ['report', 'qa', 'daily', 'draft'].find((module) => hasModule(module)) || ''
}

function alignWorkspaceWithModules() {
  if (!authUser.value || !hasAnyBusinessModule.value) return
  if (hasModule(currentWorkspace.value)) return
  const fallback = firstAvailableBusinessModule()
  if (fallback) switchWorkspace(fallback)
}

async function handleLogin(credentials) {
  return loginUser(credentials?.username || '', credentials?.password || '')
}

function handleLogout() {
  draftAnalysis.logout()
  setPlanningAccount('')
  logoutUser()
  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  showPersonalSettings.value = false
  draftInitialEventId.value = ''
  returnHome()
}

function openSidebarSettings(event) {
  nexusHeaderRef.value?.toggleSettingsMenu(event)
}

function openUserManual(section) {
  manualInitialSection.value = normalizeManualSection(section)
  showUserManual.value = true
}

function openUserManagement() {
  if (!authUser.value) {
    setAuthNotice('\u8bf7\u5148\u767b\u5f55')
    return
  }
  if (!canAccessSystemManagement.value) {
    setAuthNotice('无权限访问系统管理')
    return
  }
  backgroundActiveWorkspace()
  showPersonalSettings.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  showUserManagement.value = true
}

function openPersonalSettings() {
  if (!authUser.value) {
    setAuthNotice('请先登录')
    return
  }
  showPersonalSettings.value = true
}

function openDraftAssistant() {
  if (!authUser.value) {
    setAuthNotice('请先登录')
    return
  }
  if (!hasModule('draft')) {
    setAuthNotice('当前账号暂无拟稿助手权限，请联系管理员分配权限。')
    return
  }
  backgroundActiveWorkspace()
  draftOpenRequest.value = null
  showPersonalSettings.value = false
  showUserManagement.value = false
  showDailyAwareness.value = false
  showDraftAssistant.value = true
}

function openBackgroundDraft(eventId) {
  openDraftAssistant()
  draftOpenRequest.value = { eventId }
  draftAnalysis.selectEvent(eventId)
}

function openDailyAwareness() {
  if (!authUser.value) {
    setAuthNotice('请先登录')
    return
  }
  if (!canViewDailyAwareness.value) {
    setAuthNotice('当前账号暂无每日动态感知权限，请联系管理员分配权限。')
    return
  }
  exitReportDetailForWorkspace()
  showPersonalSettings.value = false
  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = true
}

function openDraftFromDaily(payload) {
  draftInitialEventId.value = payload?.eventId || ''
  showDailyAwareness.value = false
  showUserManagement.value = false
  showPersonalSettings.value = false
  showDraftAssistant.value = true
}

function requestDraftLogin() {
  setAuthNotice('请先登录')
}

function openDraftReportJob(item) {
  if (!item?.jobId) return
  openReportJob(item)
}

function qaHistoryStorageKey(userId = '') {
  return `${QA_HISTORY_KEY}:${userId || 'guest'}`
}

function loadStoredQaSessions() {
  try {
    const raw = localStorage.getItem(qaHistoryStorageKey(authUser.value?.id))
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, 30) : []
  } catch {
    return []
  }
}

function persistQaSessions() {
  try {
    localStorage.setItem(qaHistoryStorageKey(authUser.value?.id), JSON.stringify(qaSessions.value.slice(0, 30)))
  } catch {
    // Local storage is best-effort; the current in-memory session still works.
  }
}

function countQaSessionTurns(session) {
  if (Array.isArray(session?.turns) && session.turns.length) {
    return session.turns.filter((turn) => {
      return String(turn?.question || turn?.answer || '').trim()
    }).length
  }
  return String(session?.question || session?.answer || '').trim() ? 1 : 0
}

function setHomeMode(mode) {
  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  showPersonalSettings.value = false
  if (mode === 'qa') exitReportDetailForWorkspace()
  homeMode.value = mode === 'qa' ? 'qa' : 'report'
  if (homeMode.value === 'report') selectedQaSessionId.value = ''
}

function exitReportDetailForWorkspace() {
  const backgrounded = backgroundActiveWorkspace()
  if (!backgrounded && (currentView.value !== 'generator' || phase.value !== 'idle')) {
    resetForNewReport()
  }
}

function switchWorkspace(mode) {
  if (mode === 'daily') {
    openDailyAwareness()
    return
  }
  if (authUser.value && !hasModule(mode)) {
    setAuthNotice('当前账号暂无该功能权限，请联系管理员分配权限。')
    return
  }
  if (mode === 'draft') {
    draftInitialEventId.value = ''
    openDraftAssistant()
    return
  }

  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  showPersonalSettings.value = false
  draftInitialEventId.value = ''

  if (mode === 'qa') {
    exitReportDetailForWorkspace()
    homeMode.value = 'qa'
    selectedQaSessionId.value = ''
    return
  }

  homeMode.value = 'report'
  selectedQaSessionId.value = ''
  resetForNewReport()
}

function upsertQaSession(session) {
  if (!session?.id) return
  const { select, ...sessionData } = session
  const current = qaSessions.value.find((item) => item.id === session.id)
  const next = {
    ...current,
    ...sessionData,
    updatedAt: sessionData.updatedAt || new Date().toISOString(),
  }
  qaSessions.value = [
    next,
    ...qaSessions.value.filter((item) => item.id !== session.id),
  ].slice(0, 30)
  if (select !== false) selectedQaSessionId.value = session.id
}

function openQaSession(session) {
  if (authUser.value && !hasModule('qa')) {
    setAuthNotice('当前账号暂无 QA 问答权限，请联系管理员分配权限。')
    return
  }
  if (!session?.id) return
  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  showPersonalSettings.value = false
  backgroundActiveWorkspace()
  homeMode.value = 'qa'
  selectedQaSessionId.value = session.id
}

function openReportJob(item) {
  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  showPersonalSettings.value = false
  homeMode.value = 'report'
  selectedQaSessionId.value = ''
  monitorJobFromList(item)
}

function startQaFromSidebar() {
  if (authUser.value && !hasModule('qa')) {
    setAuthNotice('当前账号暂无 QA 问答权限，请联系管理员分配权限。')
    return
  }
  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  showPersonalSettings.value = false
  backgroundActiveWorkspace()
  homeMode.value = 'qa'
  selectedQaSessionId.value = ''
}

function clearSelectedQaSession() {
  selectedQaSessionId.value = ''
}

function startReportFromSidebar() {
  if (authUser.value && !hasModule('report')) {
    setAuthNotice('当前账号暂无编报权限，请联系管理员分配权限。')
    return
  }
  requestNewPlanning(() => {
    showUserManagement.value = false
    showDraftAssistant.value = false
    showDailyAwareness.value = false
    showPersonalSettings.value = false
    homeMode.value = 'report'
    selectedQaSessionId.value = ''
    resetForNewReport()
  })
}

function openReportHistoryList() {
  if (authUser.value && !hasModule('report')) {
    setAuthNotice('当前账号暂无编报权限，请联系管理员分配权限。')
    return
  }
  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  showPersonalSettings.value = false
  homeMode.value = 'report'
  selectedQaSessionId.value = ''
  loadJobList(true)
}

function showReportWorkspace() {
  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  showPersonalSettings.value = false
  draftInitialEventId.value = ''
  homeMode.value = 'report'
  selectedQaSessionId.value = ''
  showGenerator()
}

function resetForNewReportFromCanvas() {
  if (authUser.value && !hasModule('report')) {
    setAuthNotice('当前账号暂无编报权限，请联系管理员分配权限。')
    return
  }
  requestNewPlanning(() => {
    showUserManagement.value = false
    showDraftAssistant.value = false
    showDailyAwareness.value = false
    showPersonalSettings.value = false
    homeMode.value = 'report'
    selectedQaSessionId.value = ''
    resetForNewReport()
  })
}

function returnHome() {
  showUserManagement.value = false
  showDraftAssistant.value = false
  showDailyAwareness.value = false
  showPersonalSettings.value = false
  draftInitialEventId.value = ''
  homeMode.value = 'report'
  selectedQaSessionId.value = ''
  resetForNewReport()
}

watch(qaSessions, persistQaSessions, { deep: true })

watch(authUser, (user) => {
  if (showUserManagement.value && !canAccessSystemManagement.value) {
    showUserManagement.value = false
  }
  if (user) {
    void Promise.allSettled([
      loadJobList(false),
      refreshRecentReports(),
    ])
    alignWorkspaceWithModules()
  } else {
    showDraftAssistant.value = false
    showDailyAwareness.value = false
    showPersonalSettings.value = false
    draftInitialEventId.value = ''
    clearReportHistoryState()
  }
  selectedQaSessionId.value = ''
  qaSessions.value = loadStoredQaSessions()
})

onMounted(async () => {
  await initializeAuth()
  authReady.value = true
  setPlanningAccount(authUser.value?.id)
})

function jobStatusType(status) {
  if (status === 'succeeded') return 'success'
  if (status === 'failed' || status === 'cancelled' || status === 'waiting_approval') return 'failed'
  return 'running'
}

function jobStatusLabel(status) {
  const type = jobStatusType(status)
  if (type === 'success') return '成功'
  if (type === 'failed') return '失败'
  return '生成中'
}

function jobStatusClass(status) {
  const type = jobStatusType(status)
  if (type === 'success') return 'archive-status-success'
  if (type === 'failed') return 'archive-status-failed'
  return 'archive-status-running'
}

function jobActionLabel(status) {
  const type = jobStatusType(status)
  if (type === 'success') return '查看报告'
  if (type === 'failed') return '查看错误'
  return '查看状态'
}

function formatArchiveTime(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
</script>

<template>
  <div class="app-shell min-h-screen grid-bg relative">
    <div class="crt-overlay"></div>
    <div class="crt-scanline"></div>

    <NexusHeader
      ref="nexusHeaderRef"
      :user="authUser"
      :auth-loading="authLoading"
      :auth-error="authError"
      :auth-notice="authNotice"
      :current-workspace="currentWorkspace"
      :user-management-open="showUserManagement"
      :account-in-sidebar="accountInSidebar"
      @return-home="returnHome"
      @login="handleLogin"
      @logout="handleLogout"
      @open-user-management="openUserManagement"
      @open-personal-settings="openPersonalSettings"
      @switch-workspace="switchWorkspace"
      @open-manual="openUserManual"
    />

    <UserManual
      :open="showUserManual"
      :initial-section="manualInitialSection"
      @close="showUserManual = false"
    />

    <PersonalSettings
      v-if="showPersonalSettings"
      @close="showPersonalSettings = false"
    />

    <DraftAnalysisNotice
      v-if="authUser && hasModule('draft')"
      :store="draftAnalysis"
      @open="openBackgroundDraft"
    />

    <DraftAssistant
      v-if="showDraftAssistant"
      :key="authUser?.id || 'guest'"
      :current-user="authUser"
      :initial-event-id="draftInitialEventId"
      :analysis-store="draftAnalysis"
      :open-request="draftOpenRequest"
      @initial-event-consumed="draftInitialEventId = ''"
      @back="returnHome"
      @request-login="requestDraftLogin"
      @report-job-created="openDraftReportJob"
      @open-settings="openSidebarSettings"
    />

    <DailyAwareness
      v-else-if="showDailyAwareness"
      :current-user="authUser"
      @back="returnHome"
      @open-draft-event="openDraftFromDaily"
      @open-settings="openSidebarSettings"
    />

    <main v-else-if="showUserManagement" class="user-management-main">
      <UserManagement
        :current-user="authUser"
        @back="returnHome"
        @open-daily-awareness="openDailyAwareness"
      />
    </main>

    <main v-else-if="authUser && !hasAnyBusinessModule" class="module-empty-main">
      <section class="module-empty-card">
        <div class="module-empty-eyebrow">ACCESS REQUIRED</div>
        <h1>当前账号暂无可用功能</h1>
        <p>请联系管理员分配编报、问答、拟稿或每日动态感知模块权限。</p>
      </section>
    </main>

    <div v-else-if="currentView === 'generator'" class="app-body">
      <ControlPanel
        :user="authUser"
        :health="health"
        :mode="homeMode"
        :jobs="filteredJobs"
        :recentJobs="recentJobs"
        :qaSessions="qaSessions"
        :reportTotal="listTotal"
        :qaTotal="qaTotal"
        :recentLoadingMore="recentLoadingMore"
        :recentHasMore="recentHasMore"
        :recentLoadError="recentLoadError"
        :currentJobId="sidebarCurrentJobId"
        :currentQaSessionId="selectedQaSessionId"
        :showSettings="Boolean(authUser)"
        @open-job="openReportJob"
        @open-qa-session="openQaSession"
        @start-qa="startQaFromSidebar"
        @start-report="startReportFromSidebar"
        @refresh-health="refreshHealth"
        @open-history-list="openReportHistoryList"
        @load-more-recent="loadMoreRecentReports"
        @open-settings="openSidebarSettings"
      />

      <DataCanvas
        :planning-draft="planningDraft"
        :planning-visible="planningVisible"
        :planning-storage-warning="planningStorageWarning"
        @resume-plan="continueReportPlanning"
        @discard-plan="discardPlanning"
        @retry-plan="retryPlanning"
        @retry-plan-submission="retryPlanningSubmission"
        @update-planning-buffer="updatePlanningBuffer"
        @import-report="importReportContext"
        v-model:title="title"
        v-model:reportType="reportType"
        v-model:contextText="contextText"
        v-model:parameterValues="parameterValues"
        v-model:activeParameters="activeParameters"
        :homeMode="homeMode"
        :selectedQaSession="selectedQaSession"
        :qaSessions="qaSessions"
        :phase="phase"
        :loadingStep="loadingStep"
        :processLogs="processLogs"
        :generatedHtml="generatedHtml"
        :reportType="reportType"
        :job="job"
        :jobList="filteredJobs"
        :health="health"
        :errorMessage="errorMessage"
        :detailLoading="detailLoading"
        :detailLoadError="detailLoadError"
        :isHistoryMode="isHistoryMode"
        :isGenerating="isGenerating"
        :isPlanning="isPlanning && planningVisible"
        :reportPlan="reportPlan"
        :planStepIndex="planStepIndex"
        :planSelections="planSelections"
        :planSearchSelections="planSearchSelections"
        v-model:planSourceInput="planSourceInput"
        v-model:planSupplement="planSupplement"
        v-model:databaseSourceEnabled="databaseSourceEnabled"
        v-model:useMyPreferences="useMyPreferences"
        v-model:deepReportEnabled="deepReportEnabled"
        :planError="planError"
        :executionLogs="executionLogs"
        :progress-state="progressState"
        :databaseSources="databaseSources"
        :databaseSourcesLoading="databaseSourcesLoading"
        :vectorSourceStatus="vectorSourceStatus"
        :vectorSourceStatusLoading="vectorSourceStatusLoading"
        :unreadLogCount="unreadLogCount"
        :isLogDrawerOpen="isLogDrawerOpen"
        :hasReturnableWorkspace="hasReturnableWorkspace"
        :canDeleteReport="canDeleteReports"
        @generate="handleGenerate"
        @confirm-plan="confirmReportPlan"
        @cancel-plan="cancelReportPlan"
        @toggle-plan-option="togglePlanOption"
        @add-plan-option="addPlanOption"
        @toggle-plan-search-query="togglePlanSearchQuery"
        @resolve-plan-intent="resolvePlanIntent"
        @update-plan-event-task="updatePlanEventTask"
        @next-plan-step="nextPlanStep"
        @prev-plan-step="prevPlanStep"
        @update:homeMode="setHomeMode"
        @qa-session-upsert="upsertQaSession"
        @qa-session-clear-selection="clearSelectedQaSession"
        @list="loadJobList"
        @delete-report="deleteReportFromList"
        @new-report="resetForNewReportFromCanvas"
        @retry-history-report="retryOpenCurrentHistoryReport"
        @show-active-workspace="showReportWorkspace"
        @toggle-log-drawer="toggleLogDrawer"
        @open-daily-awareness="openDailyAwareness"
      />
    </div>

    <main v-else class="archive-main">
      <div class="archive-content">
        <div class="archive-header">
          <div>
            <h1 class="archive-title">报告档案库</h1>
            <p class="archive-subtitle">真实后端任务列表 / 点击查看已生成报告</p>
          </div>
          <div class="archive-actions">
            <button
              v-if="hasActiveWorkspace"
              class="sci-btn archive-action-btn"
              :class="hasGeneratingWorkspace ? 'archive-action-active' : ''"
              type="button"
              @click="showReportWorkspace"
            >
              {{ hasGeneratingWorkspace ? '返回生成编报' : '返回当前编报' }}
            </button>
            <button class="sci-btn archive-action-btn archive-action-primary" type="button" @click="resetForNewReportFromCanvas">
              <Plus :size="16" aria-hidden="true" /> 新建编报
            </button>
            <button
              v-if="canDeleteReports"
              class="sci-btn archive-action-btn"
              :class="listTrashMode ? 'archive-action-danger' : ''"
              type="button"
              @click="loadJobList(false, { trash: !listTrashMode })"
            >
              <Trash2 :size="15" aria-hidden="true" />
              {{ listTrashMode ? '返回报告列表' : '垃圾箱' }}
            </button>
            <button class="sci-btn archive-action-btn" type="button" @click="loadJobList(false, { trash: listTrashMode })">
              <RefreshCw :size="15" aria-hidden="true" /> 刷新列表
            </button>
          </div>
        </div>

        <div class="archive-filter-panel">
          <div class="archive-search-only">
            <div v-if="listTrashMode" class="trash-mode-banner">
              当前为垃圾箱视图。恢复会回到报告列表，永久删除会清理服务器上的任务状态和报告文件。
            </div>
            <div class="archive-search-field">
              <input
                :value="listSearch"
                class="sci-input archive-search-input"
                aria-label="搜索报告"
                placeholder="搜索标题 / 任务编号 / 上下文关键词"
                @input="updateListSearch($event.target.value)"
              />
              <Search :size="18" aria-hidden="true" />
            </div>
          </div>
        </div>

        <section class="panel archive-table-panel" aria-label="报告任务列表">
          <div class="archive-table-grid archive-table-head" role="row">
            <div role="columnheader">任务编号</div>
            <div role="columnheader">主题</div>
            <div role="columnheader">状态</div>
            <div role="columnheader">更新时间</div>
            <div role="columnheader">文件</div>
            <div role="columnheader">操作</div>
          </div>

          <div v-if="filteredJobs.length" class="archive-table-body">
            <div
              v-for="item in filteredJobs"
              :key="item.jobId"
              class="archive-table-grid archive-row"
              role="row"
            >
              <div class="archive-job-id" role="cell">{{ item.jobId.slice(0, 8) }}</div>
              <div class="archive-job-title" role="cell" :title="getJobTitle(item)">{{ getJobTitle(item) }}</div>
              <div role="cell">
                <span class="archive-status-badge" :class="jobStatusClass(item.status)">
                  {{ jobStatusLabel(item.status) }}
                </span>
              </div>
              <div role="cell">
                <time class="archive-time" :datetime="item.updatedAt || item.createdAt" :title="item.updatedAt || item.createdAt">
                  {{ formatArchiveTime(item.updatedAt || item.createdAt) }}
                </time>
              </div>
              <div class="archive-file-status" role="cell">{{ item.resultPath ? '已生成' : '未生成' }}</div>
              <div class="archive-row-actions" role="cell">
                <button class="archive-view-btn" type="button" @click="monitorJobFromList(item)">
                  {{ jobActionLabel(item.status) }}
                </button>
                <button
                  v-if="canDeleteReports && !listTrashMode"
                  class="archive-delete-btn"
                  type="button"
                  title="移入垃圾箱"
                  @click.stop="deleteReportFromList(item)"
                >
                  删除
                </button>
                <button
                  v-if="canDeleteReports && listTrashMode"
                  class="archive-restore-btn"
                  type="button"
                  @click.stop="restoreReportFromTrash(item)"
                >
                  恢复
                </button>
                <button
                  v-if="canDeleteReports && listTrashMode"
                  class="archive-delete-btn"
                  type="button"
                  @click.stop="permanentlyDeleteReportFromTrash(item)"
                >
                  永久删除
                </button>
              </div>
            </div>
          </div>

          <div v-else class="archive-empty-state">
            <strong>{{ listSearch ? '未找到匹配编报' : (listTrashMode ? '垃圾箱为空' : '暂无报告任务') }}</strong>
            <span>{{ listSearch ? '请尝试其他标题、任务编号或关键词' : '新建编报后，任务会显示在这里' }}</span>
          </div>

          <footer class="archive-pagination">
            <div class="archive-pagination-summary">
              <span>共 {{ listTotal }} 条</span>
              <select
                class="archive-page-size"
                aria-label="每页显示数量"
                :value="listPageSize"
                @change="updateListPageSize($event.target.value)"
              >
                <option value="10">10 条/页</option>
                <option value="20">20 条/页</option>
                <option value="50">50 条/页</option>
                <option value="100">100 条/页</option>
              </select>
            </div>
            <nav class="archive-page-nav" aria-label="报告列表分页">
              <button type="button" aria-label="上一页" :disabled="listPage <= 1" @click="updateListPage(listPage - 1)">
                <ChevronLeft :size="16" aria-hidden="true" />
              </button>
              <button
                v-for="pageNumber in archivePageNumbers"
                :key="pageNumber"
                type="button"
                :class="{ active: pageNumber === listPage }"
                :aria-current="pageNumber === listPage ? 'page' : undefined"
                @click="updateListPage(pageNumber)"
              >
                {{ pageNumber }}
              </button>
              <button type="button" aria-label="下一页" :disabled="listPage >= listTotalPages" @click="updateListPage(listPage + 1)">
                <ChevronRight :size="16" aria-hidden="true" />
              </button>
            </nav>
          </footer>
        </section>
      </div>
    </main>
    <div v-if="planningConflict" class="planning-conflict-backdrop" @click.self="choosePlanningConflict('cancel')" @keydown.esc="choosePlanningConflict('cancel')">
      <section ref="planningConflictPanel" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="planning-conflict-title" class="planning-conflict-panel">
        <h2 id="planning-conflict-title">已有未完成规划</h2>
        <p>{{ planningDraft?.form.title }}</p>
        <p v-if="planningDraft?.status === 'submitting'">任务正在提交，请稍候。暂不能放弃并新建。</p>
        <p v-else-if="planningDraft?.status === 'uncertain'">提交结果待核实，放弃前请先查看历史记录，避免重复编报。</p>
        <div class="planning-conflict-actions">
          <button type="button" class="sci-btn" @click="choosePlanningConflict('cancel')">返回</button>
          <button type="button" class="sci-btn" :disabled="planningDraft?.status === 'submitting'" @click="choosePlanningConflict('replace')">放弃并新建</button>
          <button type="button" class="sci-btn" autofocus @click="choosePlanningConflict('continue')">继续原规划</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.planning-conflict-backdrop { position: fixed; inset: 0; z-index: 100; background: #0f172a55; display: grid; place-items: center; padding: 20px; }
.planning-conflict-panel { width: min(100%, 480px); background: white; border: 1px solid #dce3ed; border-radius: 8px; padding: 24px; color: #182235; }
.planning-conflict-panel h2 { font-size: 18px; font-weight: 700; margin-bottom: 12px; }
.planning-conflict-panel p { overflow-wrap: anywhere; margin-bottom: 16px; }
.planning-conflict-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.planning-conflict-actions button { padding: 8px 12px; }
</style>
