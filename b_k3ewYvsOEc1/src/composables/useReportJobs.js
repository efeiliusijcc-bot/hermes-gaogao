import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  createReportPlan,
  createReportJob,
  deleteReportJob,
  fetchHermesHealth,
  fetchReportDatabaseSources,
  fetchReportJob,
  fetchReportJobEventLog,
  fetchReportJobs,
  fetchReportProgress,
  fetchReportResult,
  fetchVectorSourceStatus,
  getAuthToken,
  getJobEventsUrl,
  permanentlyDeleteReportJob,
  restoreReportJob,
} from '../lib/api.js'
import {
  includeOpenedHistoryJob,
  isUnfinishedReportJob,
  resolveActiveWorkspaceJob,
  upsertReportJob,
} from '../lib/reportWorkspaceState.js'
import { buildPlanningContextPayload } from '../lib/reportPlanningContext.js'
import { REPORT_HISTORY_CREATED_AFTER } from '../lib/reportHistoryCutoff.js'
import { executionLogIdentity, mergeExecutionLogEntries } from '../lib/reportExecutionLogs.js'
import { attachEventPlanningSteps, eventPlanningError } from '../lib/eventTaskPlan.js'
import { awaitPlanningSubmission, clonePlanningValue, createReportPlanningDraft } from '../lib/reportPlanningDraft.js'

const DRAFT_KEY = 'nexus-report-history-overrides'

function readDrafts() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeDrafts(value) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(value))
}

const REPORT_PARAMETERS = {
  'write-hb-k': ['关注方向', '时间范围', '地区 / 对象', '标签'],
  'write-hb-hb': ['背景信息', '关注方向', '材料范围', '地区 / 对象', '已知上下文'],
  'risk-assessment-reports': ['风险场景', '研判方向', '时间范围', '地区 / 对象', '已知上下文'],
  'person-intelligence-report': ['人物背景', '国家 / 地区', '当前职务', '来访场景', '已知上下文'],
}

const K_SOURCE_SCOPE_STEP = {
  id: 'k_source_scope',
  type: 'source_scope',
  title: '信源范围',
  sectionTitle: '信源范围',
  description: '确认本次 K 报优先采集和使用的信源类型。',
  allowMultiple: true,
  options: [
    { id: 'public_news', label: '公开新闻报道', detail: '覆盖主流媒体、区域媒体和专题报道。', selected: true },
    { id: 'government_notice', label: '政府与机构公告', detail: '覆盖政府部门、监管机构、国际组织和官方公告。', selected: true },
    { id: 'think_tank_report', label: '行业报告与智库分析', detail: '覆盖行业研究、智库研判和专业机构分析。', selected: true },
    { id: 'enterprise_activity', label: '企业与主体动态', detail: '覆盖重点企业、产业主体和相关组织动态。', selected: true },
    { id: 'public_opinion', label: '舆情与公众反应', detail: '覆盖公开舆论、社交传播和公众反馈。', selected: true },
    { id: 'trade_supply_data', label: '供应链与贸易数据', detail: '覆盖贸易、供应链、产业链和关键数据线索。', selected: true },
  ],
}

const SUPPLEMENT_PLAN_STEP = {
  id: 'supplement-directions',
  type: 'supplement',
  title: '补充方向',
  sectionTitle: '补充方向',
  description: '补充需要纳入编报的特殊关注点、限制条件或额外说明。',
  allowMultiple: false,
  options: [],
}

const K_SECTION_DEFS = [
  {
    id: 'k_basic_situation',
    sectionKeys: ['basic_info', 'k_basic_situation'],
    sectionTitles: ['基本情况', '一、基本情况'],
    sectionTitle: '基本情况',
    description: '梳理事件背景、关键主体、时间线和主要事实。',
    match: /(基本|背景|事实|情况|态势|概况)/,
    fallback: [
      { id: 'basic_context', label: '事件背景与演变', detail: '说明主题背景、近期变化和关键时间节点。' },
      { id: 'basic_actors', label: '关键主体与关系', detail: '梳理相关国家、机构、企业或组织的角色关系。' },
      { id: 'basic_current', label: '当前态势与主要事实', detail: '归纳当前状态、公开事实和核心信息。' },
    ],
  },
  {
    id: 'k_china_risks',
    sectionKeys: ['risk_to_china', 'k_china_risks'],
    sectionTitles: ['涉我风险', '二、涉我风险'],
    sectionTitle: '涉我风险',
    description: '研判对我国利益、产业链、贸易、安全和舆论环境的影响。',
    match: /(涉我|风险|影响|挑战|安全|产业链|供应链|贸易)/,
    fallback: [
      { id: 'risk_interest', label: '涉我利益影响', detail: '分析对我国相关利益、政策空间和外部环境的影响。' },
      { id: 'risk_industry', label: '产业链与供应链风险', detail: '研判关键产业、贸易链路和供应链环节的风险。' },
      { id: 'risk_public', label: '舆情与外溢风险', detail: '评估舆论传播、国际叙事和潜在外溢影响。' },
    ],
  },
  {
    id: 'k_countermeasures',
    sectionKeys: ['countermeasures', 'k_countermeasures'],
    sectionTitles: ['对策建议', '三、对策建议'],
    sectionTitle: '对策建议',
    description: '提出应对思路、工作建议和后续跟踪重点。',
    match: /(建议|对策|应对|处置|措施|跟踪)/,
    fallback: [
      { id: 'counter_policy', label: '政策与工作建议', detail: '提出政策沟通、风险防控和工作推进建议。' },
      { id: 'counter_industry', label: '产业与主体应对', detail: '提出产业链、企业和重点主体的应对方向。' },
      { id: 'counter_monitor', label: '后续跟踪重点', detail: '明确后续需要持续监测的信源、指标和事件。' },
    ],
  },
]

const SOURCE_SCOPE_OPTION_IDS = new Set(K_SOURCE_SCOPE_STEP.options.map((option) => option.id))
const SOURCE_SCOPE_OPTION_LABELS = new Set(K_SOURCE_SCOPE_STEP.options.map((option) => option.label))
const NETWORK_SOURCE_RULES = [
  { ids: ['government_notice'], pattern: /政策|政府|监管|公告|法案|法规|制裁|关税|USTR|法院|议会|部门|机构/i },
  { ids: ['think_tank_report'], pattern: /报告|研究|智库|分析|研判|趋势|评估|行业|产业/i },
  { ids: ['enterprise_activity'], pattern: /企业|公司|集团|主体|厂商|航运|造船|能源|银行|供应商/i },
  { ids: ['public_opinion'], pattern: /舆情|公众|社交|传播|反应|抗议|评论|争议|民意/i },
  { ids: ['trade_supply_data'], pattern: /供应链|产业链|贸易|出口|进口|物流|港口|数据|市场|价格|能源/i },
  { ids: ['public_news'], pattern: /新闻|报道|事件|危机|冲突|动态|最新|袭|下调|上调/i },
]

export function useReportJobs() {
  const currentView = ref('generator')

  const title = ref('')
  const reportType = ref('write-hb-k')
  const countryOrRegion = ref('')
  const currentPosition = ref('')
  const scenario = ref('foreign_leader_visit')
  const targetCity = ref('')
  const visitTime = ref('')
  const contextText = ref('')
  const parameterValues = ref({})
  const activeParameters = ref(['关注方向', '时间范围', '地区 / 对象', '标签'])
  const outputDepth = ref('detailed')

  const isGenerating = ref(false)
  const planning = createReportPlanningDraft()
  const planningDraft = planning.draft
  const planningVisible = planning.visible
  const planningStorageWarning = planning.storageWarning
  const isPlanning = computed(() => planningDraft.value?.status === 'generating')
  const reportPlan = planning.editorField('reportPlan')
  const planStepIndex = planning.editorField('planStepIndex')
  const planSelections = planning.editorField('planSelections')
  const planSearchSelections = planning.editorField('planSearchSelections')
  const planSourceInput = planning.editorField('planSourceInput')
  const planSupplement = planning.editorField('planSupplement')
  const databaseSourceEnabled = planning.editorField('databaseSourceEnabled')
  const useMyPreferences = ref(false)
  const deepReportEnabled = ref(true)
  const planError = planning.editorField('planError')
  const planningConflict = ref(false)
  let pendingPlanningAction = null
  let planningAccount = null
  let planningAccountRevision = 0
  const formFields = { title, reportType, countryOrRegion, currentPosition, scenario,
    targetCity, visitTime, contextText, parameterValues, activeParameters, outputDepth,
    useMyPreferences, deepReportEnabled }
  function snapshotPlanningForm() {
    return clonePlanningValue(Object.fromEntries(Object.entries(formFields).map(([key, value]) => [key, value.value])))
  }
  function suspendPlanning() {
    if (planningVisible.value && planningDraft.value?.status === 'submitting') {
      generationRequestId += 1
      isGenerating.value = false
    }
    planning.suspend()
  }
  function setPlanningAccount(id) {
    const next = String(id || '')
    if (next === planningAccount) return
    planningAccount = next
    planningAccountRevision += 1
    generationRequestId += 1
    isGenerating.value = false
    planningConflict.value = false
    pendingPlanningAction = null
    planning.setAccount(next)
  }
  function resumePlanning() {
    if (!planningDraft.value) return
    clearScreenForNextReport()
    for (const [key, field] of Object.entries(formFields)) {
      if (key in planningDraft.value.form) field.value = clonePlanningValue(planningDraft.value.form[key])
    }
    vectorSourceStatus.value = planningDraft.value.vectorStatus
    planningVisible.value = true
  }
  function discardPlanning() {
    if (!planningDraft.value || planningDraft.value.status === 'submitting') return false
    if (!window.confirm('放弃当前未完成规划？已选内容和补充材料将被清除。')) return false
    planning.discard()
    return true
  }
  function updatePlanningBuffer({ field, value }) {
    if (planningDraft.value && ['manualSourceDraft', 'manualDirectionDraft'].includes(field)) {
      planningDraft.value.editor[field] = String(value)
    }
  }
  function requestNewPlanning(action) {
    if (!planningDraft.value) return action()
    pendingPlanningAction = action
    planningConflict.value = true
  }
  function resolvePlanningConflict(choice) {
    const action = pendingPlanningAction
    pendingPlanningAction = null
    planningConflict.value = false
    if (choice === 'continue') resumePlanning()
    if (choice === 'replace' && planningDraft.value?.status !== 'submitting') {
      planning.discard()
      action?.()
    }
  }
  const generatedHtml = ref('')
  const phase = ref('idle')
  const processLogs = ref([])
  const loadingStep = ref('等待输入任务')
  const job = ref(null)
  const jobList = ref([])
  const listSearch = ref('')
  const listPage = ref(1)
  const listPageSize = ref(20)
  const listTotal = ref(0)
  const listTotalPages = ref(1)
  const listStatusCounts = ref({ succeeded: 0, running: 0 })
  const listTrashMode = ref(false)
  const recentJobs = ref([])
  const recentPage = ref(0)
  const recentPageSize = 8
  const recentLoadingMore = ref(false)
  const recentHasMore = ref(true)
  const recentLoadError = ref('')
  const health = ref(null)
  const errorMessage = ref('')
  const selectedReport = ref(null)
  const openedHistoryJobId = ref(null)
  const detailLoading = ref(false)
  const detailLoadError = ref('')
  const savedNotice = ref('')
  const activePollJobId = ref(null)
  const executionLogs = ref([])
  const progressState = ref(null)
  const databaseSources = ref(null)
  const databaseSourcesLoading = ref(false)
  const vectorSourceStatus = ref(null)
  const vectorSourceStatusLoading = ref(false)
  const unreadLogCount = ref(0)
  const isLogDrawerOpen = ref(false)
  let listRefreshTimer = null
  let listSearchTimer = null
  let jobEventSource = null
  let subscribedJobId = null
  let progressPollTimer = null
  let progressPollJobId = null
  let activeExecutionLogJobId = null
  let historyOpenRequestId = 0
  let jobListRequestId = 0
  let recentJobsRequestId = 0
  let databaseSourcesRequestId = 0
  let generationRequestId = 0
  const activeWorkspaceSnapshot = ref(null)
  const executionLogsByJobId = new Map()
  const seenExecutionEventsByJobId = new Map()

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const isHistoryMode = computed(() => Boolean(openedHistoryJobId.value) && (
    phase.value === 'done' ||
    phase.value === 'loading' ||
    phase.value === 'history-loading' ||
    phase.value === 'history-error' ||
    phase.value === 'error'
  ))
  const isViewingHistoryJob = computed(() => Boolean(openedHistoryJobId.value))
  const activeWorkspaceJob = computed(() => resolveActiveWorkspaceJob(
    activeWorkspaceSnapshot.value,
    job.value,
    openedHistoryJobId.value,
  ))
  const hasActiveWorkspace = computed(() => {
    if (openedHistoryJobId.value) return Boolean(activeWorkspaceSnapshot.value)
    return Boolean(activeWorkspaceSnapshot.value) || phase.value !== 'idle' || Boolean(job.value) || Boolean(title.value.trim()) || Boolean(generatedHtml.value)
  })
  const activeWorkspaceJobId = computed(() => activeWorkspaceJob.value?.jobId || '')
  const activeWorkspaceStatus = computed(() => activeWorkspaceJob.value?.status || '')
  const returnableWorkspaceJobId = computed(() => {
    const snapshotJob = activeWorkspaceSnapshot.value?.job
    if (!snapshotJob?.jobId) return ''
    if (!job.value?.jobId) return snapshotJob.jobId
    return snapshotJob.jobId !== job.value.jobId ? snapshotJob.jobId : ''
  })
  const displayRecentJobs = computed(() => includeOpenedHistoryJob(
    recentJobs.value,
    openedHistoryJobId.value,
    job.value,
  ))

  const filteredJobs = computed(() => {
    return [...jobList.value].sort((a, b) => {
      const createdDiff = new Date(b.createdAt) - new Date(a.createdAt)
      if (createdDiff) return createdDiff
      return String(b.jobId || '').localeCompare(String(a.jobId || ''))
    })
  })

  const succeededCount = computed(() => listStatusCounts.value.succeeded)
  const runningCount = computed(() => listStatusCounts.value.running)

  function pushLog(message) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    processLogs.value.push(`[${time}] ${message}`)
    patchActiveWorkspaceSnapshot()
  }

  function pushWorkspaceSnapshotLog(message) {
    const snapshot = activeWorkspaceSnapshot.value
    if (!snapshot) return
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    activeWorkspaceSnapshot.value = {
      ...snapshot,
      processLogs: [...(snapshot.processLogs || []), `[${time}] ${message}`],
    }
  }

  const isUnfinishedJob = isUnfinishedReportJob

  function makeWorkspaceSnapshot(overrides = {}) {
    return {
      title: title.value,
      reportType: reportType.value,
      countryOrRegion: countryOrRegion.value,
      currentPosition: currentPosition.value,
      scenario: scenario.value,
      targetCity: targetCity.value,
      visitTime: visitTime.value,
      contextText: contextText.value,
      parameterValues: { ...parameterValues.value },
      activeParameters: [...activeParameters.value],
      outputDepth: outputDepth.value,
      databaseSourceEnabled: databaseSourceEnabled.value,
      deepReportEnabled: deepReportEnabled.value,
      isGenerating: isGenerating.value,
      generatedHtml: generatedHtml.value,
      phase: phase.value,
      processLogs: [...processLogs.value],
      loadingStep: loadingStep.value,
      job: job.value ? { ...job.value } : null,
      progressState: progressState.value ? { ...progressState.value } : null,
      databaseSources: databaseSources.value,
      errorMessage: errorMessage.value,
      selectedReport: selectedReport.value ? { ...selectedReport.value } : null,
      savedNotice: savedNotice.value,
      ...overrides,
    }
  }

  function patchActiveWorkspaceSnapshot(overrides = {}) {
    const { __force, ...nextOverrides } = overrides
    const current = activeWorkspaceSnapshot.value
    const currentJobId = current?.job?.jobId
    const visibleJobId = job.value?.jobId
    if (!currentJobId && !visibleJobId) return
    if (!__force) {
      if (currentJobId && currentJobId !== visibleJobId) return
      if (!currentJobId && openedHistoryJobId.value) return
    }
    const shouldRefreshFromVisibleState = Object.keys(nextOverrides).length === 0
    activeWorkspaceSnapshot.value = {
      ...(shouldRefreshFromVisibleState ? makeWorkspaceSnapshot() : current || makeWorkspaceSnapshot()),
      ...nextOverrides,
    }
  }

  function restoreWorkspaceSnapshot() {
    const snapshot = activeWorkspaceSnapshot.value
    if (!snapshot) {
      currentView.value = 'generator'
      return false
    }

    title.value = snapshot.title || ''
    reportType.value = snapshot.reportType || ''
    countryOrRegion.value = snapshot.countryOrRegion || ''
    currentPosition.value = snapshot.currentPosition || ''
    scenario.value = snapshot.scenario || 'foreign_leader_visit'
    targetCity.value = snapshot.targetCity || ''
    visitTime.value = snapshot.visitTime || ''
    contextText.value = snapshot.contextText || ''
    parameterValues.value = { ...(snapshot.parameterValues || {}) }
    activeParameters.value = [...(snapshot.activeParameters || [])]
    outputDepth.value = snapshot.outputDepth || 'detailed'
    databaseSourceEnabled.value = snapshot.databaseSourceEnabled !== false
    deepReportEnabled.value = snapshot.deepReportEnabled === true
    isGenerating.value = Boolean(snapshot.isGenerating)
    generatedHtml.value = snapshot.generatedHtml || ''
    phase.value = snapshot.phase || 'idle'
    processLogs.value = [...(snapshot.processLogs || [])]
    loadingStep.value = snapshot.loadingStep || ''
    job.value = snapshot.job ? { ...snapshot.job } : null
    progressState.value = snapshot.progressState || job.value?.progressState || null
    databaseSources.value = snapshot.databaseSources || null
    errorMessage.value = snapshot.errorMessage || ''
    selectedReport.value = snapshot.selectedReport ? { ...snapshot.selectedReport } : null
    savedNotice.value = snapshot.savedNotice || ''
    openedHistoryJobId.value = null
    detailLoading.value = false
    detailLoadError.value = ''
    currentView.value = 'generator'
    if (job.value?.jobId) {
      setActiveExecutionLogJob(job.value.jobId)
      fetchDatabaseSourcesData(job.value.jobId)
      if (isUnfinishedJob(job.value)) subscribeJobEvents(job.value.jobId)
    }
    return true
  }

  function backgroundActiveWorkspace() {
    suspendPlanning()
    const unfinishedWorkspace = getUnfinishedWorkspaceSnapshot()
    if (!unfinishedWorkspace?.job?.jobId) return false

    activeWorkspaceSnapshot.value = unfinishedWorkspace
    openedHistoryJobId.value = null
    detailLoading.value = false
    detailLoadError.value = ''
    selectedReport.value = null
    generatedHtml.value = ''
    errorMessage.value = ''
    processLogs.value = []
    job.value = null
    progressState.value = null
    databaseSources.value = null
    databaseSourcesLoading.value = false
    unreadLogCount.value = 0
    isLogDrawerOpen.value = false
    isGenerating.value = false
    phase.value = 'idle'
    loadingStep.value = '等待输入任务'
    currentView.value = 'generator'
    return true
  }

  function getUnfinishedWorkspaceSnapshot(exceptJobId = '') {
    if (
      activeWorkspaceSnapshot.value?.job?.jobId &&
      activeWorkspaceSnapshot.value.job.jobId !== exceptJobId &&
      isUnfinishedJob(activeWorkspaceSnapshot.value.job)
    ) {
      return activeWorkspaceSnapshot.value
    }

    if (!openedHistoryJobId.value && job.value?.jobId && job.value.jobId !== exceptJobId && isUnfinishedJob(job.value)) {
      return makeWorkspaceSnapshot()
    }

    return null
  }

  function upsertJobInList(item, options = {}) {
    if (!item?.jobId) return
    const drafts = readDrafts()
    const nextItem = {
      ...item,
      displayTitle: drafts[item.jobId]?.title || item.displayTitle,
    }
    const promote = options.promote ?? isUnfinishedJob(item)
    jobList.value = upsertReportJob(jobList.value, nextItem, { promote })
  }

  function upsertJobInRecent(item, options = {}) {
    if (!item?.jobId) return
    const drafts = readDrafts()
    const nextItem = {
      ...item,
      displayTitle: drafts[item.jobId]?.title || item.displayTitle,
    }
    const promote = options.promote ?? isUnfinishedJob(item)
    recentJobs.value = upsertReportJob(recentJobs.value, nextItem, { promote })
  }

  async function loadMoreRecentReports({ reset = false } = {}) {
    if (recentLoadingMore.value) return
    if (!reset && !recentHasMore.value) return

    const requestId = ++recentJobsRequestId
    recentLoadingMore.value = true
    recentLoadError.value = ''
    try {
      const nextPage = reset ? 1 : recentPage.value + 1
      const drafts = readDrafts()
      const response = await fetchReportJobs({
        page: nextPage,
        pageSize: recentPageSize,
        type: 'all',
        createdAfter: REPORT_HISTORY_CREATED_AFTER,
      })
      if (requestId !== recentJobsRequestId) return
      const items = (Array.isArray(response) ? response : response.items || []).map((item) => ({
        ...item,
        displayTitle: drafts[item.jobId]?.title || undefined,
      }))
      const merged = reset ? items : [...recentJobs.value, ...items]
      const seen = new Set()
      recentJobs.value = merged.filter((item) => {
        if (!item?.jobId || seen.has(item.jobId)) return false
        seen.add(item.jobId)
        return true
      })
      recentPage.value = Array.isArray(response) ? nextPage : response.page || nextPage
      if (Array.isArray(response)) {
        if (reset) listTotal.value = recentJobs.value.length
        recentHasMore.value = items.length >= recentPageSize
      } else {
        listTotal.value = response.total || recentJobs.value.length
        recentHasMore.value = recentPage.value < (response.totalPages || 1)
      }
    } catch (error) {
      if (requestId !== recentJobsRequestId) return
      recentLoadError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (requestId === recentJobsRequestId) recentLoadingMore.value = false
    }
  }

  function refreshRecentReports() {
    recentPage.value = 0
    recentHasMore.value = true
    recentLoadError.value = ''
    return loadMoreRecentReports({ reset: true })
  }

  function clearReportHistoryState() {
    jobListRequestId += 1
    recentJobsRequestId += 1
    jobList.value = []
    recentJobs.value = []
    listPage.value = 1
    listTotal.value = 0
    listTotalPages.value = 1
    listStatusCounts.value = { succeeded: 0, running: 0 }
    recentPage.value = 0
    recentHasMore.value = true
    recentLoadError.value = ''
    recentLoadingMore.value = false
  }

  function closeJobEvents() {
    if (jobEventSource) {
      jobEventSource.close()
      jobEventSource = null
    }
    subscribedJobId = null
  }

  function stopProgressPolling(jobId = null) {
    if (jobId && progressPollJobId && progressPollJobId !== jobId) return
    if (progressPollTimer) {
      window.clearInterval(progressPollTimer)
      progressPollTimer = null
    }
    progressPollJobId = null
  }

  function isVisibleJob(jobId) {
    return Boolean(jobId) && job.value?.jobId === jobId
  }

  function shouldApplyVisibleJobData(jobId) {
    return isVisibleJob(jobId)
  }

  function startProgressPolling(jobId) {
    if (!jobId) return
    if (progressPollJobId === jobId && progressPollTimer) return
    stopProgressPolling()
    progressPollJobId = jobId
    const refresh = () => {
      const shouldApply = () => {
        const visibleJob = isVisibleJob(jobId)
        const activeWorkspaceJob = activeWorkspaceSnapshot.value?.job?.jobId === jobId
        return progressPollJobId === jobId && (visibleJob || activeWorkspaceJob)
      }
      void loadProgressState(jobId, shouldApply)
      void loadExecutionLog(jobId, shouldApply, { force: true, merge: true })
    }
    refresh()
    progressPollTimer = window.setInterval(refresh, 2000)
  }

  function resetExecutionLogs() {
    closeJobEvents()
    stopProgressPolling()
    executionLogs.value = []
    progressState.value = null
    unreadLogCount.value = 0
    activeExecutionLogJobId = null
  }

  function setActiveExecutionLogJob(jobId, items = null, { merge = false } = {}) {
    activeExecutionLogJobId = jobId || null
    unreadLogCount.value = 0
    if (!jobId) {
      executionLogs.value = []
      progressState.value = null
      return
    }
    if (Array.isArray(items)) {
      const normalized = items.map((item, index) => ({
        id: item.id || `${jobId}-saved-${index}`,
        eventId: item.eventId || item.toolId || '',
        occurredAt: item.occurredAt || item.time || '',
        time: formatLogTime(item.time),
        type: item.type || 'stage',
        label: item.label || '执行日志',
        status: item.status || 'running',
        summary: item.summary || '',
        command: item.command || '',
        phase: item.phase || '',
        actor: item.actor || '',
        detail: item.detail || '',
        toolName: item.toolName || '',
        toolDisplayName: item.toolDisplayName || item.toolName || '',
        toolId: item.toolId || '',
        toolEngine: item.toolEngine || '',
        origin: item.origin || '',
        durationMs: item.durationMs,
        sequence: item.sequence,
        runEvent: item.runEvent || '',
        usage: item.usage || null,
      }))
      const next = merge
        ? mergeExecutionLogEntries(executionLogsByJobId.get(jobId) || [], normalized)
        : normalized
      executionLogsByJobId.set(jobId, next)
      seenExecutionEventsByJobId.set(jobId, new Set(next.map((item) => executionLogIdentity(item))))
    }
    executionLogs.value = executionLogsByJobId.get(jobId) || []
  }

  function formatLogTime(value) {
    if (!value) return ''
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return String(value)
    return parsed.toLocaleTimeString('zh-CN', { hour12: false })
  }

  function executionLogKey(entry) {
    return executionLogIdentity(entry)
  }

  function appendExecutionLog(entry, jobId = activeExecutionLogJobId) {
    if (!jobId) return
    if (!executionLogsByJobId.has(jobId)) executionLogsByJobId.set(jobId, [])
    if (!seenExecutionEventsByJobId.has(jobId)) seenExecutionEventsByJobId.set(jobId, new Set())
    const jobLogs = executionLogsByJobId.get(jobId)
    const seen = seenExecutionEventsByJobId.get(jobId)
    const key = executionLogKey(entry)
    if (seen.has(key)) return
    seen.add(key)
    const occurredAt = new Date().toISOString()
    jobLogs.push({
      id: `${Date.now()}-${executionLogs.value.length}`,
      occurredAt,
      time: formatLogTime(occurredAt),
      ...entry,
    })
    if (jobLogs.length > 500) jobLogs.splice(0, jobLogs.length - 500)
    if (activeExecutionLogJobId === jobId) {
      executionLogs.value = jobLogs
      if (!isLogDrawerOpen.value) unreadLogCount.value += 1
    }
  }

  async function fetchDatabaseSourcesData(jobId, shouldApply = () => shouldApplyVisibleJobData(jobId)) {
    if (!jobId) {
      databaseSources.value = null
      databaseSourcesLoading.value = false
      return
    }
    if (!shouldApply()) return
    const requestId = ++databaseSourcesRequestId
    databaseSourcesLoading.value = true
    try {
      const result = await fetchReportDatabaseSources(jobId)
      if (requestId !== databaseSourcesRequestId || !shouldApply()) return
      databaseSources.value = result
    } catch {
      if (requestId !== databaseSourcesRequestId || !shouldApply()) return
      databaseSources.value = null
    } finally {
      if (requestId === databaseSourcesRequestId) databaseSourcesLoading.value = false
    }
  }

  function applyLiveDatabaseSources(sources, jobId = activeExecutionLogJobId) {
    if (!Array.isArray(sources)) return
    const nextSources = sources.filter(Boolean)
    const visibleForSources = isVisibleJob(jobId)
    const snapshotForSources = activeWorkspaceSnapshot.value?.job?.jobId === jobId
      ? activeWorkspaceSnapshot.value?.databaseSources
      : null
    const previousSources = visibleForSources ? databaseSources.value : snapshotForSources
    const nextData = {
      ...(previousSources && typeof previousSources === 'object' ? previousSources : {}),
      status: nextSources.length ? 'hit' : 'empty',
      sources: nextSources,
      fallbackReason: '',
      totalHits: Math.max(previousSources?.totalHits || 0, nextSources.length),
      updatedAt: new Date().toISOString(),
      retrievalMode: 'vector',
      queryPlan: previousSources?.queryPlan || null,
      vectorPlan: {
        ...(previousSources?.vectorPlan || {}),
        returnedSources: nextSources.length,
      },
    }
    if (visibleForSources) {
      databaseSources.value = nextData
      databaseSourcesLoading.value = false
      databaseSourcesRequestId += 1
    }
    if (activeWorkspaceSnapshot.value?.job?.jobId === jobId) {
      patchActiveWorkspaceSnapshot({ databaseSources: nextData, __force: true })
    }
  }

  async function loadExecutionLog(jobId, shouldApply = () => true, { force = false, merge = force } = {}) {
    if (!jobId) {
      setActiveExecutionLogJob(null)
      return
    }
    if (!force && executionLogsByJobId.has(jobId)) {
      if (shouldApply()) setActiveExecutionLogJob(jobId)
      return
    }
    try {
      const result = await fetchReportJobEventLog(jobId)
      if (shouldApply()) setActiveExecutionLogJob(jobId, result?.items || [], { merge })
    } catch {
      if (shouldApply() && !executionLogsByJobId.has(jobId)) setActiveExecutionLogJob(jobId, [])
    }
  }

  function applyProgressState(next, jobId = activeExecutionLogJobId) {
    if (!next?.stages?.length) return
    if (isVisibleJob(jobId)) {
      progressState.value = next
      job.value = { ...job.value, progressState: next }
    }
    if (activeWorkspaceSnapshot.value?.job?.jobId === jobId) {
      patchActiveWorkspaceSnapshot({
        progressState: next,
        job: activeWorkspaceSnapshot.value.job
          ? { ...activeWorkspaceSnapshot.value.job, progressState: next }
          : activeWorkspaceSnapshot.value.job,
        __force: true,
      })
    }
  }

  async function loadProgressState(jobId, shouldApply = () => true) {
    if (!jobId) {
      if (!openedHistoryJobId.value) progressState.value = null
      return
    }
    try {
      const next = await fetchReportProgress(jobId)
      if (shouldApply()) applyProgressState(next, jobId)
    } catch {
      // Older backend versions may not expose progress yet; the UI keeps its log fallback.
    }
  }

  function firstLogString(value, keys) {
    if (!value || typeof value !== 'object') return ''
    for (const key of keys) {
      const candidate = value[key]
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
    return ''
  }

  function inferToolEngine(value) {
    const lower = String(value || '').toLowerCase()
    if (!lower) return ''
    if (lower.includes('pg-sources') || lower.includes('pg_vector')) return 'pg_vector'
    if (lower.includes('mysql')) return 'mysql'
    if (lower.includes('firecrawl')) return 'firecrawl'
    if (lower.includes('tavily_extract')) return 'tavily_extract'
    if (lower.includes('tavily')) return 'tavily'
    if (/\bexa\b/.test(lower)) return 'exa'
    if (lower.includes('harness_cli')) return 'harness'
    if (lower.includes('research_cli')) return 'research'
    if (lower.includes('sessions_')) return 'session'
    return ''
  }

  function extractToolNameFromEvent(event, raw) {
    const direct = typeof event?.name === 'string' ? event.name.trim() : ''
    if (direct) return direct
    const rawDirect = firstLogString(raw, ['toolName', 'tool_name', 'name', 'tool', 'server', 'mcpServer', 'mcp_server'])
    if (rawDirect) return rawDirect
    const functionName = raw?.function && typeof raw.function === 'object'
      ? firstLogString(raw.function, ['name'])
      : ''
    if (functionName) return functionName
    const command = firstLogString(raw, ['command'])
    if (/pg-sources__query/i.test(command)) return 'pg-sources__query'
    if (/mysql-test__mysql_query/i.test(command)) return 'mysql-test__mysql_query'
    if (/harness_cli\.py\s+plan/i.test(command)) return 'harness_cli.py plan'
    if (/harness_cli\.py\s+run/i.test(command)) return 'harness_cli.py run'
    if (/research_cli\.py/i.test(command)) return 'research_cli.py'
    if (/firecrawl/i.test(command)) return 'firecrawl'
    if (/tavily/i.test(command)) return 'tavily'
    if (/\bexa\b/i.test(command)) return 'exa'
    return ''
  }

  function normalizeEventLog(event) {
    const raw = event?.raw && typeof event.raw === 'object' ? event.raw : {}
    const label = raw.label || event.name || event.stage || event.type
    const status = raw.status || (event.type === 'tool_start' ? 'started' : event.type === 'tool_end' ? 'completed' : event.type === 'tool_error' ? 'failed' : event.type === 'tool_delta' ? 'running' : event.type)
    const summary = raw.summary || event.message || event.content || ''
    const phase = raw.phase || event.stage || ''
    const actor = raw.actor || ''
    const detail = raw.detail || ''
    const toolName = extractToolNameFromEvent(event, raw)
    const toolEngine = inferToolEngine(`${toolName} ${label} ${raw.command || ''}`)
    const metadata = {
      occurredAt: event.occurredAt || '',
      origin: event.origin || '',
      durationMs: event.durationMs,
      sequence: event.sequence,
      runEvent: event.runEvent || '',
      usage: event.usage || null,
    }

    if (event.type === 'stage') {
      return {
        type: 'stage',
        label: event.origin === 'research_harness' ? '资料采集执行' : event.origin === 'system_heartbeat' ? '系统心跳' : '阶段进度',
        status: event.stage || 'running',
        summary: event.message || event.stage || '任务阶段更新',
        phase,
        actor: actor || (event.origin === 'research_harness' ? 'research-agent' : String(event.stage || '').includes('hermes') ? 'main-agent' : 'system'),
        eventId: event.stage,
        ...metadata,
      }
    }

    if (event.type === 'tool_start' || event.type === 'tool_delta' || event.type === 'tool_end' || event.type === 'tool_error') {
      return {
        type: event.type,
        label,
        status,
        summary: summary || `${label} ${status}`,
        command: raw.command,
        phase,
        actor,
        detail,
        toolName,
        toolDisplayName: toolName,
        toolId: event.id || '',
        toolEngine,
        eventId: event.id,
        ...metadata,
      }
    }

    if (event.type === 'error') {
      return { type: 'error', label: '任务错误', status: 'failed', summary: event.message || '任务失败', phase: 'error', actor: 'system', ...metadata }
    }

    if (event.type === 'done') {
      return { type: 'done', label: '任务完成', status: 'completed', summary: '后端任务已结束。', phase: 'done', actor: 'system', eventId: event.jobId, ...metadata }
    }

    return null
  }

  function handleJobEvent(event, eventJobId = activeExecutionLogJobId) {
    if (event.type === 'progress_state') {
      applyProgressState(event.progressState, eventJobId)
      return
    }

    const log = normalizeEventLog(event)
    if (log) appendExecutionLog(log, eventJobId)
    const visibleForEvent = isVisibleJob(eventJobId)

    if (event.type === 'stage' && event.message) {
      if (visibleForEvent) {
        loadingStep.value = event.message
        pushLog(event.message)
      } else if (activeWorkspaceSnapshot.value?.job?.jobId === eventJobId) {
        patchActiveWorkspaceSnapshot({ loadingStep: event.message, __force: true })
        pushWorkspaceSnapshotLog(event.message)
      }
    }

    if (event.type === 'error') {
      const message = event.message || '任务失败'
      if (String(message).includes('Job event stream is unavailable after service restart')) {
        appendExecutionLog({
          type: 'stage',
          label: '执行日志',
          status: 'fallback',
          summary: '服务重启后实时日志通道不可用，已切换为任务状态轮询。',
        }, eventJobId)
        closeJobEvents()
        startProgressPolling(eventJobId)
        return
      }
      if (visibleForEvent) {
        errorMessage.value = message
        phase.value = 'error'
        loadingStep.value = '任务失败'
        pushLog(`错误：${errorMessage.value}`)
      } else if (activeWorkspaceSnapshot.value?.job?.jobId === eventJobId) {
        patchActiveWorkspaceSnapshot({
          errorMessage: message,
          phase: 'error',
          loadingStep: '任务失败',
          isGenerating: false,
          job: activeWorkspaceSnapshot.value.job ? { ...activeWorkspaceSnapshot.value.job, status: 'failed' } : null,
          __force: true,
        })
        pushWorkspaceSnapshotLog(`错误：${message}`)
      }
      stopProgressPolling(eventJobId)
      closeJobEvents()
    }

    if (event.type === 'sources') {
      applyLiveDatabaseSources(event.sources, eventJobId)
    }

    if (event.type === 'done') {
      fetchDatabaseSourcesData(eventJobId)
      loadProgressState(eventJobId)
      void loadExecutionLog(eventJobId, () => (
        isVisibleJob(eventJobId) || activeWorkspaceSnapshot.value?.job?.jobId === eventJobId
      ), { force: true, merge: true })
      stopProgressPolling(eventJobId)
      closeJobEvents()
    }
  }

  function subscribeJobEvents(jobId) {
    if (!jobId) return
    startProgressPolling(jobId)
    if (!window.EventSource) return
    if (subscribedJobId === jobId && jobEventSource) return

    closeJobEvents()
    const token = getAuthToken()
    if (!token) {
      appendExecutionLog({
        type: 'error',
        label: '执行日志',
        status: 'failed',
        summary: '请先登录后查看实时任务日志。',
      }, jobId)
      return
    }
    if (activeExecutionLogJobId !== jobId) setActiveExecutionLogJob(jobId)
    startProgressPolling(jobId)
    subscribedJobId = jobId
    const eventsUrl = getJobEventsUrl(jobId)
    const separator = eventsUrl.includes('?') ? '&' : '?'
    const source = new EventSource(`${eventsUrl}${separator}access_token=${encodeURIComponent(token)}`)
    jobEventSource = source

    source.onmessage = (message) => {
      if (jobEventSource !== source || subscribedJobId !== jobId) return
      try {
        handleJobEvent(JSON.parse(message.data), jobId)
      } catch {
        appendExecutionLog({
          type: 'error',
          label: '日志解析',
          status: 'failed',
          summary: '收到无法解析的执行日志事件。',
        }, jobId)
      }
    }

    source.onerror = async () => {
      if (jobEventSource !== source || subscribedJobId !== jobId) return
      try {
        const latest = await fetchReportJob(jobId)
        if (jobEventSource !== source || subscribedJobId !== jobId) return
        if (isVisibleJob(jobId)) job.value = latest
        if (activeWorkspaceSnapshot.value?.job?.jobId === jobId) patchActiveWorkspaceSnapshot({ job: latest, __force: true })
        await loadProgressState(jobId)
        await loadExecutionLog(jobId, () => (
          jobEventSource === source
          && subscribedJobId === jobId
          && (isVisibleJob(jobId) || activeWorkspaceSnapshot.value?.job?.jobId === jobId)
        ), { force: true, merge: true })
        if (latest.status === 'succeeded' || latest.status === 'failed' || latest.status === 'cancelled') {
          stopProgressPolling(jobId)
          closeJobEvents()
          return
        }
      } catch {
        // Keep the original fallback behavior when the status check itself is unavailable.
      }

      appendExecutionLog({
        type: 'stage',
        label: '执行日志',
        status: 'fallback',
        summary: '实时日志连接中断，继续使用任务状态轮询。',
      }, jobId)
      closeJobEvents()
    }
  }

  function toggleLogDrawer() {
    isLogDrawerOpen.value = !isLogDrawerOpen.value
    if (isLogDrawerOpen.value) unreadLogCount.value = 0
  }

  function getJobTitle(item) {
    const drafts = readDrafts()
    return drafts[item.jobId]?.title || item.payload?.topic || item.payload?.target_name || item.payload?.target_country || item.jobId
  }

  function applyHistoryDraft(item) {
    const drafts = readDrafts()
    const draft = drafts[item.jobId] || {}
    title.value = draft.title || item.payload?.topic || item.payload?.target_name || item.payload?.target_country || item.jobId
    contextText.value = draft.contextText || item.payload?.known_context || item.payload?.visit_context || ''
    parameterValues.value = {}
    activeParameters.value = []
    deepReportEnabled.value = item.payload?.deepReportEnabled === true

    if (item.skill === 'write-hb') {
      reportType.value = item.payload?.report_type === 'HB报' ? 'write-hb-hb' : 'write-hb-k'
    } else {
      reportType.value = item.skill || reportType.value
    }
  }

  function applyJobFormData(item) {
    title.value = getJobTitle(item)
    contextText.value = item.payload?.known_context || item.payload?.visit_context || ''
    parameterValues.value = {}
    activeParameters.value = []
    deepReportEnabled.value = item.payload?.deepReportEnabled === true

    if (item.skill === 'write-hb') {
      reportType.value = item.payload?.report_type === 'HB报' ? 'write-hb-hb' : 'write-hb-k'
    } else {
      reportType.value = item.skill || reportType.value
    }
  }

  function clearScreenForNextReport() {
    suspendPlanning()
    historyOpenRequestId += 1
    const preservedWorkspace = getUnfinishedWorkspaceSnapshot()
    generationRequestId += 1
    resetExecutionLogs()
    activeWorkspaceSnapshot.value = preservedWorkspace
    openedHistoryJobId.value = null
    detailLoading.value = false
    detailLoadError.value = ''
    selectedReport.value = null
    generatedHtml.value = ''
    errorMessage.value = ''
    processLogs.value = []
    job.value = null
    databaseSources.value = null
    databaseSourcesLoading.value = false
    databaseSourcesRequestId += 1
    isGenerating.value = false
    phase.value = 'idle'
    loadingStep.value = '等待输入任务'
    savedNotice.value = ''
    title.value = ''
    reportType.value = 'write-hb-k'
    contextText.value = ''
    parameterValues.value = {}
    activeParameters.value = ['关注方向', '时间范围', '地区 / 对象', '标签']
    countryOrRegion.value = ''
    currentPosition.value = ''
    scenario.value = 'foreign_leader_visit'
    targetCity.value = ''
    visitTime.value = ''
    outputDepth.value = 'detailed'
    deepReportEnabled.value = true
    currentView.value = 'generator'
  }

  function saveCurrentReportDraft() {
    if (!openedHistoryJobId.value) return
    const drafts = readDrafts()
    drafts[openedHistoryJobId.value] = {
      title: title.value.trim(),
      contextText: contextText.value.trim(),
      savedAt: new Date().toISOString(),
    }
    writeDrafts(drafts)
    jobList.value = jobList.value.map((item) =>
      item.jobId === openedHistoryJobId.value
        ? {
            ...item,
            displayTitle: drafts[openedHistoryJobId.value].title,
          }
        : item,
    )
    savedNotice.value = '已保存当前历史报告标题'
    pushLog(savedNotice.value)
  }

  function isVectorSourceUsable(status = vectorSourceStatus.value) {
    return Boolean(status?.enabled && status?.available && Number(status?.indexedRows || 0) > 0)
  }

  function databaseSourceOption(status = vectorSourceStatus.value) {
    const usable = isVectorSourceUsable(status)
    const indexedRows = Number(status?.indexedRows || 0)
    const parts = []
    if (status?.embeddingModel) parts.push(`模型：${status.embeddingModel}`)
    if (status?.sourceTable) parts.push(`表：${status.sourceTable}`)
    if (indexedRows > 0) parts.push(`已索引：${indexedRows.toLocaleString('zh-CN')} 条`)
    if (status?.lastIndexedAt) parts.push(`最近更新：${status.lastIndexedAt}`)
    const fallbackReason = status?.fallbackReason ? `；原因：${status.fallbackReason}` : ''
    return {
      id: 'database-source',
      label: 'PG 数据库信源',
      detail: usable
        ? `确定可采集的 PG 向量数据库信源，提交后优先召回。${parts.join('；')}`
        : `PG 数据库信源暂不可用或暂无索引数据，不能作为本次确定采集来源${fallbackReason}`,
      selected: usable,
      disabled: !usable,
      sourceGroup: 'verified',
      statusLabel: usable ? '可采集' : '不可用',
      status: usable ? 'available' : 'unavailable',
    }
  }

  async function loadVectorSourceStatus() {
    try {
      return await fetchVectorSourceStatus()
    } catch (error) {
      return {
        enabled: false,
        available: false,
        indexedRows: 0,
        fallbackReason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  function selectedNetworkSourceIds(form) {
    const haystack = [
      form.title,
      form.contextText,
      Object.values(form.parameterValues || {}).join(' '),
    ].join(' ')
    const selected = new Set()
    for (const rule of NETWORK_SOURCE_RULES) {
      if (rule.pattern.test(haystack)) rule.ids.forEach((id) => selected.add(id))
    }
    if (!selected.size) ['public_news', 'government_notice', 'think_tank_report'].forEach((id) => selected.add(id))
    return selected
  }

  function buildSourceScopeStep(form, status) {
    const recommendedIds = selectedNetworkSourceIds(form)
    const networkOptions = K_SOURCE_SCOPE_STEP.options.map((option) => {
      const recommended = recommendedIds.has(option.id)
      return {
        ...option,
        detail: `${option.detail} 这是本次编报的联网检索方向。`,
        selected: recommended,
        sourceGroup: 'network',
        statusLabel: recommended ? '主题推荐' : '检索方向',
        status: 'search_direction',
      }
    })
    return {
      ...K_SOURCE_SCOPE_STEP,
      description: '优先使用已入库信源；下方联网方向用于补充检索，实际采用以命中结果为准。',
      options: [databaseSourceOption(status), ...networkOptions],
    }
  }

  function normalizeKReportPlan(plan, form, status) {
    if (form.reportType !== 'write-hb-k' || !plan) return plan
    const originalSteps = Array.isArray(plan.steps) ? plan.steps : []
    const reportSectionSteps = originalSteps.filter((step) => step?.type === 'report_section')
    const sourceStep = buildSourceScopeStep(form, status)
    const usedStepIds = new Set()
    const sectionSteps = K_SECTION_DEFS.map((sectionDef) => {
      const matchedStep = findKSectionStep(reportSectionSteps, sectionDef, usedStepIds)
      if (matchedStep?.id) usedStepIds.add(matchedStep.id)
      const matchedOptions = (matchedStep?.options || []).map((option, index) => ({
        id: option.id || `${sectionDef.id}_${index}`,
        label: option.label || option.title || `方向 ${index + 1}`,
        detail: option.detail || option.description || '',
        selected: option.selected !== false,
      }))
      const fallbackOptions = sectionDef.fallback.map((option) => ({
        ...option,
        selected: true,
      }))
      const useMatchedOptions = matchedOptions.length > 0 && !isSourceScopeOptionGroup(matchedOptions)
      return {
        id: matchedStep?.id || sectionDef.id,
        type: 'report_section',
        sectionKey: matchedStep?.sectionKey || sectionDef.id,
        title: sectionDef.sectionTitle,
        sectionTitle: sectionDef.sectionTitle,
        description: useMatchedOptions ? (matchedStep?.description || sectionDef.description) : sectionDef.description,
        allowMultiple: true,
        options: useMatchedOptions ? matchedOptions : fallbackOptions,
      }
    })
    return {
      ...plan,
      steps: [sourceStep, ...sectionSteps, SUPPLEMENT_PLAN_STEP],
    }
  }

  function normalizePlanSectionText(value) {
    return String(value || '')
      .replace(/^[一二三四五六七八九十]+[、.．]\s*/, '')
      .replace(/\s+/g, '')
      .trim()
  }

  function findKSectionStep(steps, sectionDef, usedStepIds = new Set()) {
    const availableSteps = steps.filter((step) => !step?.id || !usedStepIds.has(step.id))
    const keys = new Set(sectionDef.sectionKeys || [])
    const titles = new Set((sectionDef.sectionTitles || [sectionDef.sectionTitle]).map(normalizePlanSectionText))
    const exact = availableSteps.find((step) => {
      const key = String(step?.sectionKey || '')
      const sectionTitle = normalizePlanSectionText(step?.sectionTitle)
      const title = normalizePlanSectionText(step?.title)
      return (key && keys.has(key)) || (sectionTitle && titles.has(sectionTitle)) || (title && titles.has(title))
    })
    if (exact) return exact

    return availableSteps.find((step) => {
      const text = `${step?.sectionTitle || ''} ${step?.title || ''}`
      return sectionDef.match.test(text)
    })
  }

  function isSourceScopeOptionGroup(options) {
    if (!Array.isArray(options) || options.length === 0) return false
    const sourceLikeCount = options.filter((option) => {
      const id = String(option?.id || '')
      const label = String(option?.label || '')
      const detail = String(option?.detail || '')
      return SOURCE_SCOPE_OPTION_IDS.has(id) ||
        SOURCE_SCOPE_OPTION_LABELS.has(label) ||
        /(官方信源|主流媒体|智库研究|行业与数据材料|公开新闻|政府与机构|供应链与贸易数据|信源|媒体|智库|数据材料)/.test(`${label} ${detail}`)
    }).length
    return sourceLikeCount >= Math.min(2, options.length)
  }

  function buildContext(extraSections = [], form = snapshotPlanningForm()) {
    const allowedParams = new Set(REPORT_PARAMETERS[form.reportType] || [])
    const sections = form.activeParameters
      .filter((param) => allowedParams.has(param))
      .map((param) => {
        const value = String(form.parameterValues[param] || '').trim()
        return value ? `【${param}】\n${value}` : ''
      })
      .filter(Boolean)
    const freeText = form.contextText.trim()
    if (freeText) sections.push(`【综合补充说明】\n${freeText}`)
    for (const section of extraSections) {
      if (section) sections.push(section)
    }
    return sections.join('\n\n')
  }

  function buildPlanningContext(draft) {
    const { form, editor, vectorStatus } = draft
    const plan = editor.reportPlan
    const selectedQueries = plan?.searchQueries?.length
      ? editor.planSearchSelections.filter((query) => plan.searchQueries?.includes(query))
      : []
    const selectedModules = []
    const selectedSources = []
    for (const step of plan?.steps || []) {
      const selectedIds = new Set(editor.planSelections[step.id] || [])
      const selected = step.options?.filter((option) => selectedIds.has(option.id)) || []
      if (!selected.length) continue
      const selectedOptions = selected.map((option) => ({
        id: option.id,
        label: option.label,
        detail: option.detail || '',
        sourceGroup: option.sourceGroup || '',
        status: option.status || '',
      }))
      if (step.type === 'source_scope') {
        selectedSources.push(...selectedOptions)
        continue
      }
      if (step.type === 'report_section') {
        selectedModules.push({
          stepId: step.id,
          stepType: step.type,
          sectionKey: step.sectionKey || step.id,
          sectionTitle: step.sectionTitle || step.title,
          selectedDirections: selectedOptions,
        })
        continue
      }
      selectedModules.push({
        stepId: step.id,
        stepType: step.type || 'analysis_module',
        title: step.title,
        options: selectedOptions,
      })
    }

    const allowedParams = new Set(REPORT_PARAMETERS[form.reportType] || [])
    const selectedParameterValues = {}
    for (const [key, value] of Object.entries(form.parameterValues)) {
      if (allowedParams.has(key) && String(value || '').trim()) selectedParameterValues[key] = String(value).trim()
    }

    const userProvidedSources = editor.planSourceInput
      .split(/\r?\n|；|;/)
      .map((item) => item.trim())
      .filter(Boolean)
    const context = {
      kind: 'structured_report_context',
      version: 2,
      topic: form.title.trim(),
      reportType: form.reportType,
      intentRecognition: plan?.intentRecognition || null,
      eventTaskPlan: plan?.eventTaskPlan || null,
      selectedSearchQueries: selectedQueries,
      selectedSources,
      userProvidedSources,
      databaseSourceOptions: {
        enabled: Boolean(editor.databaseSourceEnabled && isVectorSourceUsable(vectorStatus)),
        mode: 'summary_first',
        lookbackDays: 90,
        maxMetadataRows: 50,
        maxContentRows: 8,
        mcpServer: 'pg-sources',
        storageMode: 'pgvector_single_table',
        sourceTable: vectorStatus?.sourceTable || 'vector_materials_qwen3',
      },
      selectedModules,
      parameterValues: selectedParameterValues,
      freeTextContext: form.contextText.trim(),
      supplement: editor.planSupplement.trim(),
      instructions: {
        researchPhase: 'Use PostgreSQL pgvector source recall first when databaseSourceOptions.enabled is true, then use accepted internet sources as needed. Do not override report_plan, databaseSourceOptions, userPreferenceContext, or draftAssistantContext. Return evidence cards, key findings, verification-needed items, and information gaps as internal material.',
        writeHbPhase: 'Use write-hb after research to draft the final report by sectionTitle. Expand only the selectedDirections under each selected report section.',
        citationPolicy: 'Do not put raw URLs in report body paragraphs; keep full URLs only in the final references section.',
      },
    }

    return JSON.stringify(context, null, 2)
  }

  function buildPlanningFocusAreas(extraContext = '') {
    const fallback = ['国家', '地方', '政策', '社会', '传播']
    try {
      const parsed = JSON.parse(String(extraContext || '{}'))
      const modules = Array.isArray(parsed?.selectedModules) ? parsed.selectedModules : []
      const focusAreas = []
      for (const module of modules) {
        const sectionTitle = String(module?.sectionTitle || module?.title || '').trim()
        const directions = Array.isArray(module?.selectedDirections || module?.options)
          ? (module.selectedDirections || module.options)
          : []
        if (sectionTitle) focusAreas.push(sectionTitle)
        for (const direction of directions) {
          const label = String(direction?.label || direction || '').trim()
          if (label) focusAreas.push(sectionTitle ? `${sectionTitle}：${label}` : label)
        }
      }
      const uniqueFocusAreas = Array.from(new Set(focusAreas)).slice(0, 24)
      return uniqueFocusAreas.length ? uniqueFocusAreas : fallback
    } catch {
      return fallback
    }
  }

  function buildPayload(extraContext = '', form = snapshotPlanningForm()) {
    const subject = form.title.trim()
    const isStructuredContext = String(extraContext || '').trim().startsWith('{')
    const context = isStructuredContext ? String(extraContext).trim() : (buildContext(extraContext ? [extraContext] : [], form) || subject)

    if (form.reportType === 'person-intelligence-report') {
      return {
        skill: 'person-intelligence-report',
        payload: {
          target_name: subject,
          country_or_region: form.countryOrRegion.trim() || '待研判',
          current_position: form.currentPosition.trim() || '待研判',
          report_type: 'visiting_dignitary',
          visit_context: context,
          useMyPreferences: false,
          focus_areas: ['基本情况', '政治立场', '风险点', '接待建议'],
          output_depth: form.outputDepth,
          deepReportEnabled: true,
          language: 'zh-CN',
        },
      }
    }

    if (form.reportType === 'write-hb-k' || form.reportType === 'write-hb-hb') {
      const planningPayload = isStructuredContext
        ? buildPlanningContextPayload({ topic: subject, knownContext: context })
        : { topic: subject, known_context: context }
      return {
        skill: 'write-hb',
        payload: {
          ...planningPayload,
          report_type: form.reportType === 'write-hb-hb' ? 'HB报' : 'K报',
          useMyPreferences: false,
          deepReportEnabled: true,
          focus_areas: isStructuredContext ? buildPlanningFocusAreas(extraContext) : ['国家', '地方', '政策', '社会', '传播'],
          language: 'zh-CN',
        },
      }
    }

    return {
      skill: 'risk-assessment-reports',
      payload: {
        scenario: form.scenario,
        target_country: subject,
        target_city: form.targetCity.trim(),
        visit_time: form.visitTime.trim(),
        known_context: context,
        useMyPreferences: false,
        deepReportEnabled: true,
        focus_areas: ['公开信息检索', '风险识别', '舆情走势', '处置建议'],
        language: 'zh-CN',
      },
    }
  }

  async function refreshHealth(shouldApply = () => true) {
    const canApply = typeof shouldApply === 'function' ? shouldApply : () => true
    try {
      const result = await fetchHermesHealth()
      if (!canApply()) return
      health.value = result
      pushLog(`健康检测：${health.value.status}`)
    } catch (error) {
      if (!canApply()) return
      health.value = {
        ok: false,
        status: 'down',
        checks: {},
        details: [error instanceof Error ? error.message : String(error)],
      }
      pushLog(`健康检测失败：${health.value.details[0]}`)
    }
  }

  async function pollUntilDone(jobId) {
    if (activePollJobId.value === jobId) return
    activePollJobId.value = jobId

    const stepMessages = [
      '系统已接收任务',
      '正在检索公开信息',
      '正在整理证据和来源',
      '正在生成报告正文',
      '正在等待文件落盘',
    ]
    let tick = 0
    let interval = 2000
    const maxInterval = 10000

    try {
      while (activePollJobId.value === jobId) {
        const next = await fetchReportJob(jobId)
        if (next?.progressState) applyProgressState(next.progressState, jobId)
        else void loadProgressState(jobId, () => activePollJobId.value === jobId)
        const visibleForPoll = isVisibleJob(jobId)
        const nextLoadingStep = stepMessages[tick % stepMessages.length]
        if (visibleForPoll) {
          job.value = next
          loadingStep.value = nextLoadingStep
          pushLog(`任务状态：${next.status}${next.stage ? ` / ${next.stage}` : ''}`)
        } else if (activeWorkspaceSnapshot.value?.job?.jobId === jobId) {
          patchActiveWorkspaceSnapshot({ job: next, loadingStep: nextLoadingStep, __force: true })
          pushWorkspaceSnapshotLog(`任务状态：${next.status}${next.stage ? ` / ${next.stage}` : ''}`)
        }
        const promotePolledJob = openedHistoryJobId.value !== jobId && isUnfinishedJob(next)
        upsertJobInList(next, { promote: promotePolledJob })
        upsertJobInRecent(next, { promote: promotePolledJob })
        tick += 1

        if (tick % 4 === 0) fetchDatabaseSourcesData(jobId)

        if (next.status === 'succeeded') {
          fetchDatabaseSourcesData(jobId)
          if (visibleForPoll) loadingStep.value = '正在读取报告文件内容'
          const result = await fetchReportResult(jobId)
          const completedJob = { ...next, resultPath: result.resultPath || next.resultPath }
          if (isVisibleJob(jobId)) {
            generatedHtml.value = result.html || ''
            job.value = completedJob
            selectedReport.value = {
              ...job.value,
              html: generatedHtml.value,
            }
            phase.value = 'done'
            if (openedHistoryJobId.value !== jobId) openedHistoryJobId.value = null
            pushLog('已读取后端返回的 HTML 报告。')
          }
          if (!activeWorkspaceSnapshot.value || activeWorkspaceSnapshot.value.job?.jobId === jobId) {
            activeWorkspaceSnapshot.value = {
              ...(activeWorkspaceSnapshot.value || makeWorkspaceSnapshot()),
              job: completedJob,
              generatedHtml: result.html || '',
              selectedReport: { ...completedJob, html: result.html || '' },
              phase: 'done',
              loadingStep: '已完成',
              isGenerating: false,
            }
          }
          upsertJobInList(completedJob)
          upsertJobInRecent(completedJob)
          await loadJobList(false)
          return
        }

        if (next.status === 'failed' || next.status === 'waiting_approval' || next.status === 'cancelled') {
          throw new Error(next.errorMessage || `任务未成功完成：${next.status}`)
        }

        await sleep(interval)
        interval = Math.min(interval * 2, maxInterval)
      }
    } finally {
      stopProgressPolling(jobId)
      if (activePollJobId.value === jobId) activePollJobId.value = null
    }
  }

  function initializePlanSelections(plan) {
    const selections = {}
    planSearchSelections.value = [...(plan?.searchQueries || [])]
    for (const step of plan?.steps || []) {
      selections[step.id] = (step.options || [])
        .filter((option) => option.selected && !option.disabled)
        .map((option) => option.id)
    }
    planSelections.value = selections
  }

  function togglePlanOption(stepId, optionId) {
    const step = reportPlan.value?.steps?.find((item) => item.id === stepId)
    const option = step?.options?.find((item) => item.id === optionId)
    if (option?.disabled) return
    const current = new Set(planSelections.value[stepId] || [])
    if (current.has(optionId)) {
      current.delete(optionId)
    } else {
      if (step && step.allowMultiple === false) current.clear()
      current.add(optionId)
    }
    planSelections.value = {
      ...planSelections.value,
      [stepId]: Array.from(current),
    }
  }

  function addPlanOption(stepId, payload = {}) {
    const label = String(payload.label || '').trim()
    if (!label || !reportPlan.value?.steps?.length) return
    let addedId = ''
    const nextSteps = reportPlan.value.steps.map((step) => {
      if (step.id !== stepId) return step
      const existing = new Set((step.options || []).map((option) => String(option.label || '').trim().toLowerCase()))
      if (existing.has(label.toLowerCase())) return step
      const baseId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      addedId = baseId
      return {
        ...step,
        options: [
          ...(step.options || []),
          {
            id: baseId,
            label,
            detail: String(payload.detail || '用户手动新增方向，提交后纳入检索和写报要求。').trim(),
            selected: true,
            sourceGroup: step.type === 'source_scope' ? 'network' : 'manual',
            status: 'manual',
            statusLabel: '用户新增',
          },
        ],
      }
    })
    if (!addedId) return
    reportPlan.value = {
      ...reportPlan.value,
      steps: nextSteps,
    }
    const current = new Set(planSelections.value[stepId] || [])
    current.add(addedId)
    planSelections.value = {
      ...planSelections.value,
      [stepId]: Array.from(current),
    }
  }

  function togglePlanSearchQuery(query) {
    const current = new Set(planSearchSelections.value)
    if (current.has(query)) {
      if (current.size <= 1) return
      current.delete(query)
    } else {
      current.add(query)
    }
    planSearchSelections.value = (reportPlan.value?.searchQueries || []).filter((item) => current.has(item))
  }

  function resolvePlanIntent(resolved) {
    if (!reportPlan.value || !['event_timeline', 'other'].includes(resolved)) return
    planError.value = ''
    reportPlan.value = attachEventPlanningSteps({
      ...reportPlan.value,
      intentRecognition: {
        ...(reportPlan.value.intentRecognition || {}),
        resolved,
      },
    })
    planStepIndex.value = Math.min(
      planStepIndex.value,
      Math.max((reportPlan.value?.steps?.length || 1) - 1, 0),
    )
  }

  function updatePlanEventTask(payload = {}) {
    const taskId = String(payload.id || '')
    const changes = payload.changes && typeof payload.changes === 'object' ? payload.changes : {}
    if (!taskId || !reportPlan.value?.eventTaskPlan?.tasks) return
    planError.value = ''
    reportPlan.value = {
      ...reportPlan.value,
      eventTaskPlan: {
        ...reportPlan.value.eventTaskPlan,
        tasks: reportPlan.value.eventTaskPlan.tasks.map((task) => task.id === taskId
          ? {
              ...task,
              ...(typeof changes.enabled === 'boolean' ? { enabled: changes.enabled } : {}),
              ...(typeof changes.objective === 'string' ? { objective: changes.objective.slice(0, 500) } : {}),
              ...(Array.isArray(changes.searchQueries)
                ? { searchQueries: changes.searchQueries.map((query) => String(query).trim().slice(0, 80)).filter(Boolean).slice(0, 3) }
                : {}),
            }
          : task),
      },
    }
  }

  function nextPlanStep() {
    const total = reportPlan.value?.steps?.length || 0
    planStepIndex.value = Math.min(planStepIndex.value + 1, Math.max(total - 1, 0))
  }

  function prevPlanStep() {
    planStepIndex.value = Math.max(planStepIndex.value - 1, 0)
  }

  function cancelReportPlan() {
    suspendPlanning()
  }

  function handleGenerate() {
    if (isGenerating.value || !title.value.trim() || !reportType.value || !planningAccount) return
    const form = snapshotPlanningForm()
    return requestNewPlanning(() => generatePlanning(planning.start(form)))
  }

  function retryPlanning() {
    if (!planningDraft.value || !['error', 'interrupted'].includes(planningDraft.value.status)) return
    return generatePlanning(planning.begin('generating'))
  }

  async function generatePlanning(token) {
    if (!token) return
    const form = clonePlanningValue(planningDraft.value.form)
    planError.value = ''
    reportPlan.value = null
    planStepIndex.value = 0

    try {
      const vectorStatus = await loadVectorSourceStatus()
      if (!planning.matches(token)) return
      planningDraft.value.vectorStatus = vectorStatus
      databaseSourceEnabled.value = isVectorSourceUsable(vectorStatus)
      if (planningVisible.value) vectorSourceStatus.value = vectorStatus
      const allowedParams = new Set(REPORT_PARAMETERS[form.reportType] || [])
      const parameters = {}
      for (const [key, value] of Object.entries(form.parameterValues)) {
        if (allowedParams.has(key) && String(value || '').trim()) parameters[key] = String(value).trim()
      }
      const plan = await createReportPlan({
        topic: form.title.trim(),
        reportType: form.reportType,
        context: buildContext([], form),
        parameters,
      })
      if (!planning.matches(token)) return
      const normalizedPlan = attachEventPlanningSteps(normalizeKReportPlan(plan, form, vectorStatus))
      if (!normalizedPlan || !Array.isArray(normalizedPlan.steps)) throw new Error('规划结果无效，请重试。')
      reportPlan.value = normalizedPlan
      initializePlanSelections(normalizedPlan)
      planningDraft.value.status = 'ready'
    } catch (error) {
      if (!planning.matches(token)) return
      planError.value = error instanceof Error ? error.message : String(error)
      planningDraft.value.status = 'error'
    } finally {
      if (planning.matches(token)) planning.flush()
    }
  }

  function retryPlanningSubmission() {
    if (planningDraft.value?.status !== 'uncertain') return
    if (!window.confirm('请先查看历史记录，确认没有创建同一编报任务。确认重新提交可能产生重复任务，是否继续？')) return
    planningDraft.value.status = 'ready'
    return confirmReportPlan()
  }

  async function confirmReportPlan() {
    if (isGenerating.value || planningDraft.value?.status !== 'ready') return
    const planningIssue = eventPlanningError(reportPlan.value?.intentRecognition, reportPlan.value?.eventTaskPlan)
    if (planningIssue) {
      planError.value = planningIssue
      return
    }

    const draft = clonePlanningValue(planningDraft.value)
    const payload = buildPayload(buildPlanningContext(draft), draft.form)
    const token = planning.begin('submitting')
    const accountAtSubmit = planningAccountRevision
    const requestId = ++generationRequestId
    planningDraft.value.submissionError = ''
    resetExecutionLogs()
    openedHistoryJobId.value = null
    isGenerating.value = true
    generatedHtml.value = ''
    errorMessage.value = ''
    processLogs.value = []
    selectedReport.value = null
    databaseSources.value = null
    databaseSourcesLoading.value = false
    databaseSourcesRequestId += 1
    job.value = null
    phase.value = 'loading'
    loadingStep.value = '预计 3-5 分钟生成，请耐心等待'
    savedNotice.value = ''

    let submittedJobId = ''
    let requestSent = false
    try {
      pushLog('提交报告生成任务到后端。')
      if (!getAuthToken()) {
        throw new Error('请先登录后再创建编报任务。')
      }
      await refreshHealth(() => planning.matches(token) && requestId === generationRequestId)
      if (!planning.matches(token)) return
      requestSent = true
      const created = await awaitPlanningSubmission(createReportJob(payload))
      if (accountAtSubmit !== planningAccountRevision) return
      if (typeof created?.jobId !== 'string' || !created.jobId.trim()) {
        throw new Error('服务端未返回有效任务编号，提交结果待核实。')
      }
      submittedJobId = created.jobId
      const createdJob = {
        ...created, ...payload, status: created.status || 'queued',
        createdAt: created.createdAt || new Date().toISOString(),
      }
      if (planning.matches(token)) planning.discard()
      if (requestId !== generationRequestId) {
        const backgroundJob = createdJob
        upsertJobInList(backgroundJob)
        upsertJobInRecent(backgroundJob)
        return
      }
      job.value = createdJob
      activeWorkspaceSnapshot.value = makeWorkspaceSnapshot({ job: job.value })
      upsertJobInList(job.value)
      upsertJobInRecent(job.value)
      pushLog(`任务已创建：${created.jobId}`)
      subscribeJobEvents(created.jobId)
      void loadProgressState(created.jobId, () => job.value?.jobId === created.jobId)
      await pollUntilDone(created.jobId)
    } catch (error) {
      if (accountAtSubmit !== planningAccountRevision) return
      const backgroundMessage = error instanceof Error ? error.message : String(error)
      if (!submittedJobId && planning.matches(token)) {
        // Transport/server errors can occur after the backend accepted the POST.
        const rejected = !requestSent || (error?.status >= 400 && error?.status < 500 && error.status !== 408)
        planningDraft.value.status = rejected ? 'ready' : 'uncertain'
        planningDraft.value.submissionError = backgroundMessage
        planning.flush()
        if (requestId === generationRequestId) {
          phase.value = 'idle'
          errorMessage.value = ''
        }
        return
      }
      if (requestId !== generationRequestId && !submittedJobId) return
      if (submittedJobId && !isVisibleJob(submittedJobId)) {
        if (activeWorkspaceSnapshot.value?.job?.jobId !== submittedJobId) return
        patchActiveWorkspaceSnapshot({
          errorMessage: backgroundMessage,
          phase: 'error',
          loadingStep: '任务失败',
          isGenerating: false,
          job: activeWorkspaceSnapshot.value?.job
            ? { ...activeWorkspaceSnapshot.value.job, status: 'failed', errorMessage: backgroundMessage }
            : null,
          __force: true,
        })
        pushWorkspaceSnapshotLog(`错误：${backgroundMessage}`)
        return
      }
      errorMessage.value = error instanceof Error ? error.message : String(error)
      phase.value = 'error'
      loadingStep.value = '任务失败'
      pushLog(`错误：${errorMessage.value}`)
    } finally {
      if (requestId === generationRequestId && (!submittedJobId || isVisibleJob(submittedJobId))) {
        isGenerating.value = false
      }
    }
  }

  async function loadJobList(switchView = true, overrides = {}) {
    if (switchView) {
      suspendPlanning()
      currentView.value = 'list'
    }
    const requestId = ++jobListRequestId
    try {
      if (overrides.page !== undefined) listPage.value = overrides.page
      if (overrides.pageSize !== undefined) listPageSize.value = overrides.pageSize
      if (overrides.q !== undefined) listSearch.value = overrides.q
      if (overrides.trash !== undefined) {
        listTrashMode.value = Boolean(overrides.trash)
        listPage.value = overrides.page !== undefined ? listPage.value : 1
      }

      const drafts = readDrafts()
      const response = await fetchReportJobs({
        page: listPage.value,
        pageSize: listPageSize.value,
        q: listSearch.value.trim(),
        trash: listTrashMode.value ? 'true' : '',
        createdAfter: REPORT_HISTORY_CREATED_AFTER,
      })
      if (requestId !== jobListRequestId) return
      const items = Array.isArray(response) ? response : response.items || []
      jobList.value = items.map((item) => ({
        ...item,
        displayTitle: drafts[item.jobId]?.title || undefined,
      }))
      if (Array.isArray(response)) {
        listTotal.value = jobList.value.length
        listTotalPages.value = 1
        listStatusCounts.value = {
          succeeded: jobList.value.filter((item) => item.status === 'succeeded').length,
          running: jobList.value.filter((item) => item.status === 'running' || item.status === 'queued').length,
        }
      } else {
        listTotal.value = response.total || 0
        listPage.value = response.page || listPage.value
        listPageSize.value = response.pageSize || listPageSize.value
        listTotalPages.value = response.totalPages || 1
        listStatusCounts.value = response.statusCounts || { succeeded: 0, running: 0 }
      }
    } catch (error) {
      if (requestId !== jobListRequestId) return
      errorMessage.value = error instanceof Error ? error.message : String(error)
      pushLog(`历史任务加载失败：${errorMessage.value}`)
    }
  }

  function updateListSearch(value) {
    listSearch.value = value
    listPage.value = 1
    if (listSearchTimer) window.clearTimeout(listSearchTimer)
    listSearchTimer = window.setTimeout(() => {
      listSearchTimer = null
      void loadJobList(false)
    }, 300)
  }

  function updateListPage(page) {
    listPage.value = Math.max(1, Math.min(Number(page) || 1, listTotalPages.value || 1))
    return loadJobList(false)
  }

  function updateListPageSize(pageSize) {
    listPageSize.value = Number(pageSize) || 20
    listPage.value = 1
    return loadJobList(false)
  }

  async function openReportFromList(item) {
    suspendPlanning()
    generationRequestId += 1
    const requestId = ++historyOpenRequestId
    const unfinishedWorkspace = getUnfinishedWorkspaceSnapshot(item.jobId)
    closeJobEvents()
    stopProgressPolling()
    if (unfinishedWorkspace) activeWorkspaceSnapshot.value = unfinishedWorkspace
    currentView.value = 'generator'
    openedHistoryJobId.value = item.jobId
    job.value = item
    progressState.value = item.progressState || null
    phase.value = 'history-loading'
    loadingStep.value = '正在加载历史报告'
    detailLoading.value = true
    detailLoadError.value = ''
    selectedReport.value = null
    generatedHtml.value = ''
    databaseSources.value = null
    databaseSourcesLoading.value = false
    executionLogs.value = []
    unreadLogCount.value = 0
    activeExecutionLogJobId = item.jobId
    processLogs.value = []
    errorMessage.value = ''
    savedNotice.value = ''

    const isCurrentHistory = () => requestId === historyOpenRequestId && openedHistoryJobId.value === item.jobId
    void loadExecutionLog(item.jobId, isCurrentHistory)
    void loadProgressState(item.jobId, isCurrentHistory)
    void fetchDatabaseSourcesData(item.jobId, isCurrentHistory)

    try {
      const result = await fetchReportResult(item.jobId)
      if (!isCurrentHistory()) return
      job.value = { ...item, resultPath: result.resultPath || item.resultPath }
      generatedHtml.value = result.html || ''
      selectedReport.value = { ...job.value, html: generatedHtml.value }
      applyHistoryDraft(item)
      phase.value = 'done'
      detailLoadError.value = ''
      pushLog(`已打开历史报告：${item.jobId}`)
    } catch (error) {
      if (!isCurrentHistory()) return
      const message = error instanceof Error ? error.message : String(error)
      errorMessage.value = message
      detailLoadError.value = message || '历史报告加载失败'
      phase.value = 'history-error'
    } finally {
      if (isCurrentHistory()) detailLoading.value = false
    }
  }

  async function monitorJobFromList(item) {
    suspendPlanning()
    generationRequestId += 1
    historyOpenRequestId += 1
    const requestId = historyOpenRequestId
    if (activeWorkspaceSnapshot.value?.job?.jobId === item.jobId) {
      restoreWorkspaceSnapshot()
      return
    }

    if (item.status === 'succeeded') {
      await openReportFromList(item)
      return
    }

    const unfinishedWorkspace = getUnfinishedWorkspaceSnapshot(item.jobId)
    currentView.value = 'generator'
    if (activePollJobId.value === item.jobId && activeWorkspaceSnapshot.value?.job?.jobId === item.jobId) {
      restoreWorkspaceSnapshot()
      return
    }

    closeJobEvents()
    stopProgressPolling()
    openedHistoryJobId.value = item.jobId
    detailLoading.value = false
    detailLoadError.value = ''
    selectedReport.value = null
    generatedHtml.value = ''
    databaseSources.value = null
    databaseSourcesLoading.value = false
    executionLogs.value = []
    unreadLogCount.value = 0
    activeExecutionLogJobId = item.jobId
    errorMessage.value = ''
    savedNotice.value = ''
    processLogs.value = []
    job.value = item
    progressState.value = item.progressState || null
    phase.value = 'loading'
    loadingStep.value = '正在跟踪后端任务状态'
    applyJobFormData(item)
    if (unfinishedWorkspace) activeWorkspaceSnapshot.value = unfinishedWorkspace
    upsertJobInList(item, { promote: false })
    subscribeJobEvents(item.jobId)
    const isCurrentRunning = () => historyOpenRequestId === requestId && openedHistoryJobId.value === item.jobId && job.value?.jobId === item.jobId
    void loadExecutionLog(item.jobId, isCurrentRunning)
    void loadProgressState(item.jobId, isCurrentRunning)
    void fetchDatabaseSourcesData(item.jobId, isCurrentRunning)

    if (item.status === 'failed' || item.status === 'waiting_approval' || item.status === 'cancelled') {
      phase.value = 'error'
      loadingStep.value = '任务未成功完成'
      errorMessage.value = item.errorMessage || `任务状态：${item.status}`
      pushLog(errorMessage.value)
      return
    }

    isGenerating.value = true
    pushLog(`继续查看任务：${item.jobId}`)

    try {
      await pollUntilDone(item.jobId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isVisibleJob(item.jobId)) {
        errorMessage.value = message
        phase.value = 'error'
        loadingStep.value = '任务失败'
        pushLog(`错误：${errorMessage.value}`)
      } else if (activeWorkspaceSnapshot.value?.job?.jobId === item.jobId) {
        patchActiveWorkspaceSnapshot({
          errorMessage: message,
          phase: 'error',
          loadingStep: '任务失败',
          isGenerating: false,
          job: { ...activeWorkspaceSnapshot.value.job, status: 'failed', errorMessage: message },
          __force: true,
        })
        pushWorkspaceSnapshotLog(`错误：${message}`)
      }
    } finally {
      if (isVisibleJob(item.jobId)) isGenerating.value = false
      if (activeWorkspaceSnapshot.value?.job?.jobId === item.jobId) {
        patchActiveWorkspaceSnapshot({ isGenerating: false, __force: true })
      }
    }
  }

  async function retryOpenCurrentHistoryReport() {
    const jobId = openedHistoryJobId.value || job.value?.jobId
    if (!jobId) return
    const item = job.value?.jobId === jobId
      ? job.value
      : jobList.value.find((entry) => entry.jobId === jobId) || recentJobs.value.find((entry) => entry.jobId === jobId)
    if (item) await openReportFromList(item)
  }

  async function deleteReportFromList(item) {
    const jobId = item?.jobId || ''
    if (!jobId) return
    const title = getJobTitle(item)
    const confirmed = window.confirm(`确认将编报「${title}」移入垃圾箱？\n\n可在垃圾箱中恢复，或再次确认后永久删除。`)
    if (!confirmed) return

    try {
      await deleteReportJob(jobId)
      jobList.value = jobList.value.filter((entry) => entry.jobId !== jobId)
      recentJobs.value = recentJobs.value.filter((entry) => entry.jobId !== jobId)
      listTotal.value = Math.max(0, Number(listTotal.value || 0) - 1)
      listStatusCounts.value = {
        succeeded: Math.max(0, Number(listStatusCounts.value?.succeeded || 0) - (item.status === 'succeeded' ? 1 : 0)),
        running: Math.max(0, Number(listStatusCounts.value?.running || 0) - ((item.status === 'running' || item.status === 'queued') ? 1 : 0)),
      }
      if (job.value?.jobId === jobId) {
        closeJobEvents()
        openedHistoryJobId.value = ''
        job.value = null
        selectedReport.value = null
        generatedHtml.value = ''
        detailLoadError.value = ''
        detailLoading.value = false
        currentView.value = 'list'
        phase.value = 'input'
        loadingStep.value = '等待输入任务'
      }
      await Promise.allSettled([loadJobList(false, { trash: listTrashMode.value }), refreshRecentReports()])
      pushLog(`已移入垃圾箱：${jobId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errorMessage.value = message
      pushLog(`删除编报失败：${message}`)
      throw error
    }
  }

  async function restoreReportFromTrash(item) {
    const jobId = item?.jobId || ''
    if (!jobId) return
    try {
      await restoreReportJob(jobId)
      jobList.value = jobList.value.filter((entry) => entry.jobId !== jobId)
      listTotal.value = Math.max(0, Number(listTotal.value || 0) - 1)
      await Promise.allSettled([loadJobList(false, { trash: listTrashMode.value }), refreshRecentReports()])
      pushLog(`已从垃圾箱恢复：${jobId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errorMessage.value = message
      pushLog(`恢复编报失败：${message}`)
      throw error
    }
  }

  async function permanentlyDeleteReportFromTrash(item) {
    const jobId = item?.jobId || ''
    if (!jobId) return
    const title = getJobTitle(item)
    const confirmed = window.confirm(`永久删除编报「${title}」？\n\n这会删除任务状态、任务目录和已生成报告文件，操作不可恢复。`)
    if (!confirmed) return
    try {
      await permanentlyDeleteReportJob(jobId)
      jobList.value = jobList.value.filter((entry) => entry.jobId !== jobId)
      recentJobs.value = recentJobs.value.filter((entry) => entry.jobId !== jobId)
      listTotal.value = Math.max(0, Number(listTotal.value || 0) - 1)
      await Promise.allSettled([loadJobList(false, { trash: true }), refreshRecentReports()])
      pushLog(`已永久删除编报：${jobId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errorMessage.value = message
      pushLog(`永久删除编报失败：${message}`)
      throw error
    }
  }

  function showGenerator() {
    if (!restoreWorkspaceSnapshot()) currentView.value = 'generator'
  }

  function resetAndShowGenerator() {
    clearScreenForNextReport()
  }

  onMounted(async () => {
    window.addEventListener('pagehide', planning.flush)
    await refreshHealth()
    await loadJobList(false)
    await refreshRecentReports()
    listRefreshTimer = window.setInterval(() => {
      if (currentView.value === 'list' && runningCount.value > 0) {
        loadJobList(false)
      }
      if (
        !isViewingHistoryJob.value &&
        (
          runningCount.value > 0 ||
          recentJobs.value.some((item) => isUnfinishedJob(item)) ||
          activeWorkspaceSnapshot.value?.job?.jobId
        )
      ) {
        refreshRecentReports()
      }
    }, 5000)
  })

  onUnmounted(() => {
    window.removeEventListener('pagehide', planning.flush)
    planning.dispose()
    closeJobEvents()
    if (listSearchTimer) {
      window.clearTimeout(listSearchTimer)
      listSearchTimer = null
    }
    if (listRefreshTimer) {
      window.clearInterval(listRefreshTimer)
      listRefreshTimer = null
    }
  })

  return {
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
    planError,
    generatedHtml,
    phase,
    processLogs,
    loadingStep,
    job,
    jobList,
    recentJobs: displayRecentJobs,
    recentLoadingMore,
    recentHasMore,
    recentLoadError,
    listSearch,
    listPage,
    listPageSize,
    listTotal,
    listTotalPages,
    listTrashMode,
    health,
    errorMessage,
    selectedReport,
    openedHistoryJobId,
    detailLoading,
    detailLoadError,
    savedNotice,
    isHistoryMode,
    hasActiveWorkspace,
    activeWorkspaceJobId,
    activeWorkspaceStatus,
    returnableWorkspaceJobId,
    filteredJobs,
    succeededCount,
    runningCount,
    executionLogs,
    progressState,
    databaseSources,
    databaseSourcesLoading,
    vectorSourceStatus,
    vectorSourceStatusLoading,
    unreadLogCount,
    isLogDrawerOpen,
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
    openReportFromList,
    monitorJobFromList,
    deleteReportFromList,
    restoreReportFromTrash,
    permanentlyDeleteReportFromTrash,
    retryOpenCurrentHistoryReport,
    showGenerator,
    backgroundActiveWorkspace,
    resetForNewReport: resetAndShowGenerator,
    saveCurrentReportDraft,
    toggleLogDrawer,
  }
}
