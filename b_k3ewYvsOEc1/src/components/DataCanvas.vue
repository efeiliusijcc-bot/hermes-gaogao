<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { createChatCompletion, createReportEdit, fetchQaSessionSources, fetchReportSources, getAuthToken, getChatStreamUrl, getReportEdits, getReportQualityReview, runReportQualityReview } from '../lib/api.js'
import { filterAcceptedReportReferences, firstSourceDisplayText, resolveSourceGroup, sanitizeSourceDisplayText, sourceHostname } from '../lib/sourceDisplay.js'

const purifyConfig = {
  ALLOWED_TAGS: [
    'h1','h2','h3','h4','h5','h6','p','br','hr','div','span',
    'ul','ol','li','table','thead','tbody','tr','th','td',
    'strong','em','b','i','u','a','blockquote','pre','code',
    'img','figure','figcaption','sub','sup',
  ],
  ALLOWED_ATTR: ['href','src','alt','title','class','id','target','rel'],
}

const props = defineProps({
  phase: String,
  loadingStep: String,
  processLogs: Array,
  generatedHtml: String,
  reportType: String,
  title: String,
  contextText: String,
  parameterValues: {
    type: Object,
    default: () => ({}),
  },
  activeParameters: {
    type: Array,
    default: () => [],
  },
  job: Object,
  jobList: Array,
  health: Object,
  errorMessage: String,
  detailLoading: Boolean,
  detailLoadError: String,
  isHistoryMode: Boolean,
  isGenerating: Boolean,
  isPlanning: Boolean,
  reportPlan: Object,
  planStepIndex: {
    type: Number,
    default: 0,
  },
  planSelections: {
    type: Object,
    default: () => ({}),
  },
  planSearchSelections: {
    type: Array,
    default: () => [],
  },
  planSourceInput: {
    type: String,
    default: '',
  },
  planSupplement: {
    type: String,
    default: '',
  },
  databaseSourceEnabled: {
    type: Boolean,
    default: true,
  },
  useMyPreferences: {
    type: Boolean,
    default: false,
  },
  deepReportEnabled: {
    type: Boolean,
    default: false,
  },
  planError: String,
  executionLogs: {
    type: Array,
    default: () => [],
  },
  progressState: {
    type: Object,
    default: null,
  },
  databaseSources: {
    type: Object,
    default: null,
  },
  databaseSourcesLoading: {
    type: Boolean,
    default: false,
  },
  vectorSourceStatus: {
    type: Object,
    default: null,
  },
  vectorSourceStatusLoading: {
    type: Boolean,
    default: false,
  },
  unreadLogCount: {
    type: Number,
    default: 0,
  },
  isLogDrawerOpen: Boolean,
  hasReturnableWorkspace: Boolean,
  canDeleteReport: Boolean,
  homeMode: {
    type: String,
    default: 'report',
  },
  selectedQaSession: {
    type: Object,
    default: null,
  },
  qaSessions: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits([
  'list',
  'delete-report',
  'new-report',
  'retry-history-report',
  'show-active-workspace',
  'toggle-log-drawer',
  'update:title',
  'update:reportType',
  'update:contextText',
  'update:parameterValues',
  'update:activeParameters',
  'update:planSourceInput',
  'update:planSupplement',
  'update:databaseSourceEnabled',
  'update:useMyPreferences',
  'update:deepReportEnabled',
  'update:homeMode',
  'qa-session-upsert',
  'qa-session-clear-selection',
  'generate',
  'confirm-plan',
  'cancel-plan',
  'toggle-plan-option',
  'add-plan-option',
  'toggle-plan-search-query',
  'next-plan-step',
  'prev-plan-step',
  'open-daily-awareness',
])
const reportRef = ref(null)
const drawerLogListRef = ref(null)
const liveLogListRef = ref(null)
const contextTextRef = ref(null)
const titleInputRef = ref(null)
const qaInputRef = ref(null)
const qaThreadRef = ref(null)
const technicalLogCollapsedIds = ref(new Set())
const dbSourcesExpanded = ref(false)
const expandedSourceId = ref('')
const sourceListRef = ref(null)
const reportEditOpen = ref(false)
const reportEditLoading = ref(false)
const reportEditHistoryLoading = ref(false)
const reportEditError = ref('')
const reportEditNotice = ref('')
const reportEditResult = ref(null)
const reportEditHistory = ref([])
const reportEditForm = ref({
  targetType: 'selected_text',
  targetPath: '',
  originalText: '',
  editMode: 'polish',
  instruction: '',
})
const qualityReview = ref(null)
const qualityReviewLoading = ref(false)
const qualityReviewRunning = ref(false)
const qualityReviewError = ref('')
const qualityReviewNotice = ref('')
const activeSourceType = ref('all')
const sourceSearchQuery = ref('')
const sourceKindFilter = ref('全部')
const sourceTimeFilter = ref('all')
const sourceSortMode = ref('relevance')
const sourceListLoading = ref(false)
const sourceListError = ref('')
const sourceListItems = ref([])
const sourceListPage = ref(1)
const sourceListPageSize = ref(10)
const sourceListTotal = ref(null)
const sourceListHasMore = ref(false)
const sourceListSummary = ref(null)
const sourceListDiagnostics = ref(null)
const sourceCurrentPage = ref(1)
const expandedSourceListId = ref('')
const sourceListNotice = ref('')
const acceptedCitationSources = ref([])
const acceptedCitationSourcesLoading = ref(false)
const activeResultTab = ref('report')
const homeMode = computed({
  get: () => props.homeMode || 'report',
  set: (value) => emit('update:homeMode', value === 'qa' ? 'qa' : 'report'),
})
const qaQuestion = ref('')
const currentQaSessionId = ref('')
const qaSessionCreatedAt = ref('')
const qaCurrentQuestion = ref('')
const qaQuestionTime = ref('')
const qaAnswer = ref('')
const qaTurns = ref([])
const qaMessages = ref([])
const activeQaTurnId = ref('')
const qaStatus = ref('idle')
const qaError = ref('')
const qaGuideOpen = ref(false)
const qaReferencePayloads = ref([])
const qaSourceSearch = ref('')
const qaSourceTypeFilter = ref('all')
const qaSourceExpandedIds = ref(new Set())
const qaSourcePage = ref(1)
const qaSourceSidebarOpen = ref(false)
const qaSourceSidebarDismissed = ref(false)
const qaImportNotice = ref('')
const qaImportPickerOpen = ref(false)
const qaImportExpandedSessionIds = ref(new Set())
const selectedQaImportSessions = ref(new Set())
const selectedQaImportTurns = ref(new Set())
const qaValidationError = ref('')
const qaCopyNotice = ref('')
const qaRecommendedBatch = ref(0)
const qaThreadShouldStick = ref(true)
const qaThreadHasNewContent = ref(false)
const titleValidationError = ref('')
const liveLogShouldStick = ref(true)
const drawerLogShouldStick = ref(true)
const liveLogHasNewItems = ref(false)
const drawerLogHasNewItems = ref(false)
const manualSourceDraft = ref('')
const manualDirectionDraft = ref('')
let qaEventSource = null
let qaStreamRecoveryTimer = null
let sourceListRequestId = 0
let resultTabWheelLockedUntil = 0
const qaStreamStates = new Map()

const canExport = computed(() => props.phase === 'done' && Boolean(props.generatedHtml))
const isLiveLogVisible = computed(() => props.phase === 'loading')
const canOpenLogDrawer = computed(() => !isLiveLogVisible.value)
const isHistoryDetailLoading = computed(() => props.detailLoading || props.phase === 'history-loading')
const isHistoryDetailError = computed(() => props.phase === 'history-error' || Boolean(props.detailLoadError))
const showLogDrawer = computed(() => props.isLogDrawerOpen && canOpenLogDrawer.value && !isHistoryDetailLoading.value && !isHistoryDetailError.value)
const showNewReportButton = computed(() => props.isHistoryMode || props.phase === 'done' || props.phase === 'error')
const effectiveReportType = computed(() => props.reportType || 'write-hb-k')
const canSubmitPlanning = computed(() => Boolean(props.title?.trim()) && Boolean(effectiveReportType.value) && !props.isGenerating && !props.isPlanning)
const titleLength = computed(() => props.title?.length || 0)
const currentPlanStep = computed(() => props.reportPlan?.steps?.[props.planStepIndex] || null)
const isLastPlanStep = computed(() => props.planStepIndex >= ((props.reportPlan?.steps?.length || 1) - 1))
const isSourcePlanStep = computed(() => currentPlanStep.value?.type === 'source_scope')
const verifiedPlanSourceOptions = computed(() => (currentPlanStep.value?.options || []).filter((option) => option.sourceGroup === 'verified' || option.id === 'database-source'))
const networkPlanSourceOptions = computed(() => (currentPlanStep.value?.options || []).filter((option) => option.sourceGroup !== 'verified' && option.id !== 'database-source'))
const isSupplementPlanStep = computed(() => currentPlanStep.value?.type === 'supplement')
const manualPlanSources = computed(() => parseManualPlanSources(props.planSourceInput))
const reportTypeLabel = computed(() => {
  if (effectiveReportType.value === 'person-intelligence-report') return '人物报'
  if (effectiveReportType.value === 'risk-assessment-reports') return '风险报'
  if (effectiveReportType.value === 'write-hb-k') return 'K报'
  if (effectiveReportType.value === 'write-hb-hb') return 'HB报'
  return props.job?.skill || '报告'
})
const taskStatusType = computed(() => {
  const status = props.job?.status
  if (status === 'succeeded' || props.phase === 'done') return 'success'
  if (status === 'failed' || status === 'cancelled' || status === 'waiting_approval' || props.phase === 'error') return 'failed'
  return 'running'
})
const taskStatusLabel = computed(() => {
  if (taskStatusType.value === 'success') return '成功'
  if (taskStatusType.value === 'failed') return '失败'
  return '生成中'
})
const taskStatusClass = computed(() => {
  if (taskStatusType.value === 'success') return 'text-neon-green'
  if (taskStatusType.value === 'failed') return 'text-red-300'
  return 'text-cyber-yellow'
})
const sanitizedHtml = computed(() => DOMPurify.sanitize(props.generatedHtml || '', purifyConfig))

const reportEditModes = [
  { value: 'polish', label: '润色' },
  { value: 'expand', label: '扩写' },
  { value: 'shorten', label: '缩写' },
  { value: 'clarify_facts', label: '强化事实描述' },
  { value: 'add_sources', label: '补充各方态度' },
  { value: 'strengthen_risk', label: '强化涉我风险' },
  { value: 'custom', label: '自定义' },
]

function selectedReportText() {
  try {
    const selection = window.getSelection?.()
    return String(selection?.toString() || '').trim()
  } catch {
    return ''
  }
}

async function openReportEditPanel() {
  reportEditError.value = ''
  reportEditNotice.value = ''
  reportEditResult.value = null
  reportEditForm.value = {
    targetType: 'selected_text',
    targetPath: '',
    originalText: selectedReportText(),
    editMode: 'polish',
    instruction: '',
  }
  reportEditOpen.value = true
  await loadReportEditHistory()
}

async function openReportEditFromQualityIssue(issue) {
  const targetText = String(issue?.targetText || issue?.evidence || '').trim()
  const suggestion = String(issue?.suggestion || issue?.problem || '').trim()
  activeResultTab.value = 'report'
  reportEditError.value = ''
  reportEditNotice.value = '已从成稿自检问题带入局部修改。'
  reportEditResult.value = null
  reportEditForm.value = {
    targetType: 'selected_text',
    targetPath: issue?.section ? `quality-review:${issue.section}` : 'quality-review',
    originalText: targetText,
    editMode: /来源|媒体|时间|主体|态度/.test(suggestion) ? 'add_sources' : 'polish',
    instruction: suggestion || '请根据成稿自检建议进行局部修改，补充依据并保持表述审慎。',
  }
  reportEditOpen.value = true
  await loadReportEditHistory()
}

async function loadReportEditHistory() {
  if (!props.job?.jobId) return
  reportEditHistoryLoading.value = true
  try {
    const result = await getReportEdits(props.job.jobId)
    reportEditHistory.value = Array.isArray(result?.items) ? result.items : []
  } catch (error) {
    reportEditError.value = error instanceof Error ? error.message : String(error)
  } finally {
    reportEditHistoryLoading.value = false
  }
}

async function submitReportEdit() {
  if (!props.job?.jobId || reportEditLoading.value) return
  reportEditError.value = ''
  reportEditNotice.value = ''
  reportEditResult.value = null
  reportEditLoading.value = true
  try {
    const result = await createReportEdit(props.job.jobId, {
      ...reportEditForm.value,
      targetType: reportEditForm.value.targetType || 'selected_text',
    })
    reportEditResult.value = result
    reportEditNotice.value = '局部修改已生成，原报告未被覆盖。'
    await loadReportEditHistory()
  } catch (error) {
    reportEditError.value = error instanceof Error ? error.message : String(error)
  } finally {
    reportEditLoading.value = false
  }
}

async function copyReportEditResult(text) {
  try {
    await navigator.clipboard.writeText(String(text || ''))
    reportEditNotice.value = '修改结果已复制。'
  } catch {
    reportEditError.value = '复制失败，请手动选择文本复制。'
  }
}

async function loadQualityReview() {
  if (!props.job?.jobId) return
  qualityReviewLoading.value = true
  qualityReviewError.value = ''
  try {
    qualityReview.value = await getReportQualityReview(props.job.jobId)
  } catch (error) {
    qualityReviewError.value = error instanceof Error ? error.message : String(error)
  } finally {
    qualityReviewLoading.value = false
  }
}

async function rerunQualityReview() {
  if (!props.job?.jobId || qualityReviewRunning.value) return
  qualityReviewRunning.value = true
  qualityReviewError.value = ''
  qualityReviewNotice.value = ''
  try {
    qualityReview.value = await runReportQualityReview(props.job.jobId)
    qualityReviewNotice.value = qualityReview.value?.status === 'failed' ? '成稿自检失败，可稍后重试。' : '成稿自检已更新。'
  } catch (error) {
    qualityReviewError.value = error instanceof Error ? error.message : String(error)
  } finally {
    qualityReviewRunning.value = false
  }
}

function qualityScoreLabel(value) {
  if (value === null || value === undefined || value === '') return '--'
  const score = Number(value)
  return Number.isFinite(score) ? `${Math.round(score)}` : '--'
}

function qualityStatusLabel(status) {
  if (status === 'pass') return '通过'
  if (status === 'fail') return '需处理'
  if (status === 'warning') return '提醒'
  return status || '待检查'
}

const qualityDimensionCards = computed(() => {
  const scores = qualityReview.value?.scores || {}
  return [
    ['事件描述', scores.factualClarity],
    ['规划一致', scores.planAlignment],
    ['信源质量', scores.sourceQuality],
    ['态度可追溯', scores.attitudeTraceability],
    ['风险依据', scores.riskReasoning],
    ['写作质量', scores.writingQuality],
  ].map(([label, score]) => ({ label, score }))
})

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeMarkdownStrongMarkers(markdown) {
  const lines = String(markdown || '').split(/\r?\n/)
  let inFence = false

  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence || !line.includes('**')) return line

      const inlineCode = []
      const masked = line.replace(/(`+)([^`]*?)\1/g, (match) => {
        inlineCode.push(match)
        return `\u0000CODE${inlineCode.length - 1}\u0000`
      })
      const normalized = masked.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      return normalized.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => inlineCode[Number(index)] || '')
    })
    .join('\n')
}

function renderInlineMarkdown(value) {
  const codeSegments = []
  const masked = String(value || '').replace(/(`+)([^`]*?)\1/g, (_match, _ticks, code) => {
    codeSegments.push(`<code>${escapeHtml(code)}</code>`)
    return `\u0000CODE${codeSegments.length - 1}\u0000`
  })

  return escapeHtml(masked)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/&lt;strong&gt;([\s\S]*?)&lt;\/strong&gt;/g, '<strong>$1</strong>')
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => codeSegments[Number(index)] || '')
}

function renderMarkdownHtml(markdown) {
  const normalized = normalizeMarkdownStrongMarkers(markdown)
  const lines = normalized.split(/\r?\n/)
  const html = []
  let paragraph = []
  let listType = ''
  let inFence = false
  let fenceLines = []

  function closeParagraph() {
    if (!paragraph.length) return
    html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  function closeList() {
    if (!listType) return
    html.push(`</${listType}>`)
    listType = ''
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        html.push(`<pre><code>${escapeHtml(fenceLines.join('\n'))}</code></pre>`)
        fenceLines = []
        inFence = false
      } else {
        closeParagraph()
        closeList()
        inFence = true
      }
      continue
    }
    if (inFence) {
      fenceLines.push(line)
      continue
    }

    if (!line.trim()) {
      closeParagraph()
      closeList()
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      closeParagraph()
      closeList()
      const level = Math.min(heading[1].length, 6)
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    const quote = line.match(/^>\s?(.+)$/)
    if (quote) {
      closeParagraph()
      closeList()
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`)
      continue
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    if (ordered || unordered) {
      closeParagraph()
      const nextType = ordered ? 'ol' : 'ul'
      if (listType && listType !== nextType) closeList()
      if (!listType) {
        listType = nextType
        html.push(`<${listType}>`)
      }
      html.push(`<li>${renderInlineMarkdown((ordered || unordered)[1])}</li>`)
      continue
    }

    closeList()
    paragraph.push(line.trim())
  }

  closeParagraph()
  closeList()
  if (inFence) html.push(`<pre><code>${escapeHtml(fenceLines.join('\n'))}</code></pre>`)

  return DOMPurify.sanitize(html.join('\n'), purifyConfig)
}

function qaAnswerHtml(answer) {
  return renderMarkdownHtml(answer)
}
const resultTabs = [
  { key: 'report', label: '报告正文' },
  { key: 'sources', label: '信源概览' },
  { key: 'planning', label: '规划选择' },
  { key: 'citations', label: '引用依据' },
  { key: 'progress', label: '任务进度' },
  { key: 'quality', label: '成稿自检' },
]

function parseStructuredPlanningContext(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  const text = String(value || '').trim()
  if (!text) return null
  const candidates = [text]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed?.kind === 'structured_report_context' || parsed?.selectedModules || parsed?.selectedSearchQueries) return parsed
    } catch {
      // Ignore non-JSON legacy context.
    }
  }
  return null
}

const planningContext = computed(() => {
  const payload = props.job?.payload || {}
  const candidates = [
    payload.known_context,
    payload.visit_context,
    payload.context,
    payload.research_context,
    payload.planningContext,
    props.job?.planningContext,
  ]
  for (const candidate of candidates) {
    const parsed = parseStructuredPlanningContext(candidate)
    if (parsed) return parsed
  }
  return null
})

function normalizePlanningItems(items) {
  return Array.isArray(items)
    ? items
      .map((item) => {
        if (typeof item === 'string') return { id: item, label: item, detail: '' }
        return {
          id: item?.id || item?.label || item?.title || '',
          label: item?.label || item?.title || item?.name || item?.id || '',
          detail: item?.detail || item?.description || item?.summary || '',
        }
      })
      .filter((item) => item.label)
    : []
}

function databaseSourceEnabledInContext(context) {
  const options = context?.databaseSourceOptions || context?.vectorDatabaseSourceOptions
  if (!options || typeof options !== 'object') return false
  return options.enabled === true || String(options.enabled || '').toLowerCase() === 'true'
}

function planningDatabaseSourceItem(context) {
  if (!databaseSourceEnabledInContext(context)) return null
  const options = context?.databaseSourceOptions || {}
  const sourceTable = options.sourceTable ? `来源表：${options.sourceTable}` : ''
  const mode = options.mode ? `召回模式：${options.mode}` : ''
  const data = props.databaseSources || {}
  const actualRows = firstPositiveCount(
    Array.isArray(data.sources) ? data.sources.length : null,
    data.queryPlan?.returnedSources,
    data.vectorPlan?.returnedSources,
    data.totalHits,
  )
  const rows = actualRows ? `已召回：${actualRows} 条` : options.maxMetadataRows ? `预计最多：${options.maxMetadataRows} 条` : ''
  const detail = [sourceTable, mode, rows].filter(Boolean).join('；')
  return {
    id: 'database-source',
    label: 'PG 数据库信源',
    detail: detail || '已选择 PG 向量数据库召回，提交后优先进行数据库信源检索。',
    sourceGroup: 'verified',
    status: 'available',
  }
}

function planningSourceScopes(context) {
  const sources = normalizePlanningItems(context?.selectedSources)
  const hasDatabaseSource = sources.some((source) => source.id === 'database-source')
  const visibleSources = databaseSourceEnabledInContext(context)
    ? sources
    : sources.filter((source) => source.id !== 'database-source')
  const databaseSource = planningDatabaseSourceItem(context)
  if (databaseSource && !hasDatabaseSource) return [databaseSource, ...visibleSources]
  return visibleSources
}

const planningSelectionView = computed(() => {
  const context = planningContext.value
  if (!context) {
    return {
      available: false,
      searchQueries: [],
      sourceScopes: [],
      modules: [],
      manualSources: [],
      parameterEntries: [],
      supplement: '',
      freeTextContext: '',
      totalDirections: 0,
    }
  }
  const modules = Array.isArray(context.selectedModules)
    ? context.selectedModules.map((module, index) => {
      const directions = normalizePlanningItems(module.selectedDirections || module.options)
      return {
        id: module.stepId || module.sectionKey || `module-${index}`,
        title: module.sectionTitle || module.title || module.sectionKey || `规划模块 ${index + 1}`,
        type: planStepTypeLabel(module.stepType),
        directions,
      }
    })
    : []
  const parameterEntries = Object.entries(context.parameterValues || {})
    .filter(([, value]) => String(value || '').trim())
    .map(([key, value]) => ({ key, value: String(value) }))
  return {
    available: true,
    searchQueries: Array.isArray(context.selectedSearchQueries) ? context.selectedSearchQueries.filter(Boolean) : [],
    sourceScopes: planningSourceScopes(context),
    modules,
    manualSources: Array.isArray(context.userProvidedSources) ? context.userProvidedSources.filter(Boolean) : [],
    parameterEntries,
    supplement: String(context.supplement || '').trim(),
    freeTextContext: String(context.freeTextContext || '').trim(),
    totalDirections: modules.reduce((sum, module) => sum + module.directions.length, 0),
  }
})
const reportTypeOptions = [
  {
    value: 'write-hb-k',
    label: 'K报编写',
    icon: '▤',
    desc: '围绕特定主题，生成结构化、全面、深度的 K 报。',
    params: ['关注方向', '时间范围', '地区 / 对象', '标签'],
    placeholder: '请输入需要编写的报告标题，例如：2026年东南亚区域安全态势研判',
  },
]
const selectedReportType = computed(() => reportTypeOptions.find((item) => item.value === effectiveReportType.value) || reportTypeOptions[0])
const activeSelectedParameters = computed(() => {
  const params = selectedReportType.value?.params || []
  return props.activeParameters.filter((param) => params.includes(param))
})
const enabledReportTypes = new Set(['write-hb-k'])

const singleLineParameters = new Set(['时间范围', '地区 / 对象', '国家 / 地区', '当前职务', '材料范围', '标签'])

const focusDirectionOptions = [
  '政策法规',
  '产业链安全',
  '国际关系',
  '市场与行业',
  '舆情与传播',
  '科技与标准',
  '供应链风险',
  '对策建议',
]

const recommendedQuestions = [
  '近期中美贸易摩擦主要体现在哪些方面？',
  '美国对华关税政策最新变化是什么？',
  '欧盟贸易限制措施对我国产业链有何影响？',
  '当前全球供应链风险有哪些？',
  '中美科技竞争的最新态势如何？',
  '我国重点产业链面临哪些外部限制风险？',
  '近期国际能源市场变化会带来哪些影响？',
  '人工智能产业监管趋势有哪些值得关注？',
  '周边安全形势对经贸合作有什么影响？',
  '跨境数据流动政策有哪些最新变化？',
]

const QA_SYSTEM_MESSAGE = {
  role: 'system',
  content: '你是知识问答助手。请优先围绕知识库和数据库信源进行检索、归纳和交叉核验，用中文直接回答用户问题。不要在回答中提及底层系统、工具调用、网关、SSE、命令或技术日志。',
}

const isQaRunning = computed(() => ['searching', 'integrating', 'streaming'].includes(qaStatus.value))
const visibleRecommendedQuestions = computed(() => {
  const batchSize = 5
  const start = (qaRecommendedBatch.value * batchSize) % recommendedQuestions.length
  return [...recommendedQuestions, ...recommendedQuestions].slice(start, start + batchSize)
})
const canSendQa = computed(() => Boolean(qaQuestion.value.trim()) && !isQaRunning.value)
const qaStepItems = computed(() => [
  { key: 'searching', label: '检索中', done: ['integrating', 'streaming', 'done'].includes(qaStatus.value), active: qaStatus.value === 'searching' },
  { key: 'integrating', label: '整合中', done: ['streaming', 'done'].includes(qaStatus.value), active: qaStatus.value === 'integrating' },
  { key: 'streaming', label: '输出中', done: qaStatus.value === 'done', active: qaStatus.value === 'streaming' },
])
const qaStatusTitle = computed(() => {
  if (qaStatus.value === 'failed') return '回答生成失败'
  if (qaStatus.value === 'done') return '回答已完成'
  if (isQaRunning.value) return '生成中'
  return '等待提问'
})
const qaStatusDescription = computed(() => {
  if (qaStatus.value === 'failed') return qaError.value || '回答生成失败，请稍后重试。'
  if (qaStatus.value === 'done') return '回答已完成。'
  if (isQaRunning.value) return '正在检索数据库并整合相关信息。'
  return '请输入问题后，系统将检索数据库并生成回答。'
})
const qaReferenceItems = computed(() => {
  const seen = new Set()
  return qaReferencePayloads.value
    .map((item, index) => normalizeSourceListItem(item, index, 'structured_sources'))
    .filter((item) => {
      const key = item.url || `${item.title}-${item.sourceName}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 40)
})

const qaSourceTypeOptions = computed(() => {
  const types = new Set()
  for (const item of qaReferenceItems.value) {
    if (item.sourceType) types.add(item.sourceType)
  }
  return Array.from(types)
})

const filteredQaReferenceItems = computed(() => {
  const keyword = qaSourceSearch.value.trim().toLowerCase()
  return qaReferenceItems.value.filter((item) => {
    const typeMatched = qaSourceTypeFilter.value === 'all' || item.sourceType === qaSourceTypeFilter.value
    if (!typeMatched) return false
    if (!keyword) return true
    const haystack = [
      item.title,
      item.sourceName,
      item.sourceType,
      item.summary,
      item.detail,
      item.url,
    ].join(' ').toLowerCase()
    return haystack.includes(keyword)
  })
})

const qaSourcePageSize = 10
const pagedQaReferenceItems = computed(() => filteredQaReferenceItems.value.slice(0, qaSourcePage.value * qaSourcePageSize))
const qaSourceHasMore = computed(() => pagedQaReferenceItems.value.length < filteredQaReferenceItems.value.length)
const canShowQaSourceSidebar = computed(() => {
  return homeMode.value === 'qa' && (qaReferenceItems.value.length > 0 || isQaRunning.value || qaStatus.value === 'done')
})

const qaImportSessions = computed(() => {
  return [...(props.qaSessions || [])]
    .map((session) => ({
      ...session,
      importTurns: importableQaTurns(session),
    }))
    .filter((session) => session.importTurns.length > 0)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
})

const selectedQaImportTurnsView = computed(() => {
  const selected = new Map()
  for (const session of qaImportSessions.value) {
    const sessionSelected = selectedQaImportSessions.value.has(session.id)
    for (const turn of session.importTurns) {
      const key = qaImportTurnKey(session.id, turn.id)
      if (sessionSelected || selectedQaImportTurns.value.has(key)) {
        selected.set(key, { session, turn, key })
      }
    }
  }
  return Array.from(selected.values())
})

const selectedQaImportSessionCount = computed(() => {
  return new Set(selectedQaImportTurnsView.value.map((item) => item.session.id)).size
})

const selectedQaImportTurnCount = computed(() => selectedQaImportTurnsView.value.length)
const hasQaImportSelection = computed(() => selectedQaImportTurnCount.value > 0)

const qaSensitiveTermReplacements = [
  [/Hermes/gi, '自主智能体'],
  [/\bAgent\b/gi, '处理服务'],
  [/\bGateway\b/gi, '连接服务'],
  [/\bMCP\b/gi, '检索服务'],
  [/\bSQL\b/gi, '查询语句'],
  [/\bSSE\b/gi, '连接通道'],
  [/tool_call/gi, '工具调用'],
  [/\bcommand\b/gi, '命令'],
  [/REPORT_FILE/gi, '报告文件'],
]

function selectReportType(value) {
  if (!enabledReportTypes.has(value)) return
  emit('update:reportType', value)
}

function isReportTypeDisabled(value) {
  return !enabledReportTypes.has(value)
}

function isParameterActive(param) {
  return props.activeParameters.includes(param)
}

function parameterInputType(param) {
  return singleLineParameters.has(param) ? 'input' : 'textarea'
}

function parameterPlaceholder(param) {
  const hints = {
    '关注方向': '请选择需要重点覆盖的研判方向。',
    '时间范围': '例如：2026年5月、近三个月、2025年至今。',
    '地区 / 对象': '例如：欧盟、东南亚、某城市、某机构或重点企业。',
    '标签': '例如：贸易、制裁、产业链、科技、地区安全。',
    '已知上下文': '粘贴已有材料、口径、线索、数据或需要引用的上下文。',
    '材料范围': '说明需要汇编的材料类型、来源范围或时间跨度。',
    '风险场景': '描述需要评估的场景、触发条件或潜在事件。',
    '研判方向': '说明风险识别、趋势判断、影响评估或处置建议方向。',
    '人物背景': '补充人物履历、派系关系、公开立场或关键经历。',
    '国家 / 地区': '填写人物所属国家、地区或主要活动范围。',
    '当前职务': '填写人物当前职位、组织身份或实际角色。',
    '来访场景': '说明访问背景、议题、接待对象或敏感点。',
  }
  return hints[param] || `填写${param}相关信息。`
}

function toggleParameter(param) {
  const next = isParameterActive(param)
    ? props.activeParameters.filter((item) => item !== param)
    : [...props.activeParameters, param]
  emit('update:activeParameters', next)
  nextTick(() => {
    if (contextTextRef.value && !isParameterActive(param)) contextTextRef.value.focus()
  })
}

function updateParameterValue(param, value) {
  if (titleValidationError.value) titleValidationError.value = ''
  emit('update:parameterValues', {
    ...props.parameterValues,
    [param]: value,
  })
}

function updateTitle(value) {
  if (titleValidationError.value) titleValidationError.value = ''
  emit('update:title', value)
}

function submitReport() {
  if (props.isGenerating || props.isPlanning) return
  if (!props.title?.trim()) {
    titleValidationError.value = '请先输入需要编报的主题。'
    return
  }
  titleValidationError.value = ''
  if (!props.reportType) emit('update:reportType', effectiveReportType.value)
  if (canSubmitPlanning.value) emit('generate')
}

function ensureReportDefaults() {
  if (props.reportType !== 'write-hb-k') emit('update:reportType', 'write-hb-k')
  const defaults = ['关注方向', '时间范围', '地区 / 对象', '标签']
  const current = new Set(props.activeParameters || [])
  let changed = false
  for (const item of defaults) {
    if (!current.has(item)) {
      current.add(item)
      changed = true
    }
  }
  if (changed) emit('update:activeParameters', Array.from(current))
}

function selectedFocusDirections() {
  return String(props.parameterValues?.['关注方向'] || '')
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isFocusDirectionSelected(direction) {
  return selectedFocusDirections().includes(direction)
}

function toggleFocusDirection(direction) {
  const current = new Set(selectedFocusDirections())
  if (current.has(direction)) current.delete(direction)
  else current.add(direction)
  updateParameterValue('关注方向', Array.from(current).join('、'))
}

function selectHomeMode(mode) {
  if (mode === 'daily') {
    emit('open-daily-awareness')
    return
  }
  homeMode.value = mode
  qaImportNotice.value = ''
  qaValidationError.value = ''
  if (mode === 'report') ensureReportDefaults()
  scrollToTop()
  nextTick(() => {
    if (mode === 'qa') qaInputRef.value?.focus({ preventScroll: true })
    if (mode === 'report') titleInputRef.value?.focus({ preventScroll: true })
  })
}

function qaSessionSnapshot(status = qaStatus.value) {
  const id = currentQaSessionId.value
  if (!id || !qaCurrentQuestion.value) return null
  return {
    id,
    sessionId: id,
    question: qaCurrentQuestion.value,
    answer: qaAnswer.value,
    messages: qaMessages.value,
    turns: qaTurns.value,
    activeTurnId: activeQaTurnId.value,
    sourcesCount: qaReferenceItems.value.length,
    status,
    createdAt: qaSessionCreatedAt.value || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    referencePayloads: qaReferencePayloads.value,
  }
}

function emitQaSession(status = qaStatus.value) {
  const session = qaSessionSnapshot(status)
  if (session) emit('qa-session-upsert', session)
}

function emitStoredQaSession(session, select = false) {
  if (!session?.id) return
  emit('qa-session-upsert', {
    ...session,
    select,
    updatedAt: new Date().toISOString(),
  })
}

function qaStreamState(sessionId) {
  if (!sessionId) return null
  if (!qaStreamStates.has(sessionId)) {
    qaStreamStates.set(sessionId, {
      source: null,
      recoveryTimer: null,
      session: null,
    })
  }
  return qaStreamStates.get(sessionId)
}

function rememberCurrentQaStreamSession(status = qaStatus.value) {
  const session = qaSessionSnapshot(status)
  const state = qaStreamState(session?.id)
  if (state && session) state.session = session
  return session
}

function updateStoredQaTurn(session, patch) {
  if (!session) return session
  const turns = Array.isArray(session.turns) ? [...session.turns] : []
  if (!turns.length) return { ...session, ...patch }
  const activeId = session.activeTurnId || turns[turns.length - 1]?.id
  const nextTurns = turns.map((turn, index) => (
    turn.id === activeId || (!activeId && index === turns.length - 1)
      ? { ...turn, ...patch }
      : turn
  ))
  const last = nextTurns[nextTurns.length - 1] || null
  return {
    ...session,
    turns: nextTurns,
    question: last?.question || session.question,
    answer: last?.answer || session.answer || '',
  }
}

function normalizeQaMessages(session) {
  if (Array.isArray(session?.messages) && session.messages.length) {
    const sanitized = session.messages
      .filter((item) => ['system', 'user', 'assistant'].includes(item?.role) && String(item?.content || '').trim())
      .map((item) => ({ role: item.role, content: String(item.content).trim() }))
    return sanitized.some((item) => item.role === 'system') ? sanitized : [QA_SYSTEM_MESSAGE, ...sanitized]
  }
  const messages = [QA_SYSTEM_MESSAGE]
  if (session?.question) messages.push({ role: 'user', content: String(session.question) })
  if (session?.answer) messages.push({ role: 'assistant', content: String(session.answer) })
  return messages
}

function normalizeQaTurns(session) {
  if (Array.isArray(session?.turns) && session.turns.length) {
    return session.turns.map((turn, index) => ({
      id: turn.id || `turn-${index}`,
      question: turn.question || session.question || '',
      answer: turn.answer || '',
      createdAt: turn.createdAt || session.createdAt || new Date().toISOString(),
      status: turn.status || session.status || (turn.answer ? 'done' : 'idle'),
    }))
  }
  if (!session?.question && !session?.answer) return []
  return [{
    id: `${session?.id || 'qa'}-turn-0`,
    question: session.question || '',
    answer: session.answer || '',
    createdAt: session.createdAt || new Date().toISOString(),
    status: session.status || (session.answer ? 'done' : 'idle'),
  }]
}

function qaImportTurnKey(sessionId, turnId) {
  return `${sessionId}:${turnId}`
}

function isQaImportTurnSelectable(turn) {
  if (!String(turn?.answer || '').trim()) return false
  return !['searching', 'integrating', 'streaming'].includes(turn.status)
}

function importableQaTurns(session) {
  return normalizeQaTurns(session)
    .filter(isQaImportTurnSelectable)
    .map((turn, index) => ({
      ...turn,
      id: turn.id || `${session?.id || 'qa'}-turn-${index}`,
    }))
}

function isQaImportSessionExpanded(sessionId) {
  return qaImportExpandedSessionIds.value.has(sessionId)
}

function toggleQaImportSessionExpanded(sessionId) {
  const next = new Set(qaImportExpandedSessionIds.value)
  if (next.has(sessionId)) next.delete(sessionId)
  else next.add(sessionId)
  qaImportExpandedSessionIds.value = next
}

function isQaImportSessionSelected(session) {
  if (!session?.importTurns?.length) return false
  if (selectedQaImportSessions.value.has(session.id)) return true
  return session.importTurns.every((turn) => selectedQaImportTurns.value.has(qaImportTurnKey(session.id, turn.id)))
}

function isQaImportTurnSelected(sessionId, turnId) {
  return selectedQaImportSessions.value.has(sessionId) || selectedQaImportTurns.value.has(qaImportTurnKey(sessionId, turnId))
}

function toggleQaImportSession(session) {
  if (!session?.id || !session.importTurns?.length) return
  const nextSessions = new Set(selectedQaImportSessions.value)
  const nextTurns = new Set(selectedQaImportTurns.value)
  if (isQaImportSessionSelected(session)) {
    nextSessions.delete(session.id)
    for (const turn of session.importTurns) nextTurns.delete(qaImportTurnKey(session.id, turn.id))
  } else {
    nextSessions.add(session.id)
    for (const turn of session.importTurns) nextTurns.delete(qaImportTurnKey(session.id, turn.id))
  }
  selectedQaImportSessions.value = nextSessions
  selectedQaImportTurns.value = nextTurns
}

function toggleQaImportTurn(session, turn) {
  if (!session?.id || !turn?.id || !isQaImportTurnSelectable(turn)) return
  const key = qaImportTurnKey(session.id, turn.id)
  const nextSessions = new Set(selectedQaImportSessions.value)
  const nextTurns = new Set(selectedQaImportTurns.value)
  if (nextSessions.has(session.id)) {
    nextSessions.delete(session.id)
    for (const item of session.importTurns || []) {
      const itemKey = qaImportTurnKey(session.id, item.id)
      if (itemKey !== key) nextTurns.add(itemKey)
    }
    nextTurns.delete(key)
  } else if (nextTurns.has(key)) {
    nextTurns.delete(key)
  } else {
    nextTurns.add(key)
  }
  selectedQaImportSessions.value = nextSessions
  selectedQaImportTurns.value = nextTurns
}

function clearQaImportSelection() {
  selectedQaImportSessions.value = new Set()
  selectedQaImportTurns.value = new Set()
}

function addCurrentQaTurnToImportSelection() {
  const sessionId = currentQaSessionId.value
  const turnId = activeQaTurnId.value
  if (!sessionId || !turnId || !qaAnswer.value.trim()) return
  const next = new Set(selectedQaImportTurns.value)
  next.add(qaImportTurnKey(sessionId, turnId))
  selectedQaImportTurns.value = next
  qaImportPickerOpen.value = true
  qaImportNotice.value = '已加入编报背景选择'
}

function syncCurrentQaFromTurns() {
  const last = qaTurns.value[qaTurns.value.length - 1] || null
  activeQaTurnId.value = last?.id || ''
  qaCurrentQuestion.value = last?.question || ''
  qaQuestionTime.value = last?.createdAt
    ? new Date(last.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : ''
  qaAnswer.value = last?.answer || ''
}

function updateActiveQaTurn(patch) {
  if (!activeQaTurnId.value) return
  qaTurns.value = qaTurns.value.map((turn) => (
    turn.id === activeQaTurnId.value ? { ...turn, ...patch } : turn
  ))
  syncCurrentQaFromTurns()
}

function appendQaAssistantMessage() {
  const answer = qaAnswer.value.trim()
  if (!answer) return
  const last = qaMessages.value[qaMessages.value.length - 1]
  if (last?.role === 'assistant' && last.content === answer) return
  qaMessages.value = [...qaMessages.value, { role: 'assistant', content: answer }]
}

function resetQaSourceView() {
  qaSourceSearch.value = ''
  qaSourceTypeFilter.value = 'all'
  qaSourceExpandedIds.value = new Set()
  qaSourcePage.value = 1
}

function openQaSourceSidebar() {
  qaSourceSidebarOpen.value = true
  qaSourceSidebarDismissed.value = false
}

function closeQaSourceSidebar() {
  qaSourceSidebarOpen.value = false
  qaSourceSidebarDismissed.value = true
}

function toggleQaSourceExpanded(id) {
  const next = new Set(qaSourceExpandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  qaSourceExpandedIds.value = next
}

function isQaSourceExpanded(id) {
  return qaSourceExpandedIds.value.has(id)
}

function qaSourceField(value, fallback = '--') {
  return value === undefined || value === null || String(value).trim() === '' ? fallback : value
}

function restoreQaSession(session) {
  if (!session?.id) return
  const sessionId = session.sessionId || session.id
  const liveSession = qaStreamStates.get(sessionId)?.session
  const restored = liveSession || session
  currentQaSessionId.value = sessionId
  qaSessionCreatedAt.value = restored.createdAt || new Date().toISOString()
  qaMessages.value = normalizeQaMessages(restored)
  qaTurns.value = normalizeQaTurns(restored)
  syncCurrentQaFromTurns()
  qaStatus.value = restored.status || (restored.answer ? 'done' : 'idle')
  qaError.value = restored.status === 'failed' ? '回答生成失败，请稍后重试。' : ''
  qaReferencePayloads.value = Array.isArray(restored.referencePayloads) ? restored.referencePayloads : []
  qaSourceSidebarDismissed.value = qaReferencePayloads.value.length > 0
  qaSourceSidebarOpen.value = false
  resetQaSourceView()
  qaCopyNotice.value = ''
  qaValidationError.value = ''
  qaThreadShouldStick.value = true
  qaThreadHasNewContent.value = false
  nextTick(() => {
    scrollQaThreadToBottom()
    resizeQaInput()
    qaInputRef.value?.focus()
  })
  loadQaSessionSources(currentQaSessionId.value)
}

async function loadQaSessionSources(sessionId) {
  if (!sessionId) return
  try {
    const result = await fetchQaSessionSources(sessionId)
    const sources = Array.isArray(result?.sources) ? result.sources : []
    if (!sources.length) return
    qaReferencePayloads.value = sources
    qaSourceSidebarDismissed.value = true
    qaSourceSidebarOpen.value = false
    resetQaSourceView()
    emitQaSession(qaStatus.value)
  } catch {
    // Backend source persistence is best-effort; local QA history remains usable.
  }
}

function refreshQaSessionSourcesIfEmpty(sessionId = currentQaSessionId.value) {
  if (!sessionId) return
  if (sessionId === currentQaSessionId.value && qaReferencePayloads.value.length > 0) return
  window.setTimeout(() => {
    if (sessionId === currentQaSessionId.value && qaReferencePayloads.value.length > 0) return
    void loadQaSessionSources(sessionId)
  }, 300)
}

function refreshStoredQaSessionSourcesIfEmpty(sessionId, fallbackSession = null) {
  if (!sessionId || sessionId === currentQaSessionId.value) {
    refreshQaSessionSourcesIfEmpty(sessionId)
    return
  }
  window.setTimeout(async () => {
    const state = qaStreamStates.get(sessionId)
    const session = state?.session || fallbackSession
    if (!session || (Array.isArray(session.referencePayloads) && session.referencePayloads.length > 0)) return
    try {
      const result = await fetchQaSessionSources(sessionId)
      const sources = Array.isArray(result?.sources) ? result.sources : []
      if (!sources.length) return
      const nextSession = {
        ...session,
        referencePayloads: sources,
        sourcesCount: sources.length,
      }
      if (state) state.session = nextSession
      emitStoredQaSession(nextSession, false)
    } catch {
      // Source persistence is best-effort; keep the completed answer available.
    }
  }, 300)
}

function clearQaWorkspace() {
  closeQaStream()
  currentQaSessionId.value = ''
  qaSessionCreatedAt.value = ''
  qaQuestion.value = ''
  qaCurrentQuestion.value = ''
  qaQuestionTime.value = ''
  qaAnswer.value = ''
  qaTurns.value = []
  qaMessages.value = []
  activeQaTurnId.value = ''
  qaStatus.value = 'idle'
  qaError.value = ''
  qaReferencePayloads.value = []
  qaSourceSidebarOpen.value = false
  qaSourceSidebarDismissed.value = false
  resetQaSourceView()  qaCopyNotice.value = ''
  qaValidationError.value = ''
  qaThreadHasNewContent.value = false
  emit('qa-session-clear-selection')
  nextTick(() => qaInputRef.value?.focus())
}

function fillRecommendedQuestion(question) {
  qaQuestion.value = question
  qaValidationError.value = ''
  nextTick(() => {
    resizeQaInput()
    qaInputRef.value?.focus()
  })
}

function rotateRecommendedQuestions() {
  qaRecommendedBatch.value = (qaRecommendedBatch.value + 1) % Math.ceil(recommendedQuestions.length / 5)
}

function resizeQaInput() {
  const target = qaInputRef.value
  if (!target) return
  target.style.height = 'auto'
  target.style.height = `${Math.min(target.scrollHeight, 136)}px`
}

function handleQaInput() {
  qaValidationError.value = ''
  resizeQaInput()
}

function handleQaInputKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  if (canSendQa.value) startQa()
}

function isQaThreadNearBottom() {
  const target = qaThreadRef.value
  if (!target) return true
  const rect = target.getBoundingClientRect()
  return rect.bottom - window.innerHeight < 120
}

function scrollQaThreadToBottom() {
  nextTick(() => {
    const target = qaThreadRef.value
    if (!target) return
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'end', behavior: 'smooth' })
      qaThreadShouldStick.value = true
      qaThreadHasNewContent.value = false
    })
  })
}

function maybeScrollQaThreadToBottom() {
  nextTick(() => {
    const target = qaThreadRef.value
    if (!target) return
    if (qaThreadShouldStick.value || isQaThreadNearBottom()) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: 'end', behavior: 'smooth' })
        qaThreadShouldStick.value = true
        qaThreadHasNewContent.value = false
      })
    } else {
      qaThreadHasNewContent.value = true
    }
  })
}

function handleQaThreadScroll(event) {
  const target = event.currentTarget
  if (!target) return
  if (isQaThreadNearBottom()) {
    qaThreadShouldStick.value = true
    qaThreadHasNewContent.value = false
  }
}

function handleQaPageScroll() {
  if (homeMode.value !== 'qa') return
  if (isQaThreadNearBottom()) {
    qaThreadShouldStick.value = true
    qaThreadHasNewContent.value = false
  } else {
    qaThreadShouldStick.value = false
  }
}

function closeQaStream(sessionId = currentQaSessionId.value) {
  clearQaStreamRecoveryTimer(sessionId)
  const state = qaStreamStates.get(sessionId)
  if (state?.source) state.source.close()
  if (qaEventSource === state?.source) qaEventSource = null
  if (state) {
    state.source = null
    qaStreamStates.delete(sessionId)
  }
}

function closeAllQaStreams() {
  for (const sessionId of Array.from(qaStreamStates.keys())) closeQaStream(sessionId)
}

function clearQaStreamRecoveryTimer(sessionId = currentQaSessionId.value) {
  const state = qaStreamStates.get(sessionId)
  const timer = state?.recoveryTimer || (sessionId === currentQaSessionId.value ? qaStreamRecoveryTimer : null)
  if (timer) window.clearTimeout(timer)
  if (state) state.recoveryTimer = null
  if (sessionId === currentQaSessionId.value) qaStreamRecoveryTimer = null
}

function scheduleQaStreamRecoveryFailure() {
  if (qaStreamRecoveryTimer) return
  qaStreamRecoveryTimer = window.setTimeout(() => {
    qaStreamRecoveryTimer = null
    if (qaStatus.value === 'done') return
    if (qaAnswer.value.trim()) {
      qaStatus.value = 'done'
      updateActiveQaTurn({ status: 'done' })
      appendQaAssistantMessage()
      emitQaSession('done')
      refreshQaSessionSourcesIfEmpty()
      closeQaStream()
      return
    }
    qaStatus.value = 'failed'
    qaError.value = '连接中断，可重新提问。'    updateActiveQaTurn({ status: 'failed' })
    emitQaSession('failed')
    closeQaStream()
  }, 90000)
}

function scheduleQaStreamRecoveryFailureForSession(sessionId = currentQaSessionId.value) {
  const state = qaStreamState(sessionId)
  if (!state || state.recoveryTimer) return
  const timer = window.setTimeout(() => {
    const latest = qaStreamStates.get(sessionId)
    if (latest) latest.recoveryTimer = null
    if (sessionId === currentQaSessionId.value) qaStreamRecoveryTimer = null

    if (sessionId === currentQaSessionId.value) {
      if (qaStatus.value === 'done') return
      if (qaAnswer.value.trim()) {
        qaStatus.value = 'done'
        updateActiveQaTurn({ status: 'done' })
        appendQaAssistantMessage()
        emitQaSession('done')
        rememberCurrentQaStreamSession('done')
        refreshQaSessionSourcesIfEmpty(sessionId)
        closeQaStream(sessionId)
        return
      }
      qaStatus.value = 'failed'
      qaError.value = '连接中断，可重新提问。'
      updateActiveQaTurn({ status: 'failed' })
      emitQaSession('failed')
      rememberCurrentQaStreamSession('failed')
      closeQaStream(sessionId)
      return
    }

    const session = latest?.session
    if (!session) return
    if (String(session.answer || '').trim()) {
      const doneSession = updateStoredQaTurn({ ...session, status: 'done' }, { status: 'done' })
      latest.session = doneSession
      emitStoredQaSession(doneSession, false)
      refreshStoredQaSessionSourcesIfEmpty(sessionId, doneSession)
      closeQaStream(sessionId)
      return
    }
    const failedSession = updateStoredQaTurn({ ...session, status: 'failed' }, { status: 'failed' })
    latest.session = failedSession
    emitStoredQaSession(failedSession, false)
    closeQaStream(sessionId)
  }, 90000)
  state.recoveryTimer = timer
  if (sessionId === currentQaSessionId.value) qaStreamRecoveryTimer = timer
}

function sanitizeQaText(value, maxLength = 240) {
  let text = String(value || '').replace(/\s+/g, ' ').trim()
  for (const [pattern, replacement] of qaSensitiveTermReplacements) {
    text = text.replace(pattern, replacement)
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function sanitizeQaAnswerDelta(value) {
  let text = String(value || '')
  for (const [pattern, replacement] of qaSensitiveTermReplacements) {
    text = text.replace(pattern, replacement)
  }
  return text
}


function extractQaReferencePayloads(event) {
  const candidates = [
    event?.sources,
    event?.source,
    event?.evidence,
    event?.references,
    event?.reference,
    event?.data?.sources,
    event?.data?.evidence,
    event?.data?.references,
  ]
  const nextItems = []
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) nextItems.push(...candidate)
    else if (candidate && typeof candidate === 'object') nextItems.push(candidate)
  }
  return nextItems
}

function collectQaReferences(event) {
  const nextItems = extractQaReferencePayloads(event)
  if (!nextItems.length) return
  qaReferencePayloads.value = [...qaReferencePayloads.value, ...nextItems].slice(-40)
}

function handleQaEvent(event) {
  if (!event || typeof event !== 'object') return
  collectQaReferences(event)
  if (event.type === 'text_delta') {
    qaStatus.value = 'streaming'
    updateActiveQaTurn({
      answer: `${qaAnswer.value}${sanitizeQaAnswerDelta(event.content || '')}`,
      status: 'streaming',
    })
    emitQaSession('streaming')
    return
  }
  if (event.type === 'token') return
  if (event.type === 'tool_start' || event.type === 'tool_delta' || event.type === 'tool_end' || event.type === 'stage' || event.type === 'status') {
    if (qaStatus.value === 'searching') qaStatus.value = 'integrating'    emitQaSession(qaStatus.value)
    return
  }
  if (event.type === 'done') {
    qaStatus.value = 'done'
    updateActiveQaTurn({ status: 'done' })
    appendQaAssistantMessage()
    emitQaSession('done')
    refreshQaSessionSourcesIfEmpty()
    closeQaStream()
    return
  }
  if (event.type === 'error') {
    qaStatus.value = 'failed'
    qaError.value = '回答生成失败，请稍后重试。'    updateActiveQaTurn({ status: 'failed' })
    emitQaSession('failed')
    closeQaStream()
  }
}

function handleQaEventForSession(sessionId, event) {
  if (!event || typeof event !== 'object') return
  if (sessionId === currentQaSessionId.value) {
    handleQaEvent(event)
    if (qaStreamStates.has(sessionId)) rememberCurrentQaStreamSession(qaStatus.value)
    return
  }

  const state = qaStreamStates.get(sessionId)
  if (!state?.session) return
  const references = extractQaReferencePayloads(event)
  let session = references.length
    ? {
        ...state.session,
        referencePayloads: [...(state.session.referencePayloads || []), ...references].slice(-40),
      }
    : state.session

  if (event.type === 'text_delta') {
    const turns = Array.isArray(session.turns) ? session.turns : []
    const activeTurn = turns.find((turn) => turn.id === session.activeTurnId) || turns[turns.length - 1] || {}
    session = updateStoredQaTurn(
      { ...session, status: 'streaming' },
      {
        answer: `${activeTurn.answer || ''}${sanitizeQaAnswerDelta(event.content || '')}`,
        status: 'streaming',
      },
    )
    state.session = session
    emitStoredQaSession(session, false)
    return
  }

  if (event.type === 'token') {
    state.session = session
    return
  }

  if (event.type === 'tool_start' || event.type === 'tool_delta' || event.type === 'tool_end' || event.type === 'stage' || event.type === 'status') {
    session = {
      ...session,
      status: session.status === 'searching' ? 'integrating' : session.status,
    }
    state.session = session
    emitStoredQaSession(session, false)
    return
  }

  if (event.type === 'done') {
    session = updateStoredQaTurn({ ...session, status: 'done' }, { status: 'done' })
    const answer = String(session.answer || '').trim()
    const messages = Array.isArray(session.messages) ? [...session.messages] : [QA_SYSTEM_MESSAGE]
    const last = messages[messages.length - 1]
    if (answer && !(last?.role === 'assistant' && last.content === answer)) {
      messages.push({ role: 'assistant', content: answer })
    }
    session = { ...session, messages }
    state.session = session
    emitStoredQaSession(session, false)
    refreshStoredQaSessionSourcesIfEmpty(sessionId, session)
    closeQaStream(sessionId)
    return
  }

  if (event.type === 'error') {
    session = updateStoredQaTurn({ ...session, status: 'failed' }, { status: 'failed' })
    state.session = session
    emitStoredQaSession(session, false)
    closeQaStream(sessionId)
  }
}

async function startQa(questionOverride = '') {
  const overrideText = typeof questionOverride === 'string' ? questionOverride : ''
  const question = String(overrideText || qaQuestion.value).trim()
  if (isQaRunning.value) return
  if (!question) {
    qaValidationError.value = '请先输入需要咨询的问题。'
    nextTick(() => qaInputRef.value?.focus())
    return
  }
  const authToken = getAuthToken()
  if (!authToken) {
    qaValidationError.value = '???????????'
    return
  }
  closeQaStream()
  qaError.value = ''
  qaImportNotice.value = ''
  qaValidationError.value = ''
  qaCopyNotice.value = ''  const isContinuingSession = Boolean(currentQaSessionId.value && qaTurns.value.length)
  if (!currentQaSessionId.value) currentQaSessionId.value = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  if (!qaSessionCreatedAt.value) qaSessionCreatedAt.value = new Date().toISOString()
  if (!isContinuingSession) qaReferencePayloads.value = []
  const createdAt = new Date().toISOString()
  const turnId = `${currentQaSessionId.value}-turn-${Date.now()}`
  qaSourceSidebarDismissed.value = false
  if (!isContinuingSession) qaSourceSidebarOpen.value = false
  qaMessages.value = [
    ...(qaMessages.value.length ? qaMessages.value : [QA_SYSTEM_MESSAGE]),
    { role: 'user', content: question },
  ]
  qaTurns.value = [
    ...qaTurns.value,
    { id: turnId, question, answer: '', createdAt, status: 'streaming' },
  ]
  activeQaTurnId.value = turnId
  syncCurrentQaFromTurns()
  qaQuestion.value = ''
  nextTick(resizeQaInput)
  qaThreadShouldStick.value = true
  qaThreadHasNewContent.value = false
  qaStatus.value = 'searching'
  emitQaSession('streaming')
  const sessionId = currentQaSessionId.value
  const state = qaStreamState(sessionId)
  if (state) state.session = qaSessionSnapshot('streaming')
  scrollQaThreadToBottom()

  try {
    const response = await createChatCompletion({
      stream: true,
      sessionId,
      messages: qaMessages.value,
    })
    const url = getChatStreamUrl(response?.eventsUrl)
    if (!url) throw new Error('未获得回答通道')
    const separator = url.includes('?') ? '&' : '?'
    const source = new EventSource(`${url}${separator}access_token=${encodeURIComponent(authToken)}`)
    if (state) state.source = source
    if (sessionId === currentQaSessionId.value) qaEventSource = source
    source.onmessage = (message) => {
      clearQaStreamRecoveryTimer(sessionId)
      try {
        handleQaEventForSession(sessionId, JSON.parse(message.data))
      } catch {
      }
    }
    source.onerror = () => {
      if (sessionId !== currentQaSessionId.value) {
        const latest = qaStreamStates.get(sessionId)
        const session = latest?.session
        if (!session) return
        if (String(session.answer || '').trim()) {
          const doneSession = updateStoredQaTurn({ ...session, status: 'done' }, { status: 'done' })
          latest.session = doneSession
          emitStoredQaSession(doneSession, false)
          refreshStoredQaSessionSourcesIfEmpty(sessionId, doneSession)
          closeQaStream(sessionId)
          return
        }
        const pendingSession = {
          ...session,
          status: session.status === 'searching' ? 'integrating' : session.status,
        }
        latest.session = pendingSession
        emitStoredQaSession(pendingSession, false)
        scheduleQaStreamRecoveryFailureForSession(sessionId)
        return
      }
      if (qaStatus.value !== 'done' && !(qaStatus.value === 'streaming' && qaAnswer.value.trim())) {
        if (qaStatus.value === 'searching') qaStatus.value = 'integrating'        emitQaSession(qaStatus.value)
        rememberCurrentQaStreamSession(qaStatus.value)
        scheduleQaStreamRecoveryFailureForSession(sessionId)
        return
      }
      if (qaStatus.value === 'done' || (qaStatus.value === 'streaming' && qaAnswer.value.trim())) {
        qaStatus.value = 'done'
        updateActiveQaTurn({ status: 'done' })
        appendQaAssistantMessage()
        emitQaSession('done')
        rememberCurrentQaStreamSession('done')
        refreshQaSessionSourcesIfEmpty(sessionId)
        closeQaStream(sessionId)
        return
      }
      if (qaStatus.value !== 'done') {
        qaStatus.value = 'failed'
        qaError.value = '连接中断，可重新提问。'        updateActiveQaTurn({ status: 'failed' })
        emitQaSession('failed')
        rememberCurrentQaStreamSession('failed')
      }
      closeQaStream(sessionId)
    }
  } catch (error) {
    qaStatus.value = 'failed'
    if (error?.status === 401) {
      qaError.value = '??????????????'
    } else if (error?.status === 403) {
      qaError.value = '???????????'
    } else {
      qaError.value = '?????????????'
    }
    qaError.value = '回答生成失败，请稍后重试。'    updateActiveQaTurn({ status: 'failed' })
    emitQaSession('failed')
    rememberCurrentQaStreamSession('failed')
    closeQaStream(sessionId)
  }
}

async function copyQaAnswer() {
  if (!qaAnswer.value) return
  await navigator.clipboard?.writeText(qaAnswer.value)
  qaCopyNotice.value = '答案已复制'
  window.setTimeout(() => {
    qaCopyNotice.value = ''
  }, 1800)
}

function continueQa() {
  qaValidationError.value = ''
  nextTick(() => {
    resizeQaInput()
    qaInputRef.value?.focus()
  })
}

function buildQaReportTitle(question) {
  const cleaned = String(question || '')
    .replace(/[？?。！!：:；;，,、\s]+$/g, '')
    .replace(/^(请问|请分析|分析一下|介绍一下|说明一下)/, '')
    .trim()
  if (!cleaned) return ''
  if (/(研判|报告|分析|态势|情况)$/.test(cleaned)) return cleaned.slice(0, 200)
  return `${cleaned}情况研判`.slice(0, 200)
}

function truncateQaImportText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function qaImportSessionTitle(session) {
  return truncateQaImportText(session?.question || session?.title || '未命名问答', 120)
}

function qaImportDate(value) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function qaImportSourceLines(sources) {
  return (Array.isArray(sources) ? sources : [])
    .slice(0, 5)
    .map((source, index) => {
      const normalized = normalizeSourceListItem(source, index, 'structured_sources')
      return [
        `${index + 1}. ${truncateQaImportText(normalized.title || '未命名来源', 120)}`,
        normalized.sourceName ? `来源：${normalized.sourceName}` : '',
        normalized.publishTime ? `时间：${normalized.publishTime}` : '',
        normalized.url ? `URL：${normalized.url}` : '',
        normalized.summary ? `摘要：${truncateQaImportText(normalized.summary, 240)}` : '',
      ].filter(Boolean).join('；')
    })
}

async function ensureQaImportSessionSources(session) {
  if (!session?.id) return session
  if (Array.isArray(session.referencePayloads) && session.referencePayloads.length) return session
  try {
    const result = await fetchQaSessionSources(session.id)
    const sources = Array.isArray(result?.sources) ? result.sources : []
    if (!sources.length) return session
    const nextSession = {
      ...session,
      referencePayloads: sources,
      sourcesCount: sources.length,
    }
    emitStoredQaSession(nextSession, false)
    return nextSession
  } catch {
    return session
  }
}

async function importSelectedQaAsReportContext() {
  const selectedItems = selectedQaImportTurnsView.value
  if (!selectedItems.length) return

  const sessionMap = new Map()
  for (const item of selectedItems) {
    if (!sessionMap.has(item.session.id)) {
      sessionMap.set(item.session.id, {
        session: await ensureQaImportSessionSources(item.session),
        turns: [],
      })
    }
    sessionMap.get(item.session.id).turns.push(item.turn)
  }

  const sections = ['【问答背景资料】']
  let firstQuestion = ''
  for (const { session, turns } of sessionMap.values()) {
    if (!firstQuestion) firstQuestion = turns[0]?.question || session.question || ''
    const sources = Array.isArray(session.referencePayloads) ? session.referencePayloads : []
    sections.push([
      `【聊天】${qaImportSessionTitle(session)}`,
      `时间：${qaImportDate(session.updatedAt || session.createdAt)}`,
      `来源数量：${sources.length || session.sourcesCount || 0}`,
    ].join('\n'))
    turns.forEach((turn, index) => {
      sections.push([
        `【问答 ${index + 1}】`,
        `问题：${truncateQaImportText(turn.question, 500)}`,
        `回答摘要/全文：${truncateQaImportText(turn.answer, 1800)}`,
      ].join('\n'))
    })
    const sourceLines = qaImportSourceLines(sources)
    if (sourceLines.length) {
      sections.push(['参考来源：', ...sourceLines].join('\n'))
    }
  }

  selectHomeMode('report')
  const titleCandidate = buildQaReportTitle(firstQuestion)
  if (!props.title?.trim() && titleCandidate) emit('update:title', titleCandidate)
  const nextContext = [props.contextText, sections.join('\n\n')]
    .filter((item) => String(item || '').trim())
    .join('\n\n')
  emit('update:contextText', nextContext)
  qaImportNotice.value = `已导入 ${sessionMap.size} 个聊天、${selectedItems.length} 轮问答作为编报背景`
}

function importQaAsReportContext() {
  if (!qaAnswer.value.trim()) return
  selectHomeMode('report')
  const titleCandidate = buildQaReportTitle(qaCurrentQuestion.value)
  if (!props.title?.trim() && titleCandidate) emit('update:title', titleCandidate)
  const nextContext = [props.contextText, qaAnswer.value.trim()]
    .filter(Boolean)
    .join('\n\n')
  emit('update:contextText', nextContext)
  qaImportNotice.value = '已作为编报背景导入'
}

function isPlanOptionSelected(stepId, optionId) {
  return (props.planSelections?.[stepId] || []).includes(optionId)
}

function isPlanSearchQuerySelected(query) {
  return (props.planSearchSelections || []).includes(query)
}

function manualSourceKey(value) {
  const text = String(value || '').trim()
  try {
    const parsed = new URL(text)
    parsed.hash = ''
    parsed.searchParams.sort()
    return parsed.toString().replace(/\/$/, '').toLowerCase()
  } catch {
    return text.replace(/\s+/g, ' ').toLowerCase()
  }
}

function parseManualPlanSources(value) {
  const seen = new Set()
  return String(value || '')
    .split(/\r?\n|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = manualSourceKey(item)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function commitManualPlanSources(items) {
  emit('update:planSourceInput', parseManualPlanSources(items.join('\n')).join('\n'))
}

function addManualPlanSources() {
  const incoming = parseManualPlanSources(manualSourceDraft.value)
  if (!incoming.length) return
  commitManualPlanSources([...manualPlanSources.value, ...incoming])
  manualSourceDraft.value = ''
}

function removeManualPlanSource(index) {
  commitManualPlanSources(manualPlanSources.value.filter((_, itemIndex) => itemIndex !== index))
}

function addManualPlanDirection() {
  const label = manualDirectionDraft.value.trim()
  if (!label || !currentPlanStep.value?.id) return
  emit('add-plan-option', currentPlanStep.value.id, {
    label,
    detail: `用户手动新增方向：${label}`,
  })
  manualDirectionDraft.value = ''
}

function planOptionStatusLabel(option) {
  if (option?.statusLabel) return option.statusLabel
  if (option?.disabled) return '不可用'
  if (option?.sourceGroup === 'verified') return '可采集'
  return option?.selected ? '主题推荐' : '检索方向'
}

function planOptionStatusClass(option) {
  if (option?.disabled || option?.status === 'unavailable') return 'unavailable'
  if (option?.sourceGroup === 'verified' || option?.status === 'available') return 'available'
  if (option?.selected) return 'recommended'
  return 'direction'
}

function planStepTypeLabel(type) {
  const labels = {
    search_queries: '检索词',
    source_scope: '信源范围',
    supplement: '补充方向',
    basic_info_module: '基本信息模块',
    analysis_module: '研判模块',
    output_module: '输出模块',
    report_section: '编报章节',
  }
  return labels[type] || '编报模块'
}

function toggleLogDrawer() {
  if (canOpenLogDrawer.value) emit('toggle-log-drawer')
}

function scrollPlanningSection(id) {
  const target = document.getElementById(id)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openQaGuide() {
  qaGuideOpen.value = true
}

function closeQaGuide() {
  qaGuideOpen.value = false
}

function handleQaGuideKeydown(event) {
  if (event.key === 'Escape' && qaGuideOpen.value) closeQaGuide()
}

function logTypeLabel(type) {
  if (type === 'tool_start') return '工具开始'
  if (type === 'tool_end') return '工具完成'
  if (type === 'tool_error') return '工具错误'
  if (type === 'done') return '任务完成'
  if (type === 'error') return '任务错误'
  return '阶段'
}

function logStatusClass(status) {
  if (status === 'failed' || status === 'error') return 'text-red-300 border-red-400/35 bg-red-950/30'
  if (status === 'completed' || status === 'succeeded') return 'text-neon-green border-neon-green/30 bg-neon-green/5'
  if (status === 'fallback') return 'text-cyber-yellow border-cyber-yellow/30 bg-cyber-yellow/5'
  return 'text-slate-500 border-neon-cyan/25 bg-neon-cyan/5'
}

function buildRawLogText(log) {
  return [logToolDisplayName(log), log?.label, log?.summary, log?.command, log?.detail]
    .filter(Boolean)
    .join('\n')
}

function classifyToolDisplayName(rawValue) {
  const raw = String(rawValue || '').toLowerCase()
  if (!raw.trim()) return ''

  if (
    /pg-sources__query|mysql-test__mysql_query|database_sources\.json|database_query_plan\.json|vector_sources\.json/.test(raw) ||
    /\b(pg|postgres|postgresql|mysql|sql|vector|embedding|database|db)\b/.test(raw) ||
    /数据库|向量|召回/.test(raw)
  ) {
    return '数据库检索工具'
  }

  if (
    /\b(exa|firecrawl|tavily|internet|search|crawl|scrape|browser)\b|exa[_\s-]?search|firecrawl[_\s-]?(mcp|search|extract|crawl|scrape)|web[_\s-]?(search|serch|fetch|crawl|scrape)|search\.mjs|extract\.mjs/.test(raw) ||
    /互联网|联网|搜索|抓取/.test(raw)
  ) {
    return '互联网搜索工具'
  }

  return '本地脚本工具'
}

function logToolDisplayName(log) {
  const explicit = log?.toolDisplayName || log?.toolName
  const raw = [log?.label, log?.summary, log?.command, log?.detail].filter(Boolean).join('\n')
  return classifyToolDisplayName(explicit) || classifyToolDisplayName(raw)
}

function sanitizeReportLogText(value) {
  const text = String(value || '')
  if (/content_filter|considered high risk|safety policy|高风险/i.test(text)) {
    return '本次主题触发模型安全策略，生成内容被拦截，未形成有效报告。请调整表述或降低敏感措辞后重试。'
  }
  return text
    .replace(/\b(?:exa|firecrawl|tavily|tavily[_\s-]?(?:search|extract)|exa[_\s-]?search|firecrawl[_\s-]?(?:mcp|search|extract|crawl|scrape)|web[_\s-]?(?:search|serch|fetch|crawl|scrape)|search\.mjs|extract\.mjs)\b/gi, '互联网搜索工具')
    .replace(/Hermes\s+Gateway/gi, '任务通道')
    .replace(/Hermes\s+report-agent/gi, '编报智能体')
    .replace(/Hermes/gi, '自主智能体')
    .replace(/\breport-agent\b/gi, '编报智能体')
    .replace(/\bGateway\b/g, '任务通道')
    .replace(/(?:\/home\/node\/\.hermes\/workspace\/|\/usr\/docker\/hermes\/workspace\/)/gi, '.../')
    .replace(/returned too little report content\.?/gi, '生成内容不足，未达到编报成稿要求。')
    .trim()
}

function extractQuery(rawLog) {
  const text = rawLog || ''
  const quoted = text.match(/--query\s+["']([^"']+)["']/i)
  if (quoted?.[1]) return quoted[1].trim()
  const plain = text.match(/--query\s+([^\n\r]+)/i)
  if (!plain?.[1]) return ''
  return plain[1].replace(/\s+--\S+.*$/, '').trim()
}

function workflowLogView(phase, rawLog, status) {
  const lowerPhase = String(phase || '').toLowerCase()
  const lower = String(rawLog || '').toLowerCase()
  const views = {
    start: ['CONNECTING', '任务规划', '系统正在整理编报要求、确定信源范围并拆解调研任务。'],
    running: ['TASK_START', '任务规划', '系统正在整理编报要求、确定信源范围并拆解调研任务。'],
    'hermes:start': ['TASK_START', '任务规划', '系统正在整理编报要求、确定信源范围并拆解调研任务。'],
    'hermes:complete': ['COMPLETED', '编报任务已完成', '系统已完成执行。'],
    waiting_final_report: ['WAITING_CONFIRM', '等待报告文件确认', '系统正在等待最终报告文件确认。'],
    context_preparing: ['PREPARING', '任务规划', '系统正在整理编报要求、确定信源范围并拆解调研任务。'],
    research_planning: ['PLANNING', '任务规划', '系统正在整理编报要求、确定信源范围并拆解调研任务。'],
    database_recall: ['PG_RECALL', '数据库检索', '系统正在优先召回 PG 向量库和数据库信源。'],
    research_dispatch: ['RESEARCH_TASK', '资料采集', '系统正在采集公开资料并提取关键事实。'],
    research_waiting: ['WAITING_RESEARCH', '资料采集', '系统正在采集公开资料并提取关键事实。'],
    research_collecting: ['RESEARCHING', '资料采集', '系统正在采集公开资料并提取关键事实。'],
    research_complete: ['RESEARCH_DONE', '调研结果已返回', '调研已完成，系统正在收集结果。'],
    synthesis_dispatch: ['SYNTHESIS_TASK', '素材整合', '系统正在汇总信源、证据和分析要点，并准备进入撰稿。'],
    synthesis_waiting: ['WAITING_SYNTHESIS', '素材整合', '系统正在等待素材整合任务完成。'],
    synthesis_writing: ['WRITING', '报告撰写', '系统正在撰写报告正文并完成校验。'],
    report_verifying: ['VERIFYING', '报告撰写', '系统正在撰写报告正文并完成校验。'],
    report_saving: ['SAVING', '报告撰写', '系统正在撰写报告正文并完成校验。'],
    quality_review: ['QUALITY_REVIEW', '成稿自检', '系统正在检查主题一致性、信源依据、风险推理和写作质量。'],
    quality_review_done: ['QUALITY_REVIEW', '成稿自检', '成稿自检已完成，可查看评分和建议。'],
    quality_review_failed: ['QUALITY_REVIEW', '成稿自检', '成稿自检失败，可稍后重试。'],
    technical_detail: ['DETAIL', '处理技术细节', '系统正在读取配置或中间文件；可展开查看原始记录。'],
    done: ['COMPLETED', '编报任务已完成', '报告已生成，可以查看或导出。'],
    error: ['ERROR', '任务执行出现异常', '系统执行过程中出现异常，请查看技术详情或重试。'],
  }
  const match = views[lowerPhase]
  if (match) return { stage: match[0], title: match[1], description: match[2], status }
  if (lower.includes('preparing hermes gateway')) return { stage: 'CONNECTING', title: views.start[1], description: views.start[2], status }
  if (lower.includes('running hermes report-agent')) return { stage: 'AGENT_START', title: views.running[1], description: views.running[2], status }
  if (lower.includes('waiting_final_report') || lower.includes('waiting for the final report')) return { stage: 'WAITING_CONFIRM', title: views.waiting_final_report[1], description: views.waiting_final_report[2], status }
  if (lower.includes('sessions_spawn') && lower.includes('research-group')) return { stage: 'RESEARCH_TASK', title: views.research_dispatch[1], description: views.research_dispatch[2], status }
  if (lower.includes('sessions_spawn') && lower.includes('synthesis')) return { stage: 'SYNTHESIS_TASK', title: views.synthesis_dispatch[1], description: views.synthesis_dispatch[2], status }
  if (lower.includes('sessions_yield') && lower.includes('synthesis')) return { stage: 'WAITING_SYNTHESIS', title: views.synthesis_waiting[1], description: views.synthesis_waiting[2], status }
  if (lower.includes('sessions_yield')) return { stage: 'WAITING_RESEARCH', title: views.research_waiting[1], description: views.research_waiting[2], status }
  if (lower.includes('成稿自检') || lower.includes('quality_review')) return { stage: 'QUALITY_REVIEW', title: '成稿自检', description: '系统正在检查成稿质量并生成建议。', status }
  if (lower.includes('pg-sources__query') || lower.includes('vector_sources.json') || lower.includes('database_sources.json') || lower.includes('database_query_plan.json')) return { stage: 'PG_RECALL', title: '数据库检索', description: '系统正在优先召回 PG 向量库和数据库信源。', status }
  if (lower.includes('harness_cli.py plan') || lower.includes('plan.json')) return { stage: 'HARNESS_PLAN', title: '任务规划', description: '系统正在整理编报要求、确定信源范围并拆解调研任务。', status }
  if (lower.includes('harness_cli.py run') || lower.includes('research_') || lower.includes('research/research')) return { stage: 'RESEARCH_RUN', title: '资料采集', description: '系统正在采集公开资料并提取关键事实。', status }
  if (lower.includes('consolidated.json')) return { stage: 'CONSOLIDATE', title: '素材整合', description: '系统正在汇总信源、证据和分析要点。', status }
  if (lower.includes('validate_report.py') || lower.includes('validate report')) return { stage: 'VALIDATE_SAVE', title: '报告撰写', description: '系统正在撰写报告正文并完成校验。', status }
  if (lower.includes('group_') && lower.includes('.json')) return { stage: 'RESEARCH_TASK', title: views.research_dispatch[1], description: views.research_dispatch[2], status }
  if (lower.includes('context.json')) return { stage: 'PREPARING', title: views.context_preparing[1], description: views.context_preparing[2], status }
  if (lower.includes('report_file: /') && !lower.includes('error')) return { stage: 'SAVING', title: views.report_saving[1], description: views.report_saving[2], status }
  return null
}

function isLowValueTechnicalLog(rawLog) {
  const lower = String(rawLog || '').toLowerCase()
  return lower.includes('skill.md') ||
    lower.includes('/skills/') ||
    lower.includes('sessions.json') ||
    lower.includes('uuid') ||
    lower.includes('read completed') ||
    lower.includes('command completed')
}

function translateHermesLog(log) {
  const toolDisplayName = logToolDisplayName(log)
  const rawLog = buildRawLogText(log)
  const displayRawLog = sanitizeReportLogText(rawLog)
  const lower = rawLog.toLowerCase()
  const status = log?.status === 'failed' || log?.status === 'error'
    ? 'error'
    : log?.status === 'completed' || log?.status === 'succeeded' || log?.type === 'done'
      ? 'done'
      : 'running'

  const base = {
    time: log?.time || '',
    stage: 'RUNNING',
    title: '正在推进编报任务',
    description: '系统正在执行当前编报步骤。',
    raw: displayRawLog,
    status,
    toolDisplayName,
  }

  const hasFailureText = lower.includes('error') ||
    lower.includes('failed') ||
    lower.includes('timed out') ||
    lower.includes('timeout exceeded') ||
    lower.includes('超时')

  if (hasFailureText) {
    return {
      ...base,
      stage: 'ERROR',
      title: '任务执行出现异常',
      description: '系统执行过程中出现异常，请查看技术详情或重试。',
      status: 'error',
    }
  }

  if (lower.includes('succeeded')) {
    return {
      ...base,
      stage: 'COMPLETED',
      title: '编报任务已完成',
      description: '报告已生成，可查看或导出。',
      status: 'done',
    }
  }

  const workflowView = workflowLogView(log?.phase || log?.status, rawLog, status)
  if (workflowView) return { ...base, ...workflowView }

  if (isLowValueTechnicalLog(rawLog)) {
    return {
      ...base,
      stage: 'DETAIL',
      title: '处理技术细节',
      description: '系统正在读取配置或中间文件；可展开查看原始记录。',
      status,
    }
  }

  if (lower.includes('preparing hermes gateway')) {
    return {
      ...base,
      stage: 'CONNECTING',
      title: '任务规划',
      description: '系统正在整理编报要求、确定信源范围并拆解调研任务。',
    }
  }

  if (lower.includes('running hermes report-agent')) {
    return {
      ...base,
      stage: 'TASK_START',
      title: '任务规划',
      description: '系统正在整理编报要求、确定信源范围并拆解调研任务。',
    }
  }

  if (lower.includes('pg-sources__query') || lower.includes('vector_sources.json') || lower.includes('database_sources.json') || lower.includes('database_query_plan.json')) {
    return {
      ...base,
      stage: 'PG_RECALL',
      title: '数据库检索',
      description: '系统正在优先召回 PG 向量库和数据库信源。',
    }
  }

  if (lower.includes('harness_cli.py plan') || lower.includes('plan.json')) {
    return {
      ...base,
      stage: 'HARNESS_PLAN',
      title: '任务规划',
      description: '系统正在整理编报要求、确定信源范围并拆解调研任务。',
    }
  }

  if (lower.includes('harness_cli.py run') || lower.includes('research_') || lower.includes('research/research')) {
    return {
      ...base,
      stage: 'RESEARCH_RUN',
      title: '资料采集',
      description: '系统正在采集公开资料并提取关键事实。',
    }
  }

  if (lower.includes('consolidated.json')) {
    return {
      ...base,
      stage: 'CONSOLIDATE',
      title: '素材整合',
      description: '系统正在汇总信源、证据和分析要点。',
    }
  }

  if (lower.includes('validate_report.py') || lower.includes('validate report')) {
    return {
      ...base,
      stage: 'VALIDATE_SAVE',
      title: '报告撰写',
      description: '系统正在撰写报告正文并完成校验。',
    }
  }

  if (lower.includes('report_file: /')) {
    return {
      ...base,
      stage: 'SYNTHESIS',
      title: '报告撰写',
      description: '系统正在撰写报告正文并完成校验。',
    }
  }

  if (lower.includes('synthesis')) {
    return {
      ...base,
      stage: 'SYNTHESIS',
      title: '素材整合',
      description: '系统正在整合分析材料并准备报告正文。',
    }
  }

  if (lower.includes('planner') || lower.includes('planning') || lower.includes('decomposition')) {
    return {
      ...base,
      stage: 'PLANNING',
      title: '正在拆解编报任务',
      description: 'AI 正在分析主题，并拆解调研方向。',
    }
  }

  if (lower.includes('research_cli.py brief') || lower.includes('search') || lower.includes('firecrawl') || lower.includes('tavily')) {
    const query = extractQuery(rawLog)
    return {
      ...base,
      stage: 'SEARCHING',
      title: '正在检索相关资料',
      description: query
        ? `检索主题：${query}`
        : '系统正在检索与当前主题相关的公开资料、新闻和政策信息。',
    }
  }

  if (lower.includes('extract') || lower.includes('crawl') || lower.includes('scrape')) {
    return {
      ...base,
      stage: 'EXTRACTING',
      title: '正在提取网页正文',
      description: '系统正在读取重点来源内容，提取可用于编报的事实材料。',
    }
  }

  if (lower.includes('synthesizer') || lower.includes('synthesize') || lower.includes('analysis')) {
    return {
      ...base,
      stage: 'ANALYZING',
      title: '正在整合研判材料',
      description: 'AI 正在对检索材料进行归纳、筛选和交叉分析。',
    }
  }

  if (lower.includes('command completed')) {
    return {
      ...base,
      stage: 'STEP_DONE',
      title: '当前步骤已完成',
      description: '一个执行步骤已完成，系统正在进入下一阶段。',
      status: 'done',
    }
  }

  if (lower.includes('report_file: /')) {
    return {
      ...base,
      stage: 'SAVING',
      title: '报告撰写',
      description: '系统正在撰写报告正文并完成校验。',
    }
  }

  return base
}

function friendlyLogStatusClass(status) {
  if (status === 'error') return 'log-entry-error'
  if (status === 'done') return 'log-entry-done'
  return 'log-entry-running'
}

function friendlyLogStatusLabel(status) {
  if (status === 'error') return 'error'
  if (status === 'done') return 'done'
  return 'running'
}

function isTechnicalLogOpen(id) {
  return !technicalLogCollapsedIds.value.has(id)
}

function toggleTechnicalLog(id) {
  const next = new Set(technicalLogCollapsedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  technicalLogCollapsedIds.value = next
}

const dbSourcesState = computed(() => {
  const data = props.databaseSources
  if (props.databaseSourcesLoading && !data) return 'loading'
  if (!data || data.status === 'unavailable') return 'unavailable'
  if (data.status === 'hit') return 'hit'
  if (data.status === 'empty' || data.status === 'fallback') return 'fallback'
  return 'unavailable'
})

const taskProgressView = computed(() => {
  const status = props.job?.status
  const step = String(props.loadingStep || '').toLowerCase()
  const currentBackendStage = Array.isArray(props.progressState?.stages)
    ? props.progressState.stages.find((stage) => stage.key === props.progressState?.currentStage)
    : null
  if (currentBackendStage && status !== 'queued' && status !== 'failed' && status !== 'succeeded' && props.phase !== 'error' && props.phase !== 'done') {
    const stageText = {
      prepare: {
        title: '正在准备编报任务',
        subtitle: '系统正在整理编报要求并建立任务空间。',
        tone: 'queued',
      },
      source: {
        title: '正在筛选可信信源',
        subtitle: '系统正在检索并筛选与主题相关的可信信源。',
        tone: 'searching',
      },
      plan: {
        title: '正在拆解调研计划',
        subtitle: '系统正在拆解调研方向并安排后续采集任务。',
        tone: 'planning',
      },
      research: {
        title: '正在采集调研资料',
        subtitle: '系统正在采集公开资料并提取关键事实。',
        tone: 'extracting',
      },
      deep_collection: {
        title: '正在进行资料深度采集',
        subtitle: '深度编报资料采集 Skill 正在补充并核验公开资料。',
        tone: 'extracting',
      },
      consolidate: {
        title: '正在整合分析素材',
        subtitle: '系统正在汇总信源、证据和分析要点。',
        tone: 'integrating',
      },
      report: {
        title: '正在生成最终报告',
        subtitle: '调研素材已进入撰稿阶段，系统正在生成报告正文并完成校验。',
        tone: 'waiting_report',
      },
    }
    return stageText[currentBackendStage.key] || {
      title: `${currentBackendStage.title}进行中`,
      subtitle: currentBackendStage.desc,
      tone: 'searching',
    }
  }
  if (status === 'queued') {
    return {
      title: '任务已提交',
      subtitle: '系统已接收编报任务，正在等待调度执行。',
      tone: 'queued',
    }
  }
  if (status === 'failed' || props.phase === 'error') {
    return {
      title: '任务执行失败',
      subtitle: '任务执行过程中出现错误，请展开技术详情查看原因。',
      tone: 'failed',
    }
  }
  if (status === 'succeeded' || props.phase === 'done') {
    return {
      title: '报告已生成',
      subtitle: '信源采集和报告生成已完成，可以查看或下载结果。',
      tone: 'succeeded',
    }
  }
  if (step.includes('extract') || step.includes('正文') || step.includes('抽取')) {
    return {
      title: '正在提取重点网页正文',
      subtitle: '系统正在读取高价值来源正文，补充摘要之外的事实材料。',
      tone: 'extracting',
    }
  }
  if (step.includes('report') || step.includes('撰稿') || step.includes('生成') || step.includes('synthesis')) {
    return {
      title: '正在生成最终报告',
      subtitle: '信源材料已进入撰稿阶段，系统正在组织报告正文。',
      tone: 'waiting_report',
    }
  }
  return {
    title: '正在检索公开资料',
    subtitle: '系统正在围绕当前主题采集公开信源，并筛选可用于编报的材料。',
    tone: 'searching',
  }
})

const taskSummaryText = computed(() => {
  const jobId = props.job?.jobId ? `JOB ${props.job.jobId.slice(0, 8)}` : 'JOB --'
  return `${reportTypeLabel.value} · ${props.title || props.job?.payload?.topic || '当前主题'} · ${jobId}`
})

function sourceStatusLabel(status) {
  const labels = {
    discovered: '已发现',
    selected: '已筛选',
    extracting: '正在抽取',
    extracted: '已抽取',
    snippet_only: '仅摘要',
    failed: '抽取失败',
    used: '已用于报告',
  }
  return labels[status] || '已发现'
}

function inferSourceStatus(src) {
  const text = `${src?.title || ''} ${src?.summary || ''}`.toLowerCase()
  if (text.includes('fail') || text.includes('失败') || text.includes('error')) return 'failed'
  if (props.phase === 'done' || props.job?.status === 'succeeded') return 'used'
  if (src?.summary) return 'snippet_only'
  return 'discovered'
}

const normalizedSources = computed(() => {
  const data = props.databaseSources
  const sources = Array.isArray(data?.sources) ? data.sources : []
  return sources.map((src, index) => {
    const status = inferSourceStatus(src)
    const retrievalMode = data?.retrievalMode || ''
    const highValue = index < 8 || retrievalMode === 'vector' || retrievalMode === 'hybrid'
    const url = firstText(src, ['url', 'source_url', 'data_source_url', 'sourceUrl'], '')
    return {
      id: `${url || src.title || 'source'}-${index}`,
      title: firstSourceDisplayText(src, ['title', 'ch_title', 'headline', 'sourceTitle', 'name'], url || '未命名信源'),
      sourceType: retrievalMode === 'vector' ? '向量召回' : retrievalMode === 'hybrid' ? '混合召回' : '数据库信源',
      sourceName: firstSourceDisplayText(src, ['websiteName', 'website_name', 'publisher', 'source_name', 'site_name', 'sourceName', 'source'], sourceHostname(url) || '来源未知'),
      publishTime: formatDbSourceTime(src.publishTime) || '时间未知',
      summary: firstSourceDisplayText(src, ['summary', 'abstract', 'description', 'snippet', 'content_preview'], '该来源暂未提供摘要，系统已记录标题和来源信息。'),
      url,
      status,
      relevance: highValue ? '高相关' : '候选',
      method: retrievalMode === 'vector' ? 'PG 向量语义召回' : retrievalMode === 'hybrid' ? '向量与关键词混合召回' : '数据库关键词召回',
      note: status === 'snippet_only'
        ? '该来源仅保留搜索摘要，后续生成时将降低证据权重。'
        : status === 'failed'
          ? '正文提取失败，已记录该来源并保留可用摘要。'
          : '',
    }
  })
})

const visibleSourceCards = computed(() => {
  return dbSourcesExpanded.value ? normalizedSources.value : normalizedSources.value.slice(0, 5)
})

const databaseSourceDiagnostics = computed(() => {
  const data = props.databaseSources || {}
  const diagnostics = data.diagnostics || {}
  const entityPolicy = diagnostics.entityPolicy || data.entityPolicy || {}
  const coreEntities = Array.isArray(diagnostics.coreEntities)
    ? diagnostics.coreEntities
    : Array.isArray(entityPolicy.coreEntities)
      ? entityPolicy.coreEntities.map((item) => item?.canonical || item).filter(Boolean)
      : []
  const topicTerms = Array.isArray(diagnostics.topicTerms)
    ? diagnostics.topicTerms
    : Array.isArray(entityPolicy.topicTerms)
      ? entityPolicy.topicTerms
      : []
  return {
    enabled: Boolean(data.diagnostics || data.message || data.rejectedSources?.length || data.uncertainSources?.length),
    coreEntities: coreEntities.slice(0, 8),
    topicTerms: topicTerms.slice(0, 10),
    acceptedCount: diagnostics.acceptedCount ?? data.acceptedSources?.length ?? data.sources?.length ?? 0,
    uncertainCount: diagnostics.uncertainCount ?? data.uncertainSources?.length ?? 0,
    rejectedCount: diagnostics.rejectedCount ?? data.rejectedSources?.length ?? 0,
    fallbackReason: diagnostics.fallbackReason || data.message || data.fallbackReason || '',
    shouldUseWebSupplement: diagnostics.shouldUseWebSupplement === true,
    recommendedSearchQueries: Array.isArray(diagnostics.recommendedSearchQueries) ? diagnostics.recommendedSearchQueries.slice(0, 6) : [],
  }
})

const sourceSupplementStatus = computed(() => {
  const diagnostics = sourceListDiagnostics.value || {}
  const supplement = diagnostics.supplement || {}
  const retrievalMetrics = supplement.retrievalMetrics || {}
  const webMetrics = retrievalMetrics.web || {}
  const deduplication = retrievalMetrics.deduplication || {}
  const performance = retrievalMetrics.performance || {}
  const database = diagnostics.database || props.databaseSources?.diagnostics || {}
  const web = diagnostics.web || {}
  const databaseAccepted = Number(database.acceptedCount ?? props.databaseSources?.sources?.length ?? 0)
  const webAccepted = Number(web.acceptedCount ?? 0)
  return {
    visible: supplement.triggered === true || Boolean(supplement.reason),
    triggered: supplement.triggered === true,
    reason: supplement.reason || '',
    databaseAccepted,
    queryCount: Array.isArray(supplement.queries) ? supplement.queries.length : 0,
    searchResultCount: Number(supplement.searchResultCount ?? web.searchResultCount ?? 0),
    fetchedCount: Number(supplement.fetchedCount ?? web.fetchedCount ?? 0),
    acceptedCount: Number(supplement.acceptedCount ?? webAccepted),
    rejectedCount: Number(supplement.rejectedCount ?? 0),
    finalCount: databaseAccepted + webAccepted,
    fetchSuccessRate: Number(webMetrics.fetchSuccessRate ?? 0),
    deduplicationRemoved: Number(deduplication.removedCount ?? 0),
    referencedCount: Number(retrievalMetrics.final?.referencedSourceCount ?? 0),
    durationMs: Number(performance.totalSupplementDurationMs ?? 0),
  }
})

const filteredDatabaseCandidates = computed(() => {
  const data = props.databaseSources || {}
  const uncertain = Array.isArray(data.uncertainSources) ? data.uncertainSources : []
  const rejected = Array.isArray(data.rejectedSources) ? data.rejectedSources : []
  return [
    ...uncertain.map((source) => ({ ...source, filterStatus: '待核验' })),
    ...rejected.map((source) => ({ ...source, filterStatus: '已过滤' })),
  ].slice(0, 30).map((source, index) => normalizeFilteredDatabaseCandidate(source, index))
})

function normalizeFilteredDatabaseCandidate(source, index) {
  const match = source?.entityMatch || source?.entity_match || {}
  const url = firstText(source, ['url', 'source_url', 'data_source_url', 'sourceUrl'], '')
  return {
    id: `filtered-${url || source?.title || source?.ch_title || index}`,
    title: firstSourceDisplayText(source, ['title', 'ch_title', 'headline', 'sourceTitle', 'name'], url || '未命名候选'),
    sourceName: firstSourceDisplayText(source, ['websiteName', 'website_name', 'publisher', 'source_name', 'site_name', 'sourceName'], sourceHostname(url) || '来源未知'),
    filterStatus: source?.filterStatus || (match.status === 'uncertain' ? '待核验' : '已过滤'),
    reason: match.reason || source?.reason || source?.relevance_reason || '未通过核心实体校验。',
    matchedConfusions: Array.isArray(match.matchedConfusions) ? match.matchedConfusions.join('、') : '',
    missingCoreEntities: Array.isArray(match.missingCoreEntities) ? match.missingCoreEntities.join('、') : '',
    vectorScore: match.vectorScore ?? source?.similarity ?? source?.relevanceScore ?? source?.relevance_score ?? '',
    url,
  }
}

function extractCitationNumbers() {
  const text = extractReportPlainText()
  if (!text) return []
  const seen = new Set()
  const numbers = []
  const regex = /(?:\[|〔|【)(\d{1,3})(?:\]|〕|】)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const number = Number(match[1])
    if (!number || seen.has(number)) continue
    seen.add(number)
    numbers.push(number)
  }
  return numbers.sort((a, b) => a - b)
}

const reportCitationNumbers = computed(() => extractCitationNumbers())

function cleanReferenceText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[，,。.；;\s]+|[，,。.；;\s]+$/g, '')
    .trim()
}

function parseReferenceEntry(number, value) {
  const raw = cleanReferenceText(value)
  if (!number || !raw) return null
  const withoutLeadingNumber = cleanReferenceText(
    raw.replace(new RegExp(`^(?:\\\\[|〔|【)${number}(?:\\\\]|〕|】)\\s*`), ''),
  )
  if (!withoutLeadingNumber) return null
  const withoutUrl = cleanReferenceText(withoutLeadingNumber.replace(/https?:\/\/\S+/g, ''))
  const parts = withoutUrl.split(/[，,]/).map((part) => cleanReferenceText(part)).filter(Boolean)
  const sourceName = parts[0] || '--'
  const title = cleanReferenceText((parts[1] || withoutUrl).replace(/^["“”]+|["“”]+$/g, '')) || '--'
  return {
    sourceName,
    title,
    summary: withoutUrl || withoutLeadingNumber,
  }
}

const reportReferenceIndex = computed(() => {
  const refs = new Map()
  const html = props.generatedHtml || ''
  if (html) {
    const div = document.createElement('div')
    div.innerHTML = html
    const blocks = Array.from(div.querySelectorAll('p, li, div'))
      .map((node) => cleanReferenceText(node.textContent || ''))
      .filter(Boolean)
    for (const block of blocks) {
      const match = block.match(/^(?:\[|〔|【)(\d{1,3})(?:\]|〕|】)\s*(.+)$/)
      if (!match) continue
      const number = Number(match[1])
      if (!number || refs.has(number)) continue
      const parsed = parseReferenceEntry(number, block)
      if (parsed) refs.set(number, parsed)
    }
  }

  const text = extractReportPlainText()
  const marker = text.indexOf('参考资料索引')
  if (marker < 0) return refs
  const refText = text.slice(marker)
  const regex = /(?:\[|〔|【)(\d{1,3})(?:\]|〕|】)\s*([\s\S]*?)(?=(?:\[|〔|【)\d{1,3}(?:\]|〕|】)|$)/g
  let match
  while ((match = regex.exec(refText)) !== null) {
    const number = Number(match[1])
    if (!number || refs.has(number)) continue
    const parsed = parseReferenceEntry(number, `${match[0]}`)
    if (parsed) refs.set(number, parsed)
  }
  return refs
})

const sourceStats = computed(() => {
  const data = props.databaseSources
  const candidateHits = data?.totalHits || data?.queryPlan?.totalHits || data?.vectorPlan?.vectorHits || null
  const highValue = data?.vectorPlan?.vectorHits || data?.queryPlan?.strictHits || null
  const visibleSources = normalizedSources.value.length || null
  const extracted = data?.queryPlan?.contentRowsRead || null
  return { candidateHits, highValue, visibleSources, extracted }
})

function firstPositiveCount(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number
  }
  return null
}

function firstAvailableCount(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number >= 0) return number
  }
  return null
}

function loadedSourceCountFor(group) {
  if (activeSourceType.value === group) {
    if (sourceListLoading.value && sourceListTotal.value === null && !sourceListItems.value.length) return null
    return firstAvailableCount(sourceListTotal.value, sourceListItems.value.length)
  }
  return null
}

const sourceOverviewStats = computed(() => {
  const summary = sourceListSummary.value || {}
  const databaseRecall = firstAvailableCount(
    summary.databaseRecallCount,
    loadedSourceCountFor('database_recall'),
    normalizedSources.value.length,
  )
  const toolSearch = firstAvailableCount(
    summary.toolSearchCount,
    loadedSourceCountFor('tool_search'),
  )
  const structuredSources = firstPositiveCount(summary.structuredSourceCount, normalizedSources.value.length)
  const reportCitations = firstPositiveCount(summary.reportReferenceCount, reportCitationNumbers.value.length)
  const failed = normalizedSources.value.filter((item) => item.status === 'failed').length
  const extracted = props.databaseSources?.queryPlan?.contentRowsRead ||
    normalizedSources.value.filter((item) => item.status === 'extracted').length ||
    null
  const snippetOnly = typeof structuredSources === 'number'
    ? Math.max(structuredSources - (extracted || 0) - failed, 0)
    : normalizedSources.value.filter((item) => item.status === 'snippet_only' || item.status === 'used').length
  return {
    databaseRecall,
    toolSearch,
    reportCitations,
    structuredSources,
    extracted,
    snippetOnly: snippetOnly || null,
    failed: failed || null,
  }
})

const sourceTypeOptions = [
  { key: 'all', label: '全部' },
  { key: 'database_recall', label: '数据库检索工具' },
  { key: 'tool_search', label: '互联网搜索工具' },
  { key: 'report_refs', label: '最终引用' },
  { key: 'candidate_hits', label: '被过滤候选' },
]

const sourceKindOptions = ['全部', '官方文件', '媒体报道', '研究报告', '数据库记录', '数据库检索工具', '互联网搜索工具', '其他']
const sourceTimeOptions = [
  { key: 'all', label: '全部时间' },
  { key: '7d', label: '近 7 天', days: 7 },
  { key: '30d', label: '近 30 天', days: 30 },
  { key: '6m', label: '近 6 个月', days: 183 },
  { key: '1y', label: '近 1 年', days: 365 },
]
const sourceSortOptions = [
  { key: 'relevance', label: '按相关性排序' },
  { key: 'time', label: '按发布时间排序' },
  { key: 'authority', label: '按来源权威性排序' },
]

const sourceCardConfigs = computed(() => [
  {
    key: 'database_recall',
    title: '数据库检索工具',
    value: sourceOverviewStats.value.databaseRecall ?? '--',
    desc: '来自 PG 向量库 / 数据库检索',
    icon: '◎',
    tone: 'blue',
  },
  {
    key: 'tool_search',
    title: '互联网搜索工具',
    value: sourceOverviewStats.value.toolSearch ?? '--',
    desc: '来自联网检索和网页抽取',
    icon: '▤',
    tone: 'cyan',
  },
])

const activeSourceConfig = computed(() => {
  if (activeSourceType.value === 'all') {
    return {
      key: 'all',
      title: '全部信源',
      desc: '以下为当前报告可展示的全部信源记录。',
      emptyTitle: '暂无对应信源',
      emptyDesc: '当前报告暂无可展示的信源记录。',
    }
  }
  const base = sourceCardConfigs.value.find((item) => item.key === activeSourceType.value) || {
    key: activeSourceType.value,
    title: '',
    value: '--',
    desc: '',
  }
  const descriptions = {
    database_recall: ['数据库检索工具信源', '以下信源来自 PG 向量库或数据库检索，并已保留引用编号和结构化整理状态。', '暂无数据库检索工具信源', '当前报告没有数据库检索工具信源记录，您可以切换互联网搜索工具查看。'],
    tool_search: ['互联网搜索工具信源', '以下信源来自联网检索或正文抽取结果。', '暂无互联网搜索工具信源', '当前报告没有互联网搜索工具信源记录，您可以切换数据库检索工具查看。'],
    report_refs: ['报告引用信源', '以下信源来自报告正文中的参考编号和引用依据。', '暂无对应信源', '当前报告没有该类型的信源记录，您可以切换其他类型查看。'],
    structured_sources: ['结构化信源', '以下信源来自数据库或向量召回结果，已完成结构化整理。', '暂无对应信源', '当前报告没有该类型的信源记录，您可以切换其他类型查看。'],
    candidate_hits: ['候选命中信源', '以下内容为检索阶段命中的候选信源，尚未全部进入正文引用。', '暂无对应信源', '当前报告没有该类型的信源记录，您可以切换其他类型查看。'],
    extract_failed: ['抽取失败记录', '以下来源在正文抽取阶段失败，可能仅保留标题、摘要或 URL。', '暂无抽取失败记录', '本次任务未发现正文抽取失败的信源。'],
  }
  const [title, desc, emptyTitle, emptyDesc] = descriptions[base.key] || descriptions.database_recall
  return { ...base, title, desc, emptyTitle, emptyDesc }
})

const sourceListCountText = computed(() => {
  if (typeof sourceListTotal.value === 'number') return `共 ${sourceListTotal.value} 条`
  return sourceListItems.value.length ? `已加载 ${sourceListItems.value.length} 条` : ''
})

const resultInfoItems = computed(() => {
  const generatedAt = props.job?.completedAt || props.job?.updatedAt || props.job?.createdAt || ''
  const generatedText = generatedAt ? new Date(generatedAt).toLocaleString('zh-CN', { hour12: false }) : '--'
  const artifactStatus = artifactSyncLabel(props.job?.artifacts?.artifactSyncStatus)
  return [
    ['报告标题', props.title || props.job?.payload?.topic || '--'],
    ['报告类型', reportTypeLabel.value || '--'],
    ['任务编号', props.job?.jobId ? props.job.jobId.slice(0, 8) : '--'],
    ['生成时间', generatedText],
    ['状态', props.phase === 'done' || props.job?.status === 'succeeded' ? '已完成' : taskStatusLabel.value || '--'],
    ['产物同步', artifactStatus],
  ]
})

function artifactSyncLabel(status) {
  const value = String(status || '').toLowerCase()
  if (value === 'completed') return '报告可查看、可下载'
  if (value === 'syncing') return '正在同步报告产物'
  if (value === 'partial') return '报告正文可用'
  if (value === 'failed') return '报告产物同步失败'
  if (props.job?.status === 'succeeded' && props.job?.resultPath) return '报告可查看'
  if (props.job?.status === 'running') return '等待报告生成'
  return '--'
}

const technicalLogs = computed(() => {
  if (props.executionLogs?.length) return props.executionLogs
  return (props.processLogs || []).map((log, index) => ({
    id: `process-${index}`,
    summary: log,
    status: 'running',
  }))
})

const userProgressStages = [
  { key: 'plan', number: '1', icon: '01', title: '任务规划', desc: '整理编报要求、确定信源范围并拆解调研任务' },
  { key: 'database', number: '2', icon: '02', title: '数据库检索', desc: '优先召回 PG 向量库和数据库信源' },
  { key: 'research', number: '3', icon: '03', title: '资料采集', desc: '按规划补充公开信源并提取关键事实' },
  { key: 'consolidate', number: '4', icon: '04', title: '素材整合', desc: '汇总信源、证据和分析要点' },
  { key: 'report', number: '5', icon: '05', title: '报告撰写', desc: '撰写报告正文并完成校验' },
  { key: 'quality', number: '6', icon: '06', title: '成稿自检', desc: '检查主题一致性、信源依据、风险推理和写作质量' },
]

const deepCollectionProgressStage = {
  key: 'deep_collection',
  number: '4',
  icon: '04',
  title: '资料深度采集',
  desc: '调用深度编报资料采集 Skill 补充并核验公开资料',
}

function displayProgressStatus(status) {
  if (status === 'done') return 'done'
  if (status === 'running') return 'current'
  if (status === 'failed') return 'error'
  return 'waiting'
}

const backendProgressStageFlow = computed(() => {
  const stages = Array.isArray(props.progressState?.stages) ? props.progressState.stages : []
  if (!stages.length) return []
  const byKey = new Map(stages.map((stage) => [stage.key, stage]))
  const displayStages = byKey.has('deep_collection')
    ? [...userProgressStages.slice(0, 3), deepCollectionProgressStage, ...userProgressStages.slice(3)]
    : userProgressStages
  return displayStages.map((stage, index) => {
    const backendStage = byKey.get(stage.key)
    return {
      ...stage,
      number: String(index + 1),
      icon: String(index + 1).padStart(2, '0'),
      title: backendStage?.title || stage.title,
      desc: backendStage?.desc || stage.desc,
      status: displayProgressStatus(backendStage?.status),
      evidence: backendStage?.evidence || [],
    }
  })
})

const progressStageOrder = {
  CONNECTING: 0,
  TASK_START: 0,
  AGENT_START: 0,
  PREPARING: 0,
  PG_RECALL: 1,
  PLANNING: 0,
  HARNESS_PLAN: 0,
  RESEARCH_TASK: 2,
  WAITING_RESEARCH: 2,
  RESEARCHING: 2,
  RESEARCH_RUN: 2,
  RESEARCH_DONE: 2,
  SEARCHING: 2,
  EXTRACTING: 2,
  CONSOLIDATE: 3,
  ANALYZING: 3,
  SYNTHESIS_TASK: 3,
  WAITING_SYNTHESIS: 3,
  SYNTHESIS: 3,
  WRITING: 4,
  VERIFYING: 4,
  VALIDATE_SAVE: 4,
  SAVING: 4,
  QUALITY_REVIEW: 5,
  COMPLETED: 5,
}

function rawProgressStageIndex(rawLog) {
  const lower = String(rawLog || '').toLowerCase()
  if (!lower) return -1
  if (lower.includes('成稿自检') || lower.includes('quality_review')) return 5
  if (lower.includes('report_file: /') || lower.includes('validate_report.py') || lower.includes('report_file_recovered')) return 4
  if (lower.includes('synthesis_writing')) return 4
  if (lower.includes('synthesis')) return 3
  if (lower.includes('consolidated.json')) return 3
  if (lower.includes('harness_cli.py run') || lower.includes('research_') || lower.includes('research/research') || lower.includes('sessions_yield')) return 2
  if (lower.includes('harness_cli.py plan') || lower.includes('plan.json') || lower.includes('group_')) return 0
  if (lower.includes('pg-sources__query') || lower.includes('vector_sources.json') || lower.includes('database_sources.json') || lower.includes('database_query_plan.json')) return 1
  if (lower.includes('context.json') || lower.includes('preparing hermes gateway') || lower.includes('running hermes report-agent')) return 0
  return -1
}

function logProgressStageIndex(log) {
  const view = translateHermesLog(log)
  const stageIndex = progressStageOrder[view.stage]
  if (Number.isInteger(stageIndex)) return stageIndex
  return rawProgressStageIndex(view.raw)
}

const resolvedProgressStageStatuses = computed(() => {
  const isDone = props.job?.status === 'succeeded' || props.phase === 'done'
  const isFailed = props.job?.status === 'failed' || props.phase === 'error'
  let activeIndex = props.job?.jobId || props.phase === 'loading' ? 0 : -1

  for (const log of technicalLogs.value) {
    const stageIndex = logProgressStageIndex(log)
    if (stageIndex > activeIndex) activeIndex = stageIndex
  }

  if (isDone) return userProgressStages.map(() => 'done')

  return userProgressStages.map((_, index) => {
    if (activeIndex < 0) return 'waiting'
    if (isFailed) {
      if (index < activeIndex) return 'done'
      if (index === activeIndex) return 'error'
      return 'waiting'
    }
    if (index < activeIndex) return 'done'
    if (index === activeIndex) return 'current'
    return 'waiting'
  })
})

const progressStageFlow = computed(() => {
  if (backendProgressStageFlow.value.length) return backendProgressStageFlow.value
  return userProgressStages.map((stage, index) => ({
    ...stage,
    status: resolvedProgressStageStatuses.value[index],
  }))
})

const executionTaskCards = computed(() => progressStageFlow.value.map((stage) => ({
  ...stage,
  icon: stage.icon || stage.number,
})))

const overallProgressStatus = computed(() => {
  if (progressStageFlow.value.some((stage) => stage.status === 'error')) return 'error'
  if (progressStageFlow.value.every((stage) => stage.status === 'done')) return 'done'
  if (progressStageFlow.value.some((stage) => stage.status === 'current')) return 'current'
  return 'waiting'
})

function progressStatusLabel(status) {
  if (status === 'done') return '已完成'
  if (status === 'current') return '进行中'
  if (status === 'error') return '异常'
  return '未开始'
}

function extractReportPlainText() {
  return htmlToPlainText(props.generatedHtml || '')
}

function chapterForCitation(text, matchIndex) {
  const before = text.slice(0, matchIndex)
  const headingMatches = [...before.matchAll(/(?:^|\n)\s*(一、[^。\n]+|二、[^。\n]+|三、[^。\n]+|四、[^。\n]+|五、[^。\n]+)/g)]
  const last = headingMatches[headingMatches.length - 1]
  return last?.[1]?.trim() || '--'
}

const citationItems = computed(() => {
  const text = extractReportPlainText()
  if (!text) return []
  return acceptedCitationSources.value.map((source, index) => {
    const number = Number(source.citationNo) || index + 1
    const match = text.match(new RegExp(`(?:\\\\[|〔|【)${number}(?:\\\\]|〕|】)`))
    return {
      number,
      chapter: chapterForCitation(text, match?.index || 0),
      title: source.title || '--',
      sourceName: source.sourceName || '--',
      method: source.method || '后端 accepted 引用',
      credibility: source.relevance || '--',
      summary: source.summary || '当前引用已通过后端信源校验。',
    }
  })
})

function formatDbSourceTime(value) {
  if (!value) return ''
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleDateString('zh-CN')
  } catch {
    return String(value)
  }
}

function firstText(source, keys, fallback = '') {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return fallback
}

function scrubSourceDisplayText(value) {
  return sanitizeSourceDisplayText(value)
}

function inferSourceGroup(source, fallbackGroup = activeSourceType.value) {
  return resolveSourceGroup(source, fallbackGroup)
}

function normalizeSourceListItem(source, index, fallbackGroup = activeSourceType.value) {
  const url = firstText(source, ['url', 'source_url', 'data_source_url', 'sourceUrl'], '')
  const title = firstSourceDisplayText(source, ['title', 'ch_title', 'headline', 'sourceTitle', 'name'], url || '未命名信源')
  const summary = firstSourceDisplayText(source, ['summary', 'abstract', 'description', 'snippet', 'finding', 'claim', 'content_preview'], '当前信源暂无摘要。')
  const detail = firstSourceDisplayText(source, ['excerpt', 'content_excerpt', 'chunk_text', 'content_chunk', 'body', 'content', 'markdown', 'fullText', 'text', 'detail', 'content_preview'], '')
  const sourceName = firstSourceDisplayText(
    source,
    ['publisher', 'website_name', 'source_name', 'site_name', 'sourceName', 'source', 'websiteName'],
    sourceHostname(url) || '来源未知',
  )
  const publishRaw = firstText(source, ['published_at', 'publish_time', 'pub_time', 'source_time', 'publishTime', 'publishedAt', 'time'], '')
  const sourceGroup = inferSourceGroup(source, fallbackGroup)
  const sourceType = sourceGroup === 'tool_search'
    ? '互联网搜索工具'
    : normalizeSourceKind(firstText(source, ['source_type', 'type', 'tag', 'designated_tag', 'sourceType'], '其他'), source)
  const status = scrubSourceDisplayText(firstText(source, ['status', 'extract_status', 'source_status'], ''))
  const method = scrubSourceDisplayText(firstText(source, ['method', 'retrievalMode', 'collection_method'], ''))
  const failedReason = scrubSourceDisplayText(firstText(source, ['failedReason', 'failure_reason', 'error', 'message', 'note'], ''))
  const score = source?.sourcePriority ?? source?.source_priority ?? source?.relevance_score ?? source?.relevanceScore ?? source?.score ?? source?.similarity ?? source?.rank_score ?? source?.relevance ?? null
  const id = firstText(source, ['id', 'sourceId', 'source_id', 'mysql_id'], `${sourceGroup}-${url || title}-${index}`)
  return {
    id: String(id),
    sourceGroup,
    title,
    summary,
    detail,
    url,
    sourceName,
    publishRaw,
    publishTime: formatDbSourceTime(publishRaw) || '时间未知',
    sourceType,
    status,
    method,
    engine: firstText(source, ['engine', 'search_engine', 'provider'], ''),
    sourceOrigin: firstText(source, ['sourceOrigin', 'source_origin'], sourceGroup),
    evidenceKind: firstText(source, ['evidenceKind', 'evidence_kind'], ''),
    failedReason,
    authorityScore: inferAuthorityScore(sourceName, sourceType),
    numericScore: normalizeNumericScore(score),
    relevance: formatSourceListScore(score),
  }
}

function normalizeSourceKind(value, source = null) {
  const engine = String(source?.engine || source?.search_engine || source?.provider || '').trim().toLowerCase()
  const origin = String(source?.sourceOrigin || source?.source_origin || source?.sourceGroup || '').trim().toLowerCase()
  if (engine === 'controlled_fetch' || /controlled_fetch/.test(origin)) return '互联网搜索工具'
  if (engine === 'exa') return '互联网搜索工具'
  if (engine === 'firecrawl') return '互联网搜索工具'
  if (engine === 'tavily_extract') return '互联网搜索工具'
  if (engine === 'tavily') return '互联网搜索工具'
  if (engine === 'pg_vector' || /database_recall|pg_vector|vector/.test(origin)) return '数据库检索工具'
  const text = String(value || '').trim()
  if (!text) return '其他'
  if (/controlled_fetch/i.test(text)) return '互联网搜索工具'
  if (/exa|firecrawl|tavily/i.test(text)) return '互联网搜索工具'
  if (/pg|向量|vector/i.test(text)) return '数据库检索工具'
  if (/官方|政府|公告|声明|文件|policy|gov/i.test(text)) return '官方文件'
  if (/媒体|新闻|报道|news|media/i.test(text)) return '媒体报道'
  if (/研究|报告|智库|analysis|report|think/i.test(text)) return '研究报告'
  if (/数据库|向量|记录|database|vector|db/i.test(text)) return '数据库记录'
  return text.length > 8 ? '其他' : text
}

function normalizeNumericScore(value) {
  if (value === undefined || value === null || value === '') return 0
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return number <= 1 ? number * 100 : number
}

function inferAuthorityScore(sourceName, sourceType) {
  const text = `${sourceName || ''} ${sourceType || ''}`
  if (/官方|政府|部|署|局|委员会|office|department|commission|gov/i.test(text)) return 100
  if (/研究|智库|院|所|institute|research|think/i.test(text)) return 82
  if (/新闻|报|社|media|news|reuters|bloomberg/i.test(text)) return 68
  return 50
}

function formatSourceListScore(value) {
  if (value === undefined || value === null || value === '') return ''
  const number = Number(value)
  if (Number.isFinite(number)) {
    if (number <= 1) return `${Math.round(number * 100)}%`
    return number.toFixed(number % 1 === 0 ? 0 : 2)
  }
  return String(value)
}

function normalizeSourceListResponse(response, fallbackGroup = activeSourceType.value) {
  const list = Array.isArray(response)
    ? response
    : Array.isArray(response?.items)
      ? response.items
      : Array.isArray(response?.sources)
        ? response.sources
        : Array.isArray(response?.results)
          ? response.results
          : Array.isArray(response?.data)
            ? response.data
            : []
  const total = response && !Array.isArray(response)
    ? response.total ?? response.count ?? response.totalCount ?? null
    : null
  const hasMore = response && !Array.isArray(response)
    ? Boolean(response.hasMore ?? response.has_more ?? false)
    : false
  return {
    items: list.map((item, index) => normalizeSourceListItem(item, index, fallbackGroup)),
    total: typeof total === 'number' ? total : Number.isFinite(Number(total)) ? Number(total) : null,
    hasMore,
  }
}

function sourceRequestType(type = activeSourceType.value) {
  if (type === 'all') return ''
  return type || 'database_recall'
}

function sourceCandidateHitTotal() {
  const data = props.databaseSources || {}
  const values = [
    data.totalHits,
    data.total_hits,
    data.queryPlan?.totalHits,
    data.queryPlan?.total_hits,
    data.queryPlan?.relevantHits,
    data.queryPlan?.relevant_hits,
    data.vectorPlan?.vectorHits,
    data.vectorPlan?.totalHits,
  ]
  const found = values.find((value) => Number.isFinite(Number(value)) && Number(value) > 0)
  return found ? Number(found) : 0
}

function candidateDetailNotice(items) {
  const total = sourceCandidateHitTotal()
  if (items.length) return total > items.length ? `候选池共 ${total} 条，当前展示 ${items.length} 条真实候选明细。` : ''
  return total ? `候选池共 ${total} 条，当前历史任务未保存候选明细。` : ''
}

function localSourcePool(type = activeSourceType.value) {
  const citationSources = citationItems.value.map((item, index) => normalizeSourceListItem({
    id: `citation-${item.number}`,
    sourceGroup: 'tool_search',
    sourceOrigin: 'tool_search',
    evidenceKind: 'report_reference',
    title: item.title,
    source_name: item.sourceName,
    summary: item.summary,
    source_type: '报告引用',
    relevance_score: item.credibility === '高' ? 95 : 78,
    method: item.method,
  }, index))

  const structuredSources = normalizedSources.value.map((item, index) => normalizeSourceListItem({
    id: item.id,
    sourceGroup: item.status === 'failed' ? 'extract_failed' : 'database_recall',
    sourceOrigin: item.status === 'failed' ? '' : 'database_recall',
    evidenceKind: 'structured_source',
    title: item.title,
    source_name: item.sourceName,
    publish_time: item.publishTime,
    summary: item.summary,
    excerpt: item.note,
    url: item.url,
    source_type: item.sourceType,
    relevance_score: item.relevance === '高相关' ? 92 : 72,
    status: item.status,
    method: item.method,
    failedReason: item.status === 'failed' ? item.note : '',
  }, index))

  const candidateSources = []

  const logFailures = technicalLogs.value
    .filter((log) => /fail|error|失败|错误/i.test(`${log.status || ''} ${log.summary || ''} ${log.message || ''}`))
    .map((log, index) => normalizeSourceListItem({
      id: `log-failed-${log.id || index}`,
      sourceGroup: 'extract_failed',
      title: log.label || log.stage || '抽取失败记录',
      summary: log.summary || log.message || '该来源在处理阶段未能完成正文抽取。',
      source_type: '其他',
      status: 'failed',
      failedReason: log.summary || log.message || '',
      method: log.phase || '',
    }, index))

  const grouped = {
    database_recall: structuredSources.filter((item) => item.sourceGroup !== 'extract_failed'),
    tool_search: citationSources,
    report_refs: citationSources,
    structured_sources: structuredSources.filter((item) => item.sourceGroup !== 'extract_failed'),
    candidate_hits: candidateSources,
    extract_failed: [
      ...structuredSources.filter((item) => item.sourceGroup === 'extract_failed'),
      ...logFailures,
    ],
  }

  if (type === 'all') return [
    ...grouped.database_recall,
    ...grouped.tool_search,
  ].sort((a, b) => b.numericScore - a.numericScore)
  return grouped[type] || []
}

function mergeLocalFallback(items, type = activeSourceType.value) {
  if (items.length) return items
  return localSourcePool(type)
}

function sourceMatchesTime(source) {
  const option = sourceTimeOptions.find((item) => item.key === sourceTimeFilter.value)
  if (!option?.days || !source.publishRaw) return true
  const time = new Date(source.publishRaw).getTime()
  if (!Number.isFinite(time)) return true
  return Date.now() - time <= option.days * 24 * 60 * 60 * 1000
}

const filteredSourceRows = computed(() => {
  const query = sourceSearchQuery.value.trim().toLowerCase()
  const rows = sourceListItems.value.filter((source) => {
    const searchable = `${source.title} ${source.sourceName} ${source.summary} ${source.detail} ${source.sourceType}`.toLowerCase()
    if (activeSourceType.value === 'all' && ['candidate_hits', 'extract_failed', 'report_refs', 'structured_sources'].includes(source.sourceGroup)) return false
    if (query && !searchable.includes(query)) return false
    if (sourceKindFilter.value !== '全部' && source.sourceType !== sourceKindFilter.value) return false
    if (!sourceMatchesTime(source)) return false
    return true
  })

  return [...rows].sort((a, b) => {
    if (sourceSortMode.value === 'time') {
      return new Date(b.publishRaw || 0).getTime() - new Date(a.publishRaw || 0).getTime()
    }
    if (sourceSortMode.value === 'authority') return b.authorityScore - a.authorityScore
    return b.numericScore - a.numericScore
  })
})

const sourceTotalPages = computed(() => Math.max(1, Math.ceil(filteredSourceRows.value.length / sourceListPageSize.value)))
const paginatedSourceRows = computed(() => {
  const start = (sourceCurrentPage.value - 1) * sourceListPageSize.value
  return filteredSourceRows.value.slice(start, start + sourceListPageSize.value)
})
const currentSourceEmptyTitle = computed(() => activeSourceConfig.value.emptyTitle || '暂无对应信源')
const currentSourceEmptyDesc = computed(() => {
  if (activeSourceType.value === 'candidate_hits' && sourceListNotice.value) return sourceListNotice.value
  return activeSourceConfig.value.emptyDesc || '当前报告没有该类型的信源记录，您可以切换其他类型查看。'
})

function resetSourceListState({ preserveSummary = false } = {}) {
  sourceListRequestId += 1
  sourceListItems.value = []
  sourceListPage.value = 1
  sourceListTotal.value = null
  sourceListHasMore.value = false
  if (!preserveSummary) sourceListSummary.value = null
  if (!preserveSummary) sourceListDiagnostics.value = null
  sourceCurrentPage.value = 1
  sourceListError.value = ''
  sourceListNotice.value = ''
  expandedSourceListId.value = ''
}

function scrollSourceListToTop() {
  nextTick(() => {
    if (sourceListRef.value) sourceListRef.value.scrollTop = 0
  })
}

async function loadSourceListPage(page = 1) {
  const jobId = props.job?.jobId
  if (!jobId || !activeSourceType.value || (sourceListLoading.value && page > 1)) return
  const requestId = sourceListRequestId + 1
  sourceListRequestId = requestId
  const requestType = activeSourceType.value
  sourceListLoading.value = true
  sourceListError.value = ''
  sourceListNotice.value = ''
  try {
    let response
    let usedUntypedFallback = false
    try {
      response = await fetchReportSources(jobId, sourceRequestType(requestType), {
        page,
        pageSize: sourceListPageSize.value,
      })
    } catch {
      usedUntypedFallback = true
      response = await fetchReportSources(jobId, '', {
        page,
        pageSize: sourceListPageSize.value,
      })
    }
    if (requestId !== sourceListRequestId || requestType !== activeSourceType.value || jobId !== props.job?.jobId) return
    const fallbackGroup = usedUntypedFallback
      ? 'all'
      : requestType
    const normalized = normalizeSourceListResponse(response, fallbackGroup)
    sourceListSummary.value = response?.meta?.summary || sourceListSummary.value
    sourceListDiagnostics.value = response?.meta?.sourceDiagnostics || sourceListDiagnostics.value
    const typedItems = requestType === 'all'
      ? normalized.items
      : normalized.items.filter((item) => item.sourceGroup === requestType)
    const nextItems = mergeLocalFallback(typedItems, requestType)
    sourceListItems.value = page === 1
      ? nextItems
      : [...sourceListItems.value, ...nextItems]
    if (requestType === 'candidate_hits' && page === 1) {
      sourceListNotice.value = response?.meta?.message || candidateDetailNotice(nextItems)
    }
    sourceListPage.value = page
    sourceCurrentPage.value = 1
    sourceListTotal.value = requestType === 'candidate_hits'
      ? (!usedUntypedFallback && normalized.total !== null ? normalized.total : (sourceCandidateHitTotal() || sourceListItems.value.length))
      : (normalized.total ?? sourceListItems.value.length)
    sourceListHasMore.value = normalized.hasMore ||
      (typeof normalized.total === 'number' && sourceListItems.value.length < normalized.total)
  } catch {
    if (requestId !== sourceListRequestId || requestType !== activeSourceType.value || jobId !== props.job?.jobId) return
    const fallback = localSourcePool(requestType)
    if (fallback.length) {
      sourceListItems.value = page === 1 ? fallback : [...sourceListItems.value, ...fallback]
      sourceListPage.value = page
      sourceCurrentPage.value = 1
      if (requestType === 'candidate_hits' && page === 1) {
        sourceListNotice.value = candidateDetailNotice(fallback)
      }
      sourceListTotal.value = requestType === 'candidate_hits'
        ? (sourceCandidateHitTotal() || sourceListItems.value.length)
        : sourceListItems.value.length
      sourceListHasMore.value = false
    } else if (requestType === 'candidate_hits' && sourceCandidateHitTotal() > 0) {
      sourceListItems.value = page === 1 ? [] : sourceListItems.value
      sourceListPage.value = page
      sourceCurrentPage.value = 1
      sourceListTotal.value = sourceCandidateHitTotal()
      sourceListNotice.value = `候选池共 ${sourceCandidateHitTotal()} 条，当前历史任务未保存候选明细。`
      sourceListHasMore.value = false
    } else {
      sourceListError.value = '信源加载失败，请稍后重试。'
      sourceListHasMore.value = false
    }
  } finally {
    if (requestId === sourceListRequestId) sourceListLoading.value = false
  }
}

async function loadMoreSourceRows() {
  await loadSourceListPage(sourceListPage.value + 1)
}

async function loadAcceptedCitationSources() {
  const jobId = props.job?.jobId
  if (!jobId || acceptedCitationSourcesLoading.value) return
  acceptedCitationSourcesLoading.value = true
  try {
    const response = await fetchReportSources(jobId, 'report_refs', { page: 1, pageSize: 100 })
    const rawItems = Array.isArray(response?.items) ? response.items : []
    acceptedCitationSources.value = filterAcceptedReportReferences(rawItems).map((item, index) => ({
      ...normalizeSourceListItem(item, index, 'report_refs'),
      citationNo: item.citationNo ?? item.citation_no ?? index + 1,
      matchStatus: item.matchStatus ?? item.match_status ?? '',
    }))
  } catch {
    acceptedCitationSources.value = []
  } finally {
    acceptedCitationSourcesLoading.value = false
  }
}

function reloadSourceRows() {
  resetSourceListState({ preserveSummary: true })
  scrollSourceListToTop()
  loadSourceListPage(1)
}

function setSourcePage(page) {
  sourceCurrentPage.value = Math.min(Math.max(page, 1), sourceTotalPages.value)
  scrollSourceListToTop()
}

function visibleSourcePages() {
  const total = sourceTotalPages.value
  const current = sourceCurrentPage.value
  const pages = new Set([1, total, current, current - 1, current + 1])
  return Array.from(pages)
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b)
}

function handleSourceFiltersChanged() {
  sourceCurrentPage.value = 1
  expandedSourceListId.value = ''
  scrollSourceListToTop()
}

function selectSourceType(type) {
  if (!props.job?.jobId) return
  activeSourceType.value = type
  resetSourceListState({ preserveSummary: true })
  scrollSourceListToTop()
  loadSourceListPage(1)
}

function toggleSourceListItem(sourceId) {
  expandedSourceListId.value = expandedSourceListId.value === sourceId ? '' : sourceId
}

function sourceToBackgroundText(source) {
  return [
    `信源标题：${source.title}`,
    `来源：${source.sourceName}`,
    `发布时间：${source.publishTime}`,
    source.url ? `URL：${source.url}` : '',
    `摘要：${source.summary}`,
    source.detail ? `详情：${source.detail}` : '',
  ].filter(Boolean).join('\n')
}

async function copySourceListItem(source) {
  const text = sourceToBackgroundText(source)
  await navigator.clipboard?.writeText(text)
  sourceListNotice.value = '信源内容已复制'
  window.setTimeout(() => {
    sourceListNotice.value = ''
  }, 1800)
}

function importSourceListItemAsReportContext(source) {
  const context = sourceToBackgroundText(source)
  emit('new-report')
  nextTick(() => {
    homeMode.value = 'report'
    emit('update:title', source.title.slice(0, 200))
    emit('update:contextText', context)
    qaImportNotice.value = '已作为编报背景导入'
  })
}

function scrollToTop() {
  nextTick(() => {
    if (reportRef.value) {
      reportRef.value.scrollTop = 0
    }
  })
}

function setActiveResultTab(tabKey) {
  activeResultTab.value = tabKey
}

function handleResultTabWheel(event) {
  if (!resultTabs.length) return
  if (Math.abs(event.deltaY) < 12) return

  const now = Date.now()
  if (now < resultTabWheelLockedUntil) {
    event.preventDefault()
    return
  }

  const currentIndex = Math.max(0, resultTabs.findIndex((tab) => tab.key === activeResultTab.value))
  const nextIndex = Math.min(resultTabs.length - 1, Math.max(0, currentIndex + (event.deltaY > 0 ? 1 : -1)))
  if (nextIndex === currentIndex) return

  event.preventDefault()
  resultTabWheelLockedUntil = now + 420
  activeResultTab.value = resultTabs[nextIndex].key
}

function getLogTarget(kind) {
  return kind === 'drawer' ? drawerLogListRef.value : liveLogListRef.value
}

function getLogStickRef(kind) {
  return kind === 'drawer' ? drawerLogShouldStick : liveLogShouldStick
}

function getLogNewItemsRef(kind) {
  return kind === 'drawer' ? drawerLogHasNewItems : liveLogHasNewItems
}

function isLogNearBottom(target) {
  if (!target) return false
  return target.scrollHeight - target.scrollTop - target.clientHeight < 80
}

function scrollLogToBottom(kind) {
  nextTick(() => {
    const target = getLogTarget(kind)
    if (!target) return
    requestAnimationFrame(() => {
      target.scrollTop = target.scrollHeight
      getLogStickRef(kind).value = true
      getLogNewItemsRef(kind).value = false
    })
  })
}

function maybeScrollLogToBottom(kind) {
  nextTick(() => {
    const target = getLogTarget(kind)
    if (!target) return
    const shouldStick = getLogStickRef(kind)
    const hasNewItems = getLogNewItemsRef(kind)
    if (shouldStick.value || isLogNearBottom(target)) {
      requestAnimationFrame(() => {
        target.scrollTop = target.scrollHeight
        shouldStick.value = true
        hasNewItems.value = false
      })
    } else {
      hasNewItems.value = true
    }
  })
}

function handleLogScroll(kind, event) {
  const target = event.currentTarget
  if (!target) return
  const nearBottom = isLogNearBottom(target)
  getLogStickRef(kind).value = nearBottom
  if (nearBottom) getLogNewItemsRef(kind).value = false
}

function handleGeneratedHtmlChange() {
  if (props.phase === 'done') {
    scrollToTop()
    return
  }
}

watch(() => props.generatedHtml, handleGeneratedHtmlChange)
watch(() => [props.phase, props.isHistoryMode], () => {
  if (props.phase === 'done') scrollToTop()
})
watch(() => [props.phase, props.job?.jobId], () => {
  if (props.phase === 'done') activeResultTab.value = 'report'
  activeSourceType.value = 'all'
  acceptedCitationSources.value = []
  acceptedCitationSourcesLoading.value = false
  qualityReview.value = null
  qualityReviewError.value = ''
  qualityReviewNotice.value = ''
  resetSourceListState()
})
watch(() => activeResultTab.value, (tab) => {
  if (tab === 'sources' && props.job?.jobId && !sourceListItems.value.length && !sourceListLoading.value) {
    selectSourceType(activeSourceType.value || 'database_recall')
  }
  if (tab === 'citations' && props.job?.jobId && !acceptedCitationSources.value.length && !acceptedCitationSourcesLoading.value) {
    loadAcceptedCitationSources()
  }
  if (tab === 'quality' && props.job?.jobId && !qualityReview.value && !qualityReviewLoading.value) {
    loadQualityReview()
  }
})
watch([sourceSearchQuery, sourceKindFilter, sourceTimeFilter, sourceSortMode], handleSourceFiltersChanged)
watch(() => props.processLogs?.length || 0, () => {
  if (isLiveLogVisible.value) maybeScrollLogToBottom('live')
})
watch(() => props.executionLogs.length, () => {
  if (isLiveLogVisible.value) maybeScrollLogToBottom('live')
  if (showLogDrawer.value) maybeScrollLogToBottom('drawer')
})
watch(() => props.isLogDrawerOpen, (open) => {
  if (open) maybeScrollLogToBottom('drawer')
})
watch(isLiveLogVisible, (visible) => {
  if (visible) maybeScrollLogToBottom('live')
}, { immediate: true })
watch(() => qaAnswer.value, () => {
  if (homeMode.value === 'qa') maybeScrollQaThreadToBottom()
})
watch(() => qaStatus.value, () => {
  if (homeMode.value === 'qa') maybeScrollQaThreadToBottom()
})
watch([qaSourceSearch, qaSourceTypeFilter], () => {
  qaSourcePage.value = 1
})
watch(() => qaReferencePayloads.value.length, () => {
  qaSourcePage.value = 1
  if (homeMode.value === 'qa' && qaReferenceItems.value.length > 0 && !qaSourceSidebarDismissed.value) {
    qaSourceSidebarOpen.value = true
  }
})
watch(() => props.selectedQaSession?.id, () => {
  if (props.selectedQaSession) restoreQaSession(props.selectedQaSession)
})
watch(() => props.homeMode, (mode) => {
  if (mode === 'qa' && qaReferenceItems.value.length > 0 && !qaSourceSidebarDismissed.value) {
    qaSourceSidebarOpen.value = true
  }
  nextTick(() => {
    if (mode === 'qa') qaInputRef.value?.focus()
    if (mode === 'report' && props.phase === 'idle') titleInputRef.value?.focus()
  })
})

onMounted(() => {
  ensureReportDefaults()
  window.addEventListener('scroll', handleQaPageScroll, { passive: true })
  window.addEventListener('keydown', handleQaGuideKeydown)
  nextTick(() => {
    reportRef.value?.addEventListener('scroll', handleQaPageScroll, { passive: true })
  })
})

watch(() => props.phase, (phase) => {
  if (phase === 'idle') {
    titleValidationError.value = ''
    ensureReportDefaults()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleQaPageScroll)
  window.removeEventListener('keydown', handleQaGuideKeydown)
  reportRef.value?.removeEventListener('scroll', handleQaPageScroll)
  closeAllQaStreams()
})

function htmlToPlainText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent || div.innerText || ''
}

function collectInlineRuns(node, TextRun, options = {}) {
  const { size = 24, font = 'SimSun' } = options
  const segments = []

  function pushText(text, marks) {
    const normalized = String(text || '').replace(/\s+/g, ' ')
    if (normalized) segments.push({ text: normalized, ...marks })
  }

  function walk(current, marks = {}) {
    if (current.nodeType === Node.TEXT_NODE) {
      pushText(current.textContent, marks)
      return
    }

    if (current.nodeType !== Node.ELEMENT_NODE) return

    const tag = current.tagName.toLowerCase()
    if (tag === 'br') {
      segments.push({ break: 1 })
      return
    }

    const nextMarks = {
      ...marks,
      bold: marks.bold || tag === 'strong' || tag === 'b',
      italics: marks.italics || tag === 'em' || tag === 'i',
      underline: marks.underline || tag === 'u',
    }
    for (const child of current.childNodes) walk(child, nextMarks)
  }

  for (const child of node.childNodes) walk(child)

  const firstText = segments.find((segment) => segment.text)
  if (firstText) firstText.text = firstText.text.trimStart()
  const lastText = [...segments].reverse().find((segment) => segment.text)
  if (lastText) lastText.text = lastText.text.trimEnd()

  return segments
    .filter((segment) => segment.break || segment.text)
    .map((segment) => new TextRun({
      ...(segment.break ? { break: segment.break } : { text: segment.text }),
      size,
      font,
      bold: segment.bold || undefined,
      italics: segment.italics || undefined,
      underline: segment.underline ? {} : undefined,
    }))
}

function collectDocxBlocks(html, docx) {
  const { Paragraph, TextRun, Table, TableCell, TableRow, WidthType, HeadingLevel, AlignmentType, BorderStyle } = docx
  const root = document.createElement('div')
  root.innerHTML = DOMPurify.sanitize(html || '', purifyConfig)
  const blocks = []

  for (const node of root.children) {
    const tag = node.tagName.toLowerCase()
    const text = node.textContent?.trim() || ''
    if (!text && tag !== 'table') continue

    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      blocks.push(
        new Paragraph({
          text,
          heading: tag === 'h1' ? HeadingLevel.HEADING_1 : tag === 'h2' ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 },
        }),
      )
    } else if (tag === 'ul' || tag === 'ol') {
      for (const li of node.querySelectorAll('li')) {
        blocks.push(
          new Paragraph({
            children: collectInlineRuns(li, TextRun),
            bullet: tag === 'ul' ? { level: 0 } : undefined,
            numbering: tag === 'ol' ? { reference: 'default-numbering', level: 0 } : undefined,
            spacing: { after: 80 },
          }),
        )
      }
    } else if (tag === 'table') {
      const rows = [...node.querySelectorAll('tr')].map((tr) => {
        const cells = [...tr.children].map((cell) =>
          new TableCell({
            children: [
              new Paragraph({
                children: collectInlineRuns(cell, TextRun, { size: 20 }),
              }),
            ],
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
              left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
              right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            },
          }),
        )
        return new TableRow({ children: cells })
      })
      if (rows.length) {
        blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))
      }
    } else {
      blocks.push(
        new Paragraph({
          children: collectInlineRuns(node, TextRun),
          alignment: AlignmentType.JUSTIFIED,
          indent: { firstLine: 480 },
          spacing: { after: 160 },
        }),
      )
    }
  }

  return blocks.length
    ? blocks
    : htmlToPlainText(html)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => new Paragraph({ text: line }))
}

async function exportWord() {
  if (!canExport.value) return

  const docx = await import('docx')
  const { saveAs } = await import('file-saver')
  const { Document, AlignmentType, Packer } = docx

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [
      {
        children: collectDocxBlocks(props.generatedHtml, docx),
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${props.title || props.job?.jobId || 'report'}.docx`)
}

function exportPdf() {
  if (!canExport.value) return

  const safeHtml = DOMPurify.sanitize(props.generatedHtml || '', purifyConfig)
  const safeTitle = DOMPurify.sanitize(props.title || '报告', { ALLOWED_TAGS: [] })
  const printWindow = window.open('', '_blank')
  if (!printWindow) return

  printWindow.document.write(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: "Microsoft YaHei", SimSun, sans-serif; color: #111; padding: 40px; line-height: 1.75; }
    h1 { text-align: center; font-size: 24px; }
    h2 { color: #0f4c81; border-bottom: 1px solid #0f4c81; padding-bottom: 6px; }
    h3 { color: #0f4c81; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ccc; padding: 8px; vertical-align: top; }
    blockquote { border-left: 4px solid #999; padding-left: 12px; color: #555; }
    @media print { body { padding: 24px; } }
  </style>
</head>
<body>
  ${safeHtml}
</body>
</html>`)
  printWindow.document.close()
  printWindow.onload = () => printWindow.print()
}
</script>

<template>
  <main class="data-canvas flex-1 flex flex-col overflow-hidden relative">
    <div class="workspace-subbar h-14 flex items-center justify-between px-5">
      <div class="workspace-meta flex items-center gap-3">
        <span class="font-mono text-[10px] tracking-widest text-[#374151]">
          [ {{ isHistoryMode ? '历史报告查看' : '数据输出终端' }} ]
        </span>
        <span v-if="phase !== 'idle'" class="font-mono text-[10px] text-neon-green">
          {{ reportTypeLabel }} / {{ isHistoryDetailLoading ? '加载中' : isHistoryDetailError ? '加载失败' : phase === 'done' ? '已完成' : phase === 'error' ? '失败' : '处理中' }}
        </span>
        <span v-if="job?.jobId" class="font-mono text-[10px] text-slate-500">
          JOB {{ job.jobId.slice(0, 8) }}
        </span>
      </div>

      <div class="workspace-actions flex items-center gap-2">
        <button
          v-if="hasReturnableWorkspace"
          @click="emit('show-active-workspace')"
          class="sci-btn text-[10px] px-3 py-2 border-neon-green text-neon-green"
        >
          返回生成编报
        </button>
        <template v-if="phase === 'idle' && homeMode === 'qa'">
          <button class="sci-btn text-[10px] px-3 py-2" type="button" title="查看 QA问答使用指南" @click="openQaGuide">
            使用指南
          </button>
          <button class="sci-btn text-[10px] px-3 py-2" type="button" @click="clearQaWorkspace">
            清空问答
          </button>
          <button class="sci-btn text-[10px] px-3 py-2" type="button" @click="selectHomeMode('report')">
            返回编写
          </button>
          <button class="sci-btn text-[10px] px-3 py-2" type="button" disabled title="知识问答内容不支持直接导出，请先作为编报背景生成报告。">
            导出 Word
          </button>
          <button class="sci-btn text-[10px] px-3 py-2" type="button" disabled title="知识问答内容不支持直接导出，请先作为编报背景生成报告。">
            导出 PDF
          </button>
        </template>
        <template v-else-if="phase !== 'done' && !isHistoryDetailLoading && !isHistoryDetailError">
          <button
            v-if="phase === 'loading'"
            class="sci-btn text-[10px] px-3 py-2 border-neon-green text-neon-green"
            type="button"
            @click="selectHomeMode('qa')"
          >
            QA问答
          </button>
          <button v-if="showNewReportButton" @click="emit('new-report')" class="sci-btn text-[10px] px-3 py-2">
            清屏并开启下一个编报
          </button>
          <button @click="exportWord" :disabled="!canExport" class="sci-btn text-[10px] px-3 py-2" :title="canExport ? '导出 Word' : '报告生成后可导出'">导出 Word</button>
          <button
            @click="exportPdf"
            :disabled="!canExport"
            class="sci-btn text-[10px] px-3 py-2"
            :title="canExport ? '导出 PDF' : '报告生成后可导出'"
          >
            导出 PDF
          </button>
          <button @click="emit('list')" class="sci-btn text-[10px] px-3 py-2">报告列表</button>
        </template>
      </div>
    </div>

      <aside
        v-if="showLogDrawer"
        class="log-drawer-panel absolute right-0 top-14 bottom-0 z-20 w-[420px] max-w-[calc(100%-1rem)] border-l backdrop-blur overflow-hidden flex flex-col"
      >
        <div class="h-12 border-b border-border-glow flex items-center justify-between px-4">
          <div>
            <div class="font-mono text-xs neon-text tracking-widest">任务进度</div>
            <div class="font-mono text-[10px] text-[#374151]">任务执行摘要</div>
          </div>
          <button @click="emit('toggle-log-drawer')" class="sci-btn text-[10px] px-2 py-1">关闭</button>
        </div>

        <div ref="drawerLogListRef" class="log-scroll-container flex-1 overflow-auto p-4 space-y-3" @scroll="handleLogScroll('drawer', $event)">
          <div v-if="!executionLogs.length" class="h-full flex items-center justify-center text-center">
            <div>
              <div class="font-mono text-3xl mb-3" style="color: #94a3b8">LOGS</div>
              <div class="font-mono text-xs" style="color: #94a3b8">暂无任务进度</div>
            </div>
          </div>

          <div
            v-for="log in executionLogs"
            :key="log.id"
            class="friendly-log-card"
            :class="friendlyLogStatusClass(translateHermesLog(log).status)"
          >
            <div class="friendly-log-main">
              <div class="friendly-log-dot"></div>
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="friendly-log-stage">{{ translateHermesLog(log).stage }}</div>
                    <div v-if="translateHermesLog(log).toolDisplayName" class="friendly-log-tool">
                      工具：{{ translateHermesLog(log).toolDisplayName }}
                    </div>
                    <div class="friendly-log-title">{{ translateHermesLog(log).title }}</div>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <span class="friendly-log-time">{{ translateHermesLog(log).time }}</span>
                    <span class="friendly-log-status">{{ friendlyLogStatusLabel(translateHermesLog(log).status) }}</span>
                  </div>
                </div>
                <div class="friendly-log-description">{{ translateHermesLog(log).description }}</div>
                <button
                  v-if="translateHermesLog(log).raw"
                  type="button"
                  class="friendly-log-toggle"
                  @click="toggleTechnicalLog(log.id)"
                >
                  {{ isTechnicalLogOpen(log.id) ? '收起技术详情' : '查看技术详情' }}
                </button>
                <pre v-if="isTechnicalLogOpen(log.id)" class="friendly-log-raw">{{ translateHermesLog(log).raw }}</pre>
              </div>
            </div>
          </div>
          <button
            v-if="drawerLogHasNewItems"
            class="log-new-items-button"
            type="button"
            @click="scrollLogToBottom('drawer')"
          >
            有新日志，点击查看最新
          </button>
        </div>

      </aside>

    <div
      v-if="qaGuideOpen"
      class="qa-guide-backdrop absolute inset-0 z-30 flex items-center justify-center px-6"
      @click.self="closeQaGuide"
    >
      <section class="qa-guide-modal" role="dialog" aria-modal="true" aria-labelledby="qa-guide-title">
        <header class="qa-guide-header">
          <div>
            <div class="qa-guide-kicker">QA GUIDE</div>
            <h2 id="qa-guide-title">QA问答使用指南</h2>
            <p>把问题问清楚，系统会优先从数据库信源中召回材料，整合为可追溯的中文回答。</p>
          </div>
          <button class="sci-btn text-[10px] px-3 py-2" type="button" @click="closeQaGuide">关闭</button>
        </header>

        <div class="qa-guide-body">
          <section class="qa-guide-section">
            <h3>能做什么</h3>
            <ul>
              <li>围绕热点事件、政策变化、产业链风险、国际舆情进行快速研判。</li>
              <li>优先召回 PG 向量库和数据库信源，结合语义检索与关键词补充。</li>
              <li>输出结论、关键依据和影响判断，并展示可追溯信源。</li>
            </ul>
          </section>

          <section class="qa-guide-section">
            <h3>怎么提问</h3>
            <p>建议一次问题里写清楚对象、时间范围、地区或行业、关注角度。</p>
            <div class="qa-guide-example-grid">
              <button type="button" @click="fillRecommendedQuestion('美国301调查和港口服务费对中国造船业有什么影响？请按成本、订单、供应链三个角度分析。'); closeQaGuide()">
                美国301调查和港口服务费对中国造船业有什么影响？请按成本、订单、供应链三个角度分析。
              </button>
              <button type="button" @click="fillRecommendedQuestion('近七天欧盟对华贸易限制有哪些新变化？请列出主要事件、涉及行业和风险判断。'); closeQaGuide()">
                近七天欧盟对华贸易限制有哪些新变化？请列出主要事件、涉及行业和风险判断。
              </button>
              <button type="button" @click="fillRecommendedQuestion('某一热点事件后续可能如何演变？请给出时间线、相关方和下一步观察点。'); closeQaGuide()">
                某一热点事件后续可能如何演变？请给出时间线、相关方和下一步观察点。
              </button>
            </div>
          </section>

          <section class="qa-guide-section">
            <h3>怎么追问</h3>
            <ul>
              <li>要求补充时间线：例如“按时间顺序列出关键节点”。</li>
              <li>要求深化研判：例如“重点分析风险传导路径和我方应对”。</li>
              <li>要求缩小范围：例如“只看近七天”“只看东南亚”“只看半导体产业链”。</li>
            </ul>
          </section>

          <section class="qa-guide-section">
            <h3>怎么看信源</h3>
            <ul>
              <li>右侧信源栏展示召回来源、摘要、来源类型和原始链接。</li>
              <li>数据库检索工具来自 PG 向量库/数据库；互联网搜索工具来自联网检索服务。</li>
              <li>信源越多，覆盖面越广，但回答生成会更慢。</li>
            </ul>
          </section>

          <section class="qa-guide-section">
            <h3>怎么用于编报</h3>
            <ul>
              <li>回答完成后，可把当前问答加入“编报背景选择”。</li>
              <li>也可以使用“一键导入当前回答”，将问答结论和信源作为编报背景。</li>
              <li>导入后仍建议在编报规划阶段确认材料范围和研判方向。</li>
            </ul>
          </section>

          <section class="qa-guide-section muted">
            <h3>注意事项</h3>
            <p>材料不足时，系统会提示“现有材料不足以确认”。问答结果用于辅助研判，不替代人工复核；对关键事实、时间和数字仍建议结合原始信源确认。</p>
          </section>
        </div>
      </section>
    </div>

    <div
      v-if="reportPlan || isPlanning || planError"
      class="plan-modal-backdrop absolute inset-0 z-30 flex items-center justify-center backdrop-blur-sm px-6"
    >
      <section class="plan-modal-panel w-full max-w-4xl rounded-[24px] border overflow-hidden flex flex-col">
        <div class="flex-shrink-0 px-6 py-5 border-b border-neon-cyan/12 flex items-start justify-between gap-4">
          <div>
            <div class="font-mono text-[11px] tracking-[0.28em] text-[#374151] mb-2">编报规划</div>
            <h2 class="font-mono text-xl neon-text">编报规划确认</h2>
            <p class="mt-2 text-sm text-slate-300/60">
              先按主题生成检索方向和子任务，勾选需要纳入正式编报的内容后再提交。
            </p>
          </div>
          <button class="sci-btn text-[10px] px-3 py-2" type="button" @click="emit('cancel-plan')">取消</button>
        </div>

        <div v-if="isPlanning" class="plan-modal-scroll px-6 py-14 text-center">
          <div class="nexus-loader scale-75 mx-auto">
            <div class="loader-ring ring-a"></div>
            <div class="loader-ring ring-b"></div>
            <div class="loader-core"></div>
          </div>
          <div class="font-mono text-[#0f172a] mt-6">正在生成编报规划</div>
          <div class="font-mono text-[11px] text-[#374151] mt-2">系统正在识别主题、拆解任务并生成采集方向。</div>
        </div>

        <div v-else-if="planError" class="plan-modal-scroll px-6 py-8">
          <div class="rounded-2xl border border-red-400/35 bg-red-950/25 px-4 py-4 text-red-200 text-sm">
            {{ planError }}
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button class="sci-btn text-[10px] px-3 py-2" type="button" @click="emit('cancel-plan')">返回修改</button>
            <button class="sci-btn text-[10px] px-3 py-2 border-neon-cyan" style="color: #0369a1" type="button" @click="emit('generate')">
              重新生成规划
            </button>
          </div>
        </div>

        <div v-else class="plan-modal-body">
          <div class="flex-shrink-0 px-6 pt-5">
            <div class="rounded-2xl border border-neon-cyan/12 bg-black/16 px-4 py-3 mb-5">
              <div class="font-mono text-sm text-[#0f172a] mb-2">{{ reportPlan.title }}</div>
              <div class="text-sm text-slate-300/70 leading-relaxed">{{ reportPlan.summary }}</div>
            </div>

            <div class="flex items-center gap-2 mb-5">
              <button
                v-for="(step, index) in reportPlan.steps"
                :key="step.id"
                class="h-2 flex-1 rounded-full transition-all"
                :class="index <= planStepIndex ? 'bg-neon-cyan/75 shadow-[0_0_10px_rgba(0,243,255,0.16)]' : 'bg-neon-cyan/10'"
                type="button"
                @click="index < planStepIndex ? emit('prev-plan-step') : null"
              ></button>
            </div>
          </div>

          <div v-if="currentPlanStep" class="plan-modal-scroll px-6 pb-5">
            <div class="mb-4">
              <div class="font-mono text-[11px] tracking-[0.24em] text-slate-700 mb-2">{{ currentPlanStep.sectionTitle || currentPlanStep.title }}</div>
              <h3 class="font-mono text-lg text-[#0f172a]">{{ currentPlanStep.sectionTitle || currentPlanStep.title }}</h3>
              <p class="text-sm text-[#374151] mt-1">{{ currentPlanStep.description }}</p>
            </div>

            <div v-if="isSourcePlanStep" class="plan-source-sections">
              <section class="plan-source-section">
                <div class="plan-source-section-head">
                  <strong>PG 数据库信源</strong>
                  <span v-if="vectorSourceStatusLoading">检测中...</span>
                  <span v-else>{{ vectorSourceStatus?.indexedRows ? `已索引 ${Number(vectorSourceStatus.indexedRows).toLocaleString('zh-CN')} 条` : '以当前状态为准' }}</span>
                </div>
                <button
                  v-for="option in verifiedPlanSourceOptions"
                  :key="option.id"
                  class="plan-source-option text-left"
                  :class="[
                    planOptionStatusClass(option),
                    { selected: isPlanOptionSelected(currentPlanStep.id, option.id), disabled: option.disabled },
                  ]"
                  type="button"
                  :disabled="option.disabled"
                  @click="emit('toggle-plan-option', currentPlanStep.id, option.id)"
                >
                  <div class="plan-source-option-title">
                    <span>{{ option.label }}</span>
                    <i>{{ planOptionStatusLabel(option) }}</i>
                  </div>
                  <p>{{ option.detail }}</p>
                </button>
              </section>
              <section class="plan-source-section">
                <div class="plan-source-section-head">
                  <strong>联网检索方向</strong>
                  <span>按本次编报需要选择</span>
                </div>
                <div class="plan-source-option-grid">
                  <button
                    v-for="option in networkPlanSourceOptions"
                    :key="option.id"
                    class="plan-source-option text-left"
                    :class="[
                      planOptionStatusClass(option),
                      { selected: isPlanOptionSelected(currentPlanStep.id, option.id), disabled: option.disabled },
                    ]"
                    type="button"
                    :disabled="option.disabled"
                    @click="emit('toggle-plan-option', currentPlanStep.id, option.id)"
                  >
                    <div class="plan-source-option-title">
                      <span>{{ option.label }}</span>
                      <i>{{ planOptionStatusLabel(option) }}</i>
                    </div>
                    <p>{{ option.detail }}</p>
                  </button>
                </div>
                <div class="manual-source-compat">
                  <strong>人工指定信源（可选）</strong>
                  <p class="manual-source-hint">可补充 URL、机构名、媒体名或其他信源说明。</p>
                </div>
                <div class="manual-source-entry">
                  <textarea
                    class="sci-textarea text-sm bg-black/15"
                    rows="2"
                    v-model="manualSourceDraft"
                    placeholder="可填写 URL、机构名、媒体名或信源说明；支持一次粘贴多行。"
                    @keydown.ctrl.enter.prevent="addManualPlanSources"
                  ></textarea>
                  <button class="sci-btn text-[10px] px-3 py-2 border-neon-cyan" type="button" @click="addManualPlanSources">添加信源</button>
                </div>
                <div v-if="manualPlanSources.length" class="manual-source-list">
                  <div v-for="(source, index) in manualPlanSources" :key="`${source}-${index}`" class="manual-source-item">
                    <span>{{ source }}</span>
                    <button type="button" @click="removeManualPlanSource(index)">删除</button>
                  </div>
                </div>
              </section>
            </div>

            <div v-else-if="!isSupplementPlanStep" class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                v-for="option in currentPlanStep.options"
                :key="option.id"
                class="text-left rounded-2xl border p-4 transition-all hover:-translate-y-0.5"
                :class="isPlanOptionSelected(currentPlanStep.id, option.id)
                  ? 'border-neon-cyan/55 bg-neon-cyan/[0.08] shadow-[0_0_24px_rgba(0,243,255,0.10)]'
                  : 'border-neon-cyan/12 bg-black/18 hover:border-neon-cyan/30 hover:bg-neon-cyan/[0.04]'"
                type="button"
                @click="emit('toggle-plan-option', currentPlanStep.id, option.id)"
              >
                <div class="flex items-center justify-between gap-3 mb-2">
                  <span class="font-mono text-sm" :class="isPlanOptionSelected(currentPlanStep.id, option.id) ? '' : 'text-slate-200/80'" :style="isPlanOptionSelected(currentPlanStep.id, option.id) ? 'color: #0ea5e9' : ''">
                    {{ option.label }}
                  </span>
                  <span
                    class="h-5 w-5 rounded-full border flex items-center justify-center font-mono text-[10px]"
                    :class="isPlanOptionSelected(currentPlanStep.id, option.id) ? 'border-neon-cyan bg-neon-cyan text-deep-void' : 'border-neon-cyan/20'"
                    :style="!isPlanOptionSelected(currentPlanStep.id, option.id) ? 'color: #0ea5e9' : ''"
                  >
                    ✓
                  </span>
                </div>
                <div class="text-xs leading-relaxed text-[#374151]">{{ option.detail }}</div>
              </button>
            </div>

            <div v-if="!isSourcePlanStep && !isSupplementPlanStep" class="manual-direction-box">
              <div>
                <strong>手动新增检索写报方向</strong>
                <p>新增后会自动勾选，并随本步骤一起提交给后端用于检索和写报。</p>
              </div>
              <div class="manual-source-entry">
                <input
                  class="sci-input text-sm bg-black/15"
                  v-model="manualDirectionDraft"
                  placeholder="例如：补充政策依据、梳理时间线、研判产业链影响"
                  @keydown.enter.prevent="addManualPlanDirection"
                />
                <button class="sci-btn text-[10px] px-3 py-2 border-neon-cyan" type="button" @click="addManualPlanDirection">添加方向</button>
              </div>
            </div>

            <div v-if="isSupplementPlanStep" class="mt-5 rounded-2xl border border-neon-cyan/12 bg-black/14 p-3">
              <label class="block font-mono text-[10px] tracking-widest text-[#374151] mb-2">补充方向</label>
              <textarea
                class="sci-textarea text-sm bg-black/15"
                rows="3"
                :value="planSupplement"
                placeholder="可补充必须纳入编报的方向、限制条件或特别关注点..."
                @input="emit('update:planSupplement', $event.target.value)"
              ></textarea>
            </div>

          </div>

          <div class="plan-modal-actions flex items-center justify-between gap-3">
            <button
              class="sci-btn text-[10px] px-3 py-2"
              type="button"
              :disabled="planStepIndex <= 0"
              @click="emit('prev-plan-step')"
            >
              上一步
            </button>
            <div class="flex items-center gap-2">
              <button class="sci-btn text-[10px] px-3 py-2" type="button" @click="emit('cancel-plan')">取消</button>
              <button
                v-if="!isLastPlanStep"
                class="sci-btn text-[10px] px-3 py-2 border-neon-cyan"
                style="color: #0369a1"
                type="button"
                @click="emit('next-plan-step')"
              >
                下一步
              </button>
              <button
                v-else
                class="sci-btn text-[10px] px-4 py-2 border-neon-green text-neon-green shadow-[0_0_18px_rgba(0,255,159,0.12)]"
                type="button"
                @click="emit('confirm-plan')"
              >
                确认并开始编写
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div ref="reportRef" class="main-scroll flex-1 overflow-auto px-8 py-7">
      <div v-if="phase === 'idle'" class="min-h-full flex items-start justify-center py-10">
        <section class="main-content home-dual-mode w-full" :class="{ 'qa-main-content': homeMode === 'qa' }">
          <div v-if="homeMode === 'report'" class="input-panel mx-auto text-left p-5 md:p-6">
            <div v-if="qaImportNotice" class="qa-import-notice mb-4">{{ qaImportNotice }}</div>
            <div class="input-title-shell p-5 md:p-6">
              <div class="flex items-center justify-between gap-4 mb-4">
                <label class="block font-mono text-[11px] tracking-widest text-[#111827]" style="font-size: 14px; font-weight: 700">报告标题</label>
                <span class="font-mono text-[10px] text-slate-500">{{ titleLength }}/200</span>
              </div>
              <textarea
                ref="titleInputRef"
                class="title-input w-full resize-y bg-transparent border-none outline-none font-mono text-[17px] leading-8 placeholder:text-slate-500/70"
                :value="title"
                maxlength="200"
                @input="updateTitle($event.target.value)"
                :placeholder="selectedReportType?.placeholder"
              ></textarea>
              <div v-if="titleValidationError" class="form-validation-message">{{ titleValidationError }}</div>
            </div>

            <div class="mt-5">
              <div class="soft-field p-3">
                <label class="block font-mono text-[10px] tracking-widest text-[#111827] mb-2" style="font-size: 14px; font-weight: 700">补充背景</label>
                <textarea
                  ref="contextTextRef"
                  :value="contextText"
                  @input="emit('update:contextText', $event.target.value)"
                  placeholder="请输入与报告相关的背景信息、关键事件或已有结论，AI 将据此生成更贴合需求的内容。"
                  rows="4"
                  class="sci-textarea text-sm"
                ></textarea>
              </div>
            </div>

            <div class="mt-5 flex items-center justify-between gap-4 report-form-actions">
              <div class="grid gap-2">
                <div class="font-mono text-[10px] text-slate-500">先生成编报规划，确认后才会创建正式编报任务</div>
                <label class="inline-flex items-center gap-2 font-mono text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    :checked="useMyPreferences"
                    @change="emit('update:useMyPreferences', $event.target.checked)"
                  />
                  使用个人偏好和默认模板
                </label>
                <label class="inline-flex items-center gap-2 font-mono text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    :checked="deepReportEnabled"
                    @change="emit('update:deepReportEnabled', $event.target.checked)"
                  />
                  深度编报
                </label>
              </div>
              <button
                class="generate-btn shrink-0 font-mono text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                type="button"
                :disabled="!canSubmitPlanning"
                :title="isPlanning ? '正在生成编报规划' : !title?.trim() ? '请输入报告标题' : '生成编报规划'"
                @click="submitReport"
              >
                生成编报规划
              </button>
            </div>
          </div>

          <div
            v-else
            class="qa-workspace"
            :class="{
              'has-thread': qaTurns.length,
              'source-open': qaSourceSidebarOpen && canShowQaSourceSidebar,
              'source-collapsed': !qaSourceSidebarOpen && canShowQaSourceSidebar,
            }"
          >
            <div class="qa-body-grid">
              <div class="qa-main-pane">
                <section ref="qaThreadRef" class="qa-thread" @scroll="handleQaThreadScroll">
              <div v-if="qaStatus === 'idle' && !qaTurns.length" class="qa-empty-card">
                <div class="qa-empty-icon">⌕</div>
                <h3>QA问答</h3>
                <p>基于知识库和数据库资料进行检索问答、背景查询和资料核验。</p>

                <section class="qa-recommendations">
                  <div class="qa-recommend-heading">
                    <span>推荐问题</span>
                    <button type="button" @click="rotateRecommendedQuestions">换一批</button>
                  </div>
                  <div class="qa-recommend-list">
                    <button
                      v-for="question in visibleRecommendedQuestions"
                      :key="question"
                      type="button"
                      @click="fillRecommendedQuestion(question)"
                    >
                      {{ question }}
                    </button>
                  </div>
                </section>
              </div>

              <template v-for="turn in qaTurns" :key="turn.id">
                <div class="qa-message-row user">
                  <article class="qa-user-bubble">
                    <p>{{ turn.question }}</p>
                    <time>{{ new Date(turn.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) }}</time>
                  </article>
                </div>

                <article class="qa-ai-card">
                  <header class="qa-ai-header">
                    <div>
                      <span>AI 回答</span>
                      <p>{{ turn.id === activeQaTurnId ? qaStatusDescription : '回答已完成。' }}</p>
                    </div>
                    <small class="qa-state-badge" :class="`qa-state-${turn.id === activeQaTurnId ? qaStatus : turn.status}`">
                      {{ turn.id === activeQaTurnId ? qaStatusTitle : turn.status === 'failed' ? '回答生成失败' : '回答已完成' }}
                    </small>
                  </header>

                  <div v-if="turn.id === activeQaTurnId && qaStatus !== 'idle' && qaStatus !== 'failed'" class="qa-status-steps">
                    <span
                      v-for="step in qaStepItems"
                      :key="step.key"
                      :class="{ active: step.active, done: step.done }"
                    >
                      {{ step.done ? '✓ ' : '' }}{{ step.label }}
                    </span>
                  </div>

                  <div v-if="turn.id === activeQaTurnId && qaStatus === 'failed'" class="qa-failure-card">
                    <strong>回答生成失败</strong>
                    <p>系统暂时无法完成检索与整合，请稍后重试。</p>
                    <button type="button" @click="startQa(turn.question)">重新提问</button>
                  </div>
                  <div v-else class="qa-answer-box" :class="{ empty: !turn.answer }">
                    <div v-if="turn.answer" class="qa-answer-markdown" v-html="qaAnswerHtml(turn.answer)"></div>
                    <template v-else>正在准备回答...</template>
                  </div>
                </article>
              </template>

              <div v-if="qaStatus === 'done'" class="qa-answer-actions">
                <button type="button" @click="copyQaAnswer">复制答案</button>
                <button class="primary" type="button" @click="addCurrentQaTurnToImportSelection">加入背景选择</button>
                <button type="button" @click="importQaAsReportContext">一键导入当前回答</button>
                <button type="button" @click="continueQa">继续追问</button>
              </div>
              <section class="qa-import-panel">
                <div class="qa-import-panel-head">
                  <div>
                    <strong>编报背景选择</strong>
                    <p>已选 {{ selectedQaImportSessionCount }} 个聊天 / {{ selectedQaImportTurnCount }} 轮问答</p>
                  </div>
                  <div class="qa-import-panel-actions">
                    <button type="button" @click="qaImportPickerOpen = !qaImportPickerOpen">
                      {{ qaImportPickerOpen ? '收起选择' : '打开选择' }}
                    </button>
                    <button type="button" :disabled="!hasQaImportSelection" @click="clearQaImportSelection">清空选择</button>
                    <button class="primary" type="button" :disabled="!hasQaImportSelection" @click="importSelectedQaAsReportContext">导入到编报背景</button>
                  </div>
                </div>

                <div v-if="qaImportPickerOpen" class="qa-import-picker">
                  <div v-if="qaImportSessions.length" class="qa-import-session-list">
                    <article
                      v-for="session in qaImportSessions"
                      :key="session.id"
                      class="qa-import-session"
                      :class="{ selected: isQaImportSessionSelected(session) }"
                    >
                      <div class="qa-import-session-row">
                        <label class="qa-import-check">
                          <input
                            type="checkbox"
                            :checked="isQaImportSessionSelected(session)"
                            @change="toggleQaImportSession(session)"
                          />
                          <span></span>
                        </label>
                        <button class="qa-import-session-main" type="button" @click="toggleQaImportSessionExpanded(session.id)">
                          <strong>{{ qaImportSessionTitle(session) }}</strong>
                          <small>{{ qaImportDate(session.updatedAt || session.createdAt) }} · {{ session.importTurns.length }} 轮问答 · {{ session.sourcesCount || session.referencePayloads?.length || 0 }} 条来源</small>
                        </button>
                        <button class="qa-import-expand" type="button" @click="toggleQaImportSessionExpanded(session.id)">
                          {{ isQaImportSessionExpanded(session.id) ? '收起' : '展开' }}
                        </button>
                      </div>

                      <div v-if="isQaImportSessionExpanded(session.id)" class="qa-import-turn-list">
                        <label
                          v-for="turn in session.importTurns"
                          :key="turn.id"
                          class="qa-import-turn"
                          :class="{ selected: isQaImportTurnSelected(session.id, turn.id) }"
                        >
                          <input
                            type="checkbox"
                            :checked="isQaImportTurnSelected(session.id, turn.id)"
                            @change="toggleQaImportTurn(session, turn)"
                          />
                          <span>
                            <strong>{{ truncateQaImportText(turn.question, 120) }}</strong>
                            <small>{{ qaImportDate(turn.createdAt) }} · {{ truncateQaImportText(turn.answer, 160) }}</small>
                          </span>
                        </label>
                      </div>
                    </article>
                  </div>
                  <p v-else class="qa-import-empty">暂无可导入的已完成问答。</p>
                </div>
              </section>
              <div v-if="qaCopyNotice" class="qa-copy-notice">{{ qaCopyNotice }}</div>

              <section v-if="false" class="qa-reference-section qa-source-section">
                <div class="qa-reference-header">
                  <div>
                    <div class="qa-reference-heading">参考来源</div>
                    <p v-if="qaReferenceItems.length">共 {{ qaReferenceItems.length }} 条结构化来源，支持搜索、筛选和展开查看。</p>
                    <p v-else-if="isQaRunning">正在检索和整理可追溯来源，收到结构化来源后会在这里展示。</p>
                    <p v-else>完成一次知识问答后，系统会在这里展示可追溯信源。</p>
                  </div>
                  <span v-if="qaReferenceItems.length" class="qa-reference-count">{{ filteredQaReferenceItems.length }} / {{ qaReferenceItems.length }}</span>
                </div>

                <div v-if="qaReferenceItems.length" class="qa-source-workbench">
                  <div class="qa-source-toolbar">
                    <label class="qa-source-search">
                      <span>搜索</span>
                      <input
                        v-model="qaSourceSearch"
                        type="search"
                        placeholder="搜索标题 / 来源 / 关键词"
                      />
                    </label>
                    <div class="qa-source-type-filter" aria-label="来源类型筛选">
                      <button
                        type="button"
                        :class="{ active: qaSourceTypeFilter === 'all' }"
                        @click="qaSourceTypeFilter = 'all'"
                      >
                        全部
                      </button>
                      <button
                        v-for="type in qaSourceTypeOptions"
                        :key="type"
                        type="button"
                        :class="{ active: qaSourceTypeFilter === type }"
                        @click="qaSourceTypeFilter = type"
                      >
                        {{ type }}
                      </button>
                    </div>
                  </div>

                  <div v-if="filteredQaReferenceItems.length" class="qa-source-list">
                    <article
                      v-for="(source, index) in pagedQaReferenceItems"
                      :key="source.id"
                      class="qa-source-card"
                      :class="{ expanded: isQaSourceExpanded(source.id) }"
                    >
                      <div class="qa-source-index">[{{ index + 1 }}]</div>
                      <div class="qa-source-main">
                        <div class="qa-source-title-row">
                          <strong>{{ qaSourceField(source.title, '未命名信源') }}</strong>
                          <span>{{ qaSourceField(source.relevance, '--') }}</span>
                        </div>
                        <p class="qa-source-summary">{{ qaSourceField(source.summary, '当前信源暂无摘要。') }}</p>
                        <div class="qa-source-meta">
                          <span>{{ qaSourceField(source.sourceType, '其他') }}</span>
                          <span>{{ qaSourceField(source.sourceName, '来源未知') }}</span>
                          <span>{{ qaSourceField(source.publishTime, '时间未知') }}</span>
                        </div>
                        <div class="qa-source-actions">
                          <button type="button" @click="toggleQaSourceExpanded(source.id)">
                            {{ isQaSourceExpanded(source.id) ? '收起详情' : '查看详情' }}
                          </button>
                          <a
                            v-if="source.url"
                            :href="source.url"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            打开来源
                          </a>
                        </div>
                        <div v-if="isQaSourceExpanded(source.id)" class="qa-source-detail">
                          <div>
                            <span>完整摘要</span>
                            <p>{{ qaSourceField(source.summary, '暂无摘要。') }}</p>
                          </div>
                          <div>
                            <span>正文片段</span>
                            <p>{{ qaSourceField(source.detail, '暂无正文片段。') }}</p>
                          </div>
                          <div>
                            <span>来源 URL</span>
                            <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.url }}</a>
                            <p v-else>--</p>
                          </div>
                          <div class="qa-source-detail-grid">
                            <p><span>采集方式</span>{{ qaSourceField(source.method, '--') }}</p>
                            <p><span>采集状态</span>{{ qaSourceField(source.status, '--') }}</p>
                            <p><span>失败原因</span>{{ qaSourceField(source.failedReason, '--') }}</p>
                          </div>
                        </div>
                      </div>
                    </article>
                    <button
                      v-if="qaSourceHasMore"
                      class="qa-source-load-more"
                      type="button"
                      @click="qaSourcePage += 1"
                    >
                      查看更多信源
                    </button>
                  </div>

                  <p v-else class="qa-reference-empty">未找到匹配的信源，请调整搜索或筛选条件。</p>
                </div>
                <p v-else-if="qaStatus === 'done'" class="qa-reference-empty">暂无结构化来源信息。</p>
                <p v-else class="qa-reference-empty">暂无信源记录，请先完成一次知识问答。</p>
              </section>

              <section v-if="false && qaStatus === 'done'" class="qa-reference-section">
                <div class="qa-reference-heading">参考来源</div>
                <div v-if="qaReferenceItems.length" class="qa-reference-list">
                  <article v-for="(source, index) in qaReferenceItems" :key="source.id" class="qa-reference-card">
                    <div class="qa-reference-number">[{{ index + 1 }}]</div>
                    <div class="qa-reference-body">
                      <strong>{{ source.title }}</strong>
                      <p>{{ source.sourceName }} · {{ source.publishTime }} · {{ source.sourceType }}</p>
                      <details>
                        <summary>展开摘要</summary>
                        <p>{{ source.summary }}</p>
                        <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">打开来源</a>
                      </details>
                    </div>
                  </article>
                </div>
                <p v-else class="qa-reference-empty">暂无结构化来源信息。</p>
              </section>

              <button
                v-if="qaThreadHasNewContent"
                class="qa-new-content-button"
                type="button"
                @click="scrollQaThreadToBottom"
              >
                有新内容，点击查看
              </button>
            </section>

            <section class="qa-composer-wrap">
              <div class="qa-composer">
                <button class="qa-scope-button" type="button">默认知识库</button>
                <textarea
                  ref="qaInputRef"
                  v-model="qaQuestion"
                  class="qa-question-input"
                  rows="1"
                  placeholder="请输入您的问题，系统将检索数据库并整合相关信息……"
                  @input="handleQaInput"
                  @keydown="handleQaInputKeydown"
                ></textarea>
                <button
                  class="qa-submit-btn"
                  type="button"
                  :disabled="!canSendQa"
                  @click="startQa"
                >
                  {{ isQaRunning ? '生成中' : '发送' }}
                </button>
              </div>
              <div class="qa-composer-footer">
                <span v-if="qaValidationError" class="qa-validation-message">{{ qaValidationError }}</span>
                <span v-else>Enter 发送，Shift + Enter 换行。</span>
              </div>
            </section>
              </div>
            </div>

              <aside
                v-if="canShowQaSourceSidebar"
                class="qa-source-sidebar"
                :class="{ open: qaSourceSidebarOpen, collapsed: !qaSourceSidebarOpen }"
                aria-label="参考来源"
              >
                <button
                  v-if="!qaSourceSidebarOpen"
                  class="qa-source-collapsed-rail"
                  type="button"
                  @click="openQaSourceSidebar"
                  aria-label="展开参考来源"
                >
                  <span class="qa-source-rail-label">参考来源</span>
                  <strong>{{ qaReferenceItems.length || 0 }}</strong>
                  <i aria-hidden="true">‹</i>
                </button>

                <section v-if="qaSourceSidebarOpen" class="qa-reference-section qa-source-section">
                  <div class="qa-reference-header">
                    <div>
                      <div class="qa-reference-heading">参考来源</div>
                      <p v-if="qaReferenceItems.length">共 {{ qaReferenceItems.length }} 条结构化来源，支持搜索、筛选和展开查看。</p>
                      <p v-else-if="isQaRunning">正在检索和整理可追溯来源，收到结构化来源后会在这里展示。</p>
                      <p v-else>完成一次知识问答后，系统会在这里展示可追溯信源。</p>
                    </div>
                    <div class="qa-source-sidebar-actions">
                      <span v-if="qaReferenceItems.length" class="qa-reference-count">{{ filteredQaReferenceItems.length }} / {{ qaReferenceItems.length }}</span>
                      <button type="button" @click="closeQaSourceSidebar" aria-label="收起参考来源">收起</button>
                    </div>
                  </div>

                  <div v-if="qaReferenceItems.length" class="qa-source-workbench">
                    <div class="qa-source-toolbar">
                      <label class="qa-source-search">
                        <span>搜索</span>
                        <input
                          v-model="qaSourceSearch"
                          type="search"
                          placeholder="搜索标题 / 来源 / 关键词"
                        />
                      </label>
                      <div class="qa-source-type-filter" aria-label="来源类型筛选">
                        <button
                          type="button"
                          :class="{ active: qaSourceTypeFilter === 'all' }"
                          @click="qaSourceTypeFilter = 'all'"
                        >
                          全部
                        </button>
                        <button
                          v-for="type in qaSourceTypeOptions"
                          :key="type"
                          type="button"
                          :class="{ active: qaSourceTypeFilter === type }"
                          @click="qaSourceTypeFilter = type"
                        >
                          {{ type }}
                        </button>
                      </div>
                    </div>

                    <div v-if="filteredQaReferenceItems.length" class="qa-source-list">
                      <article
                        v-for="(source, index) in pagedQaReferenceItems"
                        :key="source.id"
                        class="qa-source-card"
                        :class="{ expanded: isQaSourceExpanded(source.id) }"
                      >
                        <div class="qa-source-index">[{{ index + 1 }}]</div>
                        <div class="qa-source-main">
                          <div class="qa-source-title-row">
                            <strong>{{ qaSourceField(source.title, '未命名信源') }}</strong>
                            <span>{{ qaSourceField(source.relevance, '--') }}</span>
                          </div>
                          <p class="qa-source-summary">{{ qaSourceField(source.summary, '当前信源暂无摘要。') }}</p>
                          <div class="qa-source-meta">
                            <span>{{ qaSourceField(source.sourceType, '其他') }}</span>
                            <span>{{ qaSourceField(source.sourceName, '来源未知') }}</span>
                            <span>{{ qaSourceField(source.publishTime, '时间未知') }}</span>
                          </div>
                          <div class="qa-source-actions">
                            <button type="button" @click="toggleQaSourceExpanded(source.id)">
                              {{ isQaSourceExpanded(source.id) ? '收起详情' : '查看详情' }}
                            </button>
                            <a
                              v-if="source.url"
                              :href="source.url"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              打开来源
                            </a>
                          </div>
                          <div v-if="isQaSourceExpanded(source.id)" class="qa-source-detail">
                            <div>
                              <span>完整摘要</span>
                              <p>{{ qaSourceField(source.summary, '暂无摘要。') }}</p>
                            </div>
                            <div>
                              <span>正文片段</span>
                              <p>{{ qaSourceField(source.detail, '暂无正文片段。') }}</p>
                            </div>
                            <div>
                              <span>来源 URL</span>
                              <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.url }}</a>
                              <p v-else>--</p>
                            </div>
                            <div class="qa-source-detail-grid">
                              <p><span>采集方式</span>{{ qaSourceField(source.method, '--') }}</p>
                              <p><span>采集状态</span>{{ qaSourceField(source.status, '--') }}</p>
                              <p><span>失败原因</span>{{ qaSourceField(source.failedReason, '--') }}</p>
                            </div>
                          </div>
                        </div>
                      </article>
                      <button
                        v-if="qaSourceHasMore"
                        class="qa-source-load-more"
                        type="button"
                        @click="qaSourcePage += 1"
                      >
                        查看更多信源
                      </button>
                    </div>

                    <p v-else class="qa-reference-empty">未找到匹配的信源，请调整搜索或筛选条件。</p>
                  </div>
                  <p v-else-if="qaStatus === 'done'" class="qa-reference-empty">暂无结构化来源信息。</p>
                  <p v-else class="qa-reference-empty">暂无信源记录，请先完成一次知识问答。</p>
                </section>
              </aside>
          </div>
        </section>
      </div>

      <div v-else-if="isHistoryDetailLoading" class="history-detail-state">
        <section class="history-loading-card">
          <div class="history-loading-icon">▤</div>
          <h1>正在加载历史报告</h1>
          <p>系统正在读取报告正文、信源概览和引用依据。</p>
          <div class="history-skeleton-info">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="history-skeleton-body">
            <i class="wide"></i>
            <i></i>
            <i></i>
            <i class="short"></i>
            <i></i>
          </div>
        </section>
      </div>

      <div v-else-if="isHistoryDetailError" class="history-detail-state">
        <section class="history-loading-card history-error-card">
          <div class="history-loading-icon history-error-icon">!</div>
          <h1>历史报告加载失败</h1>
          <p>请稍后重试，或返回报告列表。</p>
          <div v-if="detailLoadError || errorMessage" class="history-error-message">
            {{ sanitizeReportLogText(detailLoadError || errorMessage) }}
          </div>
          <div class="history-error-actions">
            <button class="result-action-btn result-action-primary" type="button" @click="emit('retry-history-report')">重新加载</button>
            <button class="result-action-btn" type="button" @click="emit('list')">返回报告列表</button>
          </div>
        </section>
      </div>

      <div v-else-if="phase === 'loading'" class="source-workspace">
        <section class="source-collection-panel">
          <div class="source-status-area">
            <div class="source-status-orbit" :class="`source-status-${taskProgressView.tone}`">
              <span></span>
            </div>
            <h1>正在执行编报任务</h1>
            <p>系统正在按计划执行任务，请稍候。您可以离开页面，任务将继续在后台运行。</p>
            <div class="source-task-pill">{{ taskSummaryText }}</div>
          </div>

          <div class="task-progress-panel execution-progress-timeline">
            <div class="task-stage-flow">
              <article
                v-for="stage in progressStageFlow"
                :key="stage.key"
                class="task-stage-card"
                :class="`task-stage-${stage.status}`"
              >
                <div class="task-stage-badge">{{ stage.status === 'done' ? '✓' : stage.number }}</div>
                <div class="task-stage-copy">
                  <strong>{{ stage.title }}</strong>
                  <span>{{ stage.desc }}</span>
                </div>
                <em>{{ progressStatusLabel(stage.status) }}</em>
              </article>
            </div>

            <div v-if="false" class="ai-process-panel">
              <header class="ai-process-header">
                <div>
                  <strong>AI执行过程</strong>
                  <span>{{ taskProgressView.subtitle }}</span>
                </div>
                <span>{{ progressStatusLabel(overallProgressStatus) }}</span>
              </header>
              <div class="ai-process-grid">
                <article
                  v-for="task in executionTaskCards"
                  :key="task.key"
                  class="ai-process-card"
                  :class="`ai-process-${task.status}`"
                >
                  <div class="ai-process-icon">{{ task.status === 'done' ? '✓' : task.icon }}</div>
                  <div>
                    <strong>{{ task.title }}</strong>
                    <p>{{ task.desc }}</p>
                  </div>
                  <span>{{ progressStatusLabel(task.status) }}</span>
                </article>
              </div>
            </div>
          </div>

          <div class="source-stats-grid">
            <div class="source-stat-card">
              <div class="source-stat-icon">◎</div>
              <div>
                <div class="source-stat-title">候选命中</div>
                <div class="source-stat-value">{{ sourceStats.candidateHits ?? '--' }}</div>
              </div>
            </div>
            <div class="source-stat-card">
              <div class="source-stat-icon">◇</div>
              <div>
                <div class="source-stat-title">高相关候选</div>
                <div class="source-stat-value">{{ sourceStats.highValue ?? '--' }}</div>
              </div>
            </div>
            <div class="source-stat-card">
              <div class="source-stat-icon">▤</div>
              <div>
                <div class="source-stat-title">已展示信源</div>
                <div class="source-stat-value">{{ sourceStats.visibleSources ?? '--' }}</div>
              </div>
            </div>
            <div class="source-stat-card">
              <div class="source-stat-icon source-stat-warning">⌛</div>
              <div>
                <div class="source-stat-title">正文抽取</div>
                <div class="source-stat-value">{{ sourceStats.extracted ?? '--' }}</div>
              </div>
            </div>
          </div>

          <div class="source-results-title">
            <span></span>
            <h2>信源采集结果</h2>
          </div>

          <section v-if="databaseSourceDiagnostics.enabled" class="source-diagnostics-card">
            <div class="source-diagnostics-header">
              <strong>检索诊断</strong>
              <span v-if="databaseSourceDiagnostics.shouldUseWebSupplement">建议补充 Web / 资料采集</span>
            </div>
            <div class="source-diagnostics-grid">
              <div>
                <b>{{ databaseSourceDiagnostics.acceptedCount }}</b>
                <span>可用数据库信源</span>
              </div>
              <div>
                <b>{{ databaseSourceDiagnostics.uncertainCount }}</b>
                <span>待核验候选</span>
              </div>
              <div>
                <b>{{ databaseSourceDiagnostics.rejectedCount }}</b>
                <span>已过滤候选</span>
              </div>
            </div>
            <p v-if="databaseSourceDiagnostics.coreEntities.length">
              核心实体：{{ databaseSourceDiagnostics.coreEntities.join('、') }}
            </p>
            <p v-if="databaseSourceDiagnostics.topicTerms.length">
              主题词：{{ databaseSourceDiagnostics.topicTerms.join('、') }}
            </p>
            <p v-if="databaseSourceDiagnostics.fallbackReason" class="source-diagnostics-reason">
              {{ databaseSourceDiagnostics.fallbackReason }}
            </p>
            <p v-if="databaseSourceDiagnostics.recommendedSearchQueries.length" class="source-diagnostics-query">
              建议查询：{{ databaseSourceDiagnostics.recommendedSearchQueries.join('；') }}
            </p>
          </section>

          <div v-if="databaseSourcesLoading && !normalizedSources.length" class="source-empty-state">
            正在检查可展示信源...
          </div>
          <div v-else-if="!normalizedSources.length" class="source-empty-state">
            <div>
              {{ filteredDatabaseCandidates.length ? '数据库未找到通过核心实体校验的信源。' : (dbSourcesState === 'fallback' ? '数据库无直接命中，已回退公开检索。' : '暂未采集到可展示信源，系统仍在检索中。') }}
            </div>
            <div v-if="filteredDatabaseCandidates.length">已过滤 {{ filteredDatabaseCandidates.length }} 条低相关或实体错配候选，建议使用 Web 搜索或资料采集补充。</div>
            <div v-if="databaseSources?.fallbackReason" class="source-empty-reason">原因：{{ databaseSources.fallbackReason }}</div>
          </div>

          <div v-else class="source-card-list">
            <article
              v-for="source in visibleSourceCards"
              :key="source.id"
              class="source-result-card"
              :class="{ active: expandedSourceId === source.id }"
              @click="expandedSourceId = expandedSourceId === source.id ? '' : source.id"
            >
              <div class="source-result-icon">{{ source.sourceType.slice(0, 1) }}</div>
              <div class="source-result-body">
                <div class="source-result-main">
                  <div>
                    <h3>{{ source.title }}</h3>
                    <div class="source-result-meta">
                      <span>{{ source.sourceType }}</span>
                      <span>{{ source.sourceName }}</span>
                      <span>{{ source.publishTime }}</span>
                    </div>
                  </div>
                  <div class="source-result-tags">
                    <span class="source-status-tag" :class="`source-status-tag-${source.status}`">{{ sourceStatusLabel(source.status) }}</span>
                    <span class="source-relevance-tag">{{ source.relevance }}</span>
                  </div>
                </div>
                <p :class="expandedSourceId === source.id ? 'source-summary-full' : 'source-summary-clamp'">{{ source.summary }}</p>
                <div v-if="expandedSourceId === source.id" class="source-detail-box">
                  <div>采集方式：{{ source.method }}</div>
                  <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" @click.stop>打开原始来源</a>
                  <p v-if="source.note">{{ source.note }}</p>
                </div>
              </div>
              <button class="source-result-arrow" type="button" aria-label="展开信源详情">
                {{ expandedSourceId === source.id ? '⌃' : '›' }}
              </button>
            </article>

            <button
              v-if="normalizedSources.length > 5"
              class="source-expand-button"
              type="button"
              @click="dbSourcesExpanded = !dbSourcesExpanded"
            >
              {{ dbSourcesExpanded ? '收起' : `展开全部信源（共 ${normalizedSources.length} 条）` }}
            </button>
          </div>

          <details v-if="filteredDatabaseCandidates.length" class="source-filtered-details">
            <summary>查看被过滤候选信源（{{ filteredDatabaseCandidates.length }}）</summary>
            <div class="source-filtered-list">
              <article v-for="candidate in filteredDatabaseCandidates" :key="candidate.id" class="source-filtered-item">
                <div>
                  <strong>{{ candidate.title }}</strong>
                  <p>{{ candidate.sourceName }} · {{ candidate.filterStatus }}</p>
                </div>
                <p>{{ candidate.reason }}</p>
                <p v-if="candidate.matchedConfusions">疑似错配：{{ candidate.matchedConfusions }}</p>
                <p v-if="candidate.missingCoreEntities">缺失核心实体：{{ candidate.missingCoreEntities }}</p>
                <p v-if="candidate.vectorScore !== ''">原始向量分：{{ candidate.vectorScore }}</p>
                <a v-if="candidate.url" :href="candidate.url" target="_blank" rel="noopener noreferrer">打开来源</a>
              </article>
            </div>
          </details>

          <details class="source-technical-details" open>
            <summary>查看技术详情</summary>
            <div ref="liveLogListRef" class="source-technical-log" @scroll="handleLogScroll('live', $event)">
              <div v-if="technicalLogs.length" class="space-y-3">
                <div
                  v-for="log in technicalLogs"
                  :key="log.id"
                  class="friendly-log-card"
                  :class="friendlyLogStatusClass(translateHermesLog(log).status)"
                >
                  <div class="friendly-log-main">
                    <div class="friendly-log-dot"></div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <div class="friendly-log-stage">{{ translateHermesLog(log).stage }}</div>
                          <div v-if="translateHermesLog(log).toolDisplayName" class="friendly-log-tool">
                            工具：{{ translateHermesLog(log).toolDisplayName }}
                          </div>
                          <div class="friendly-log-title">{{ translateHermesLog(log).title }}</div>
                        </div>
                        <span class="friendly-log-status">{{ friendlyLogStatusLabel(translateHermesLog(log).status) }}</span>
                      </div>
                      <div class="friendly-log-description">{{ translateHermesLog(log).description }}</div>
                      <pre v-if="translateHermesLog(log).raw" class="friendly-log-raw">{{ translateHermesLog(log).raw }}</pre>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="source-empty-state">等待任务执行日志...</div>
              <button
                v-if="liveLogHasNewItems"
                class="log-new-items-button"
                type="button"
                @click="scrollLogToBottom('live')"
              >
                有新日志，点击查看最新
              </button>
            </div>
          </details>
        </section>
      </div>

      <div v-else-if="phase === 'error'" class="max-w-4xl mx-auto">
        <div class="border border-red-400/40 bg-red-950/30 text-red-200 rounded p-4 font-mono text-sm">
          {{ sanitizeReportLogText(errorMessage) || '任务失败' }}
        </div>
        <div class="mt-4 font-mono text-xs space-y-1">
          <div v-for="(log, i) in processLogs" :key="i" class="text-slate-500">{{ log }}</div>
        </div>
      </div>

      <div v-else class="result-shell">
        <div class="result-sticky-panel" @wheel="handleResultTabWheel">
          <div class="result-toolbar">
            <nav class="result-tabs" aria-label="报告结果切换">
              <button
                v-for="tab in resultTabs"
                :key="tab.key"
                class="result-tab"
                :class="{ active: activeResultTab === tab.key }"
                type="button"
                @click="setActiveResultTab(tab.key)"
              >
                {{ tab.label }}
              </button>
            </nav>

            <div class="result-actions">
              <button
                v-if="job?.jobId && generatedHtml"
                @click="openReportEditPanel"
                class="result-action-btn"
                type="button"
              >
                <span>✎</span> 局部修改
              </button>
              <button @click="exportWord" :disabled="!canExport" class="result-action-btn" type="button">
                <span>▣</span> 导出 Word
              </button>
              <button @click="exportPdf" :disabled="!canExport" class="result-action-btn" type="button">
                <span>◧</span> 导出 PDF
              </button>
              <button @click="emit('list')" class="result-action-btn" type="button">
                <span>☷</span> 报告列表
              </button>
              <button
                v-if="canDeleteReport && job?.jobId"
                @click="emit('delete-report', job)"
                class="result-action-btn result-action-danger"
                type="button"
              >
                <span>!</span> 删除编报
              </button>
              <button @click="emit('new-report')" class="result-action-btn result-action-primary" type="button">
                <span>＋</span> 新开一篇
              </button>
            </div>
          </div>

          <div v-if="activeResultTab !== 'sources'" class="result-info-bar">
            <div v-for="item in resultInfoItems" :key="item[0]" class="result-info-item">
              <span>{{ item[0] }}</span>
              <strong>{{ item[1] }}</strong>
            </div>
          </div>
        </div>

        <section v-if="activeResultTab === 'report'" class="result-tab-panel">
          <aside v-if="reportEditOpen" class="report-edit-panel">
            <div class="report-edit-head">
              <div>
                <strong>局部段落修改</strong>
                <span>选中文本后生成局部改写，不覆盖原报告。</span>
              </div>
              <button type="button" class="report-edit-close" @click="reportEditOpen = false">×</button>
            </div>

            <div v-if="reportEditError" class="report-edit-alert error">{{ reportEditError }}</div>
            <div v-if="reportEditNotice" class="report-edit-alert notice">{{ reportEditNotice }}</div>

            <div class="report-edit-grid">
              <label>
                修改方式
                <select v-model="reportEditForm.editMode">
                  <option v-for="mode in reportEditModes" :key="mode.value" :value="mode.value">{{ mode.label }}</option>
                </select>
              </label>
              <label>
                目标路径
                <input v-model="reportEditForm.targetPath" type="text" placeholder="可选，如 sections[2].paragraphs[1]" />
              </label>
            </div>

            <label class="report-edit-field">
              原文
              <textarea v-model="reportEditForm.originalText" rows="5" placeholder="可先在报告正文中选中文本，再点击局部修改；也可手动粘贴。"></textarea>
            </label>

            <label class="report-edit-field">
              修改要求
              <textarea v-model="reportEditForm.instruction" rows="3" placeholder="例如：请补充各方态度的表态时间、媒体和来源，语言保持简洁正式。"></textarea>
            </label>

            <div class="report-edit-actions">
              <button type="button" class="result-action-btn result-action-primary" :disabled="reportEditLoading" @click="submitReportEdit">
                {{ reportEditLoading ? '生成中...' : '生成修改' }}
              </button>
              <button v-if="reportEditResult?.editedText" type="button" class="result-action-btn" @click="copyReportEditResult(reportEditResult.editedText)">
                复制结果
              </button>
            </div>

            <div v-if="reportEditResult?.editedText" class="report-edit-result">
              <strong>修改结果</strong>
              <pre>{{ reportEditResult.editedText }}</pre>
            </div>

            <details class="report-edit-history">
              <summary>修改历史 {{ reportEditHistory.length ? `(${reportEditHistory.length})` : '' }}</summary>
              <div v-if="reportEditHistoryLoading" class="report-edit-empty">正在加载...</div>
              <div v-else-if="!reportEditHistory.length" class="report-edit-empty">暂无修改历史</div>
              <article v-for="item in reportEditHistory" v-else :key="item.editId" class="report-edit-history-item">
                <div>
                  <strong>{{ item.editMode }}</strong>
                  <span>{{ item.createdAt }}</span>
                </div>
                <p>{{ item.instruction }}</p>
                <button type="button" class="result-action-btn" @click="copyReportEditResult(item.editedText)">复制</button>
              </article>
            </details>
          </aside>

          <article
            v-if="generatedHtml"
            class="report-html prose prose-invert max-w-none text-sm leading-relaxed bg-black/20 border border-neon-cyan/10 rounded p-6"
            v-html="sanitizedHtml"
          ></article>
          <div v-else class="report-html bg-black/20 border border-neon-cyan/10 rounded p-6 text-slate-500">
            报告文件内容为空或尚未读取到正文，请刷新列表后重新打开该报告。
          </div>
        </section>

        <section v-else-if="activeResultTab === 'sources'" class="result-tab-panel">
          <div class="source-search-page">
            <div class="source-task-strip">
              <div v-for="item in resultInfoItems" :key="item[0]" class="source-task-strip-item">
                <span>{{ item[0] }}</span>
                <strong>{{ item[1] }}</strong>
              </div>
            </div>

            <div class="source-stat-row">
              <button
                v-for="card in sourceCardConfigs"
                :key="card.key"
                class="source-stat-card source-stat-clickable source-metric-card"
                :class="[{ active: activeSourceType === card.key }, `source-metric-${card.tone}`]"
                type="button"
                @click="selectSourceType(card.key)"
              >
                <span class="source-stat-icon">{{ card.icon }}</span>
                <span class="source-metric-body">
                  <span class="source-stat-title">{{ card.title }}</span>
                  <strong class="source-stat-value">{{ card.value }}</strong>
                  <span class="source-metric-desc">{{ card.desc }}</span>
                </span>
              </button>
            </div>

            <div class="source-count-note">
              口径说明：数据库检索工具来自 PG 向量库/数据库；互联网搜索工具来自联网检索与正文抽取。报告引用编号和结构化整理状态作为信源属性展示，不作为主分类混算。
            </div>

            <section v-if="sourceSupplementStatus.visible" class="source-supplement-status">
              <header>
                <strong>{{ sourceSupplementStatus.triggered ? '数据库有效信源不足，已启动公开信源补充' : '公开信源补充状态' }}</strong>
                <span>{{ sourceSupplementStatus.reason }}</span>
              </header>
              <div class="source-supplement-metrics">
                <div><b>{{ sourceSupplementStatus.databaseAccepted }}</b><span>数据库有效</span></div>
                <div><b>{{ sourceSupplementStatus.queryCount }}</b><span>Web 查询</span></div>
                <div><b>{{ sourceSupplementStatus.searchResultCount }}</b><span>搜索候选</span></div>
                <div><b>{{ sourceSupplementStatus.fetchedCount }}</b><span>抓取成功</span></div>
                <div><b>{{ sourceSupplementStatus.acceptedCount }}</b><span>补充 accepted</span></div>
                <div><b>{{ sourceSupplementStatus.rejectedCount }}</b><span>已过滤</span></div>
                <div><b>{{ sourceSupplementStatus.finalCount }}</b><span>最终可用</span></div>
                <div><b>{{ Math.round(sourceSupplementStatus.fetchSuccessRate * 100) }}%</b><span>抓取成功率</span></div>
                <div><b>{{ sourceSupplementStatus.deduplicationRemoved }}</b><span>去重条数</span></div>
                <div><b>{{ sourceSupplementStatus.referencedCount }}</b><span>最终引用</span></div>
                <div><b>{{ (sourceSupplementStatus.durationMs / 1000).toFixed(1) }}s</b><span>补充耗时</span></div>
              </div>
            </section>

            <div class="source-sub-filter" aria-label="信源类型筛选">
              <button
                v-for="item in sourceTypeOptions"
                :key="item.key"
                type="button"
                :class="{ active: activeSourceType === item.key }"
                @click="selectSourceType(item.key)"
              >
                {{ item.label }}
              </button>
            </div>

            <div class="source-table-panel">
              <header class="source-table-heading">
                <div>
                  <h2>{{ activeSourceConfig.title }}</h2>
                  <p>{{ activeSourceConfig.desc }}</p>
                </div>
                <button class="source-fixed-refresh" type="button" :disabled="sourceListLoading" @click="reloadSourceRows">
                  {{ sourceListLoading ? '加载中...' : '刷新' }}
                </button>
              </header>

              <div class="source-toolbar">
                <label class="source-search-box">
                  <span>⌕</span>
                  <input
                    v-model="sourceSearchQuery"
                    type="search"
                    placeholder="搜索标题 / 来源 / 关键词"
                  />
                </label>
                <select v-model="sourceKindFilter" aria-label="来源类型筛选">
                  <option v-for="item in sourceKindOptions" :key="item" :value="item">{{ item }}</option>
                </select>
                <select v-model="sourceTimeFilter" aria-label="时间范围筛选">
                  <option v-for="item in sourceTimeOptions" :key="item.key" :value="item.key">{{ item.label }}</option>
                </select>
                <select v-model="sourceSortMode" aria-label="排序">
                  <option v-for="item in sourceSortOptions" :key="item.key" :value="item.key">{{ item.label }}</option>
                </select>
              </div>

              <div ref="sourceListRef" class="source-table-scroll">
                <div v-if="sourceListLoading && !sourceListItems.length" class="source-table-skeleton">
                  <i v-for="item in 5" :key="item"></i>
                </div>
                <div v-else-if="sourceListError" class="source-panel-error">
                  <strong>信源加载失败</strong>
                  <p>{{ sourceListError }}</p>
                  <button type="button" @click="reloadSourceRows">重新加载</button>
                </div>
                <div v-else-if="!filteredSourceRows.length" class="source-empty-state">
                  <strong>{{ currentSourceEmptyTitle }}</strong>
                  <p>{{ currentSourceEmptyDesc }}</p>
                </div>
                <table v-else class="source-data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>信源标题</th>
                      <th>来源类型</th>
                      <th>发布机构</th>
                      <th>发布时间</th>
                      <th>相关性</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="(source, index) in paginatedSourceRows" :key="source.id">
                      <tr :class="{ expanded: expandedSourceListId === source.id }">
                        <td class="source-index-cell">
                          <button type="button" @click="toggleSourceListItem(source.id)">
                            {{ expandedSourceListId === source.id ? '⌄' : '›' }}
                          </button>
                          <span>{{ String((sourceCurrentPage - 1) * sourceListPageSize + index + 1).padStart(2, '0') }}</span>
                        </td>
                        <td class="source-title-cell">
                          <strong>{{ source.title }}</strong>
                          <p>{{ source.summary }}</p>
                        </td>
                        <td><span class="source-type-pill">{{ source.sourceType || '--' }}</span></td>
                        <td>{{ source.sourceName || '--' }}</td>
                        <td>{{ source.publishTime || '--' }}</td>
                        <td><span class="source-score">{{ source.relevance || '--' }}</span></td>
                        <td>
                          <div class="source-row-actions">
                            <button type="button" @click="toggleSourceListItem(source.id)">查看详情</button>
                            <button type="button" @click="copySourceListItem(source)">复制引用</button>
                          </div>
                        </td>
                      </tr>
                      <tr v-if="expandedSourceListId === source.id" class="source-detail-row">
                        <td colspan="7">
                          <div class="source-detail-grid">
                            <div>
                              <span>完整摘要</span>
                              <p>{{ source.summary || '暂无摘要。' }}</p>
                            </div>
                            <div>
                              <span>正文片段</span>
                              <p>{{ source.detail || '暂无正文片段。' }}</p>
                            </div>
                            <div>
                              <span>来源 URL</span>
                              <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.url }}</a>
                              <p v-else>暂无 URL。</p>
                            </div>
                            <div>
                              <span>采集方式 / 失败原因</span>
                              <p>{{ source.failedReason || source.method || source.status || '暂无补充信息。' }}</p>
                            </div>
                          </div>
                          <div class="source-detail-actions">
                            <button type="button" @click="copySourceListItem(source)">复制引用</button>
                            <button type="button" @click="importSourceListItemAsReportContext(source)">作为编报背景</button>
                          </div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>

              <footer class="source-pagination">
                <span>共 {{ filteredSourceRows.length }} 条</span>
                <button type="button" :disabled="sourceCurrentPage <= 1" @click="setSourcePage(sourceCurrentPage - 1)">上一页</button>
                <button
                  v-for="page in visibleSourcePages()"
                  :key="page"
                  type="button"
                  :class="{ active: sourceCurrentPage === page }"
                  @click="setSourcePage(page)"
                >
                  {{ page }}
                </button>
                <button type="button" :disabled="sourceCurrentPage >= sourceTotalPages" @click="setSourcePage(sourceCurrentPage + 1)">下一页</button>
                <button
                  v-if="sourceListHasMore"
                  type="button"
                  :disabled="sourceListLoading"
                  @click="loadMoreSourceRows"
                >
                  {{ sourceListLoading ? '加载中...' : '加载更多' }}
                </button>
                <span>每页 {{ sourceListPageSize }} 条</span>
              </footer>

              <footer v-if="sourceListNotice" class="source-fixed-notice">{{ sourceListNotice }}</footer>
            </div>
          </div>
        </section>

        <section v-else-if="activeResultTab === 'planning'" class="result-tab-panel">
          <div v-if="!planningSelectionView.available" class="planning-empty-state">
            <strong>暂无规划选择记录</strong>
            <p>当前任务没有保存可展示的规划勾选信息。新生成的编报任务会在这里展示规划阶段的选择结果。</p>
          </div>
          <div v-else class="planning-selection-page">
            <header class="planning-selection-hero">
              <div>
                <span>规划选择</span>
                <h2>本次编报采用的规划勾选结果</h2>
                <p>展示正式提交编报前，用户在规划阶段确认的检索词、信源范围、章节方向和补充要求。</p>
              </div>
            </header>

            <div class="planning-summary-grid">
              <button type="button" @click="scrollPlanningSection('planning-search-queries')">
                <span>检索词</span>
                <strong>查看选择</strong>
              </button>
              <button type="button" @click="scrollPlanningSection('planning-source-scope')">
                <span>信源范围</span>
                <strong>查看范围</strong>
              </button>
              <button type="button" @click="scrollPlanningSection('planning-modules')">
                <span>编报模块</span>
                <strong>查看章节</strong>
              </button>
              <button type="button" @click="scrollPlanningSection('planning-modules')">
                <span>选择方向</span>
                <strong>查看方向</strong>
              </button>
            </div>

            <section id="planning-search-queries" class="planning-selection-section">
              <div class="planning-section-heading">
                <h3>检索词选择</h3>
                <p>用于触发资料检索和信源召回的主题关键词。</p>
              </div>
              <div v-if="planningSelectionView.searchQueries.length" class="planning-chip-list">
                <span v-for="query in planningSelectionView.searchQueries" :key="query">{{ query }}</span>
              </div>
              <div v-else class="planning-muted-box">未保存检索词选择。</div>
            </section>

            <section id="planning-source-scope" class="planning-selection-section">
              <div class="planning-section-heading">
                <h3>信源范围</h3>
                <p>规划阶段选择纳入检索的材料类型和来源范围。</p>
              </div>
              <div v-if="planningSelectionView.sourceScopes.length" class="planning-source-grid">
                <article
                  v-for="source in planningSelectionView.sourceScopes"
                  :key="source.id || source.label"
                  :class="{ 'planning-database-source': source.id === 'database-source', disabled: source.status === 'disabled' }"
                >
                  <strong>{{ source.label }}</strong>
                  <p>{{ source.detail || '已纳入本次编报信源范围。' }}</p>
                </article>
              </div>
              <div v-else class="planning-muted-box">未保存信源范围选择。</div>
            </section>

            <section id="planning-modules" class="planning-selection-section">
              <div class="planning-section-heading">
                <h3>章节与方向选择</h3>
                <p>正式编报时采用的章节模块和每个模块下的重点方向。</p>
              </div>
              <div v-if="planningSelectionView.modules.length" class="planning-module-list">
                <article v-for="module in planningSelectionView.modules" :key="module.id" class="planning-module-card">
                  <div class="planning-module-title">
                    <span>{{ module.type }}</span>
                    <strong>{{ module.title }}</strong>
                  </div>
                  <div v-if="module.directions.length" class="planning-direction-list">
                    <div v-for="direction in module.directions" :key="direction.id || direction.label" class="planning-direction-item">
                      <strong>{{ direction.label }}</strong>
                      <p>{{ direction.detail || '已选择纳入正式编报。' }}</p>
                    </div>
                  </div>
                  <div v-else class="planning-muted-box">该模块未保存具体方向。</div>
                </article>
              </div>
              <div v-else class="planning-muted-box">未保存章节方向选择。</div>
            </section>

            <section
              v-if="planningSelectionView.manualSources.length || planningSelectionView.parameterEntries.length || planningSelectionView.supplement || planningSelectionView.freeTextContext"
              class="planning-selection-section"
            >
              <div class="planning-section-heading">
                <h3>补充要求</h3>
                <p>用户在规划确认前额外填写的限定条件、补充信源和背景说明。</p>
              </div>
              <div class="planning-extra-grid">
                <article v-if="planningSelectionView.parameterEntries.length">
                  <h4>参数信息</h4>
                  <p v-for="entry in planningSelectionView.parameterEntries" :key="entry.key">
                    <span>{{ entry.key }}</span>{{ entry.value }}
                  </p>
                </article>
                <article v-if="planningSelectionView.manualSources.length">
                  <h4>补充信源</h4>
                  <p v-for="source in planningSelectionView.manualSources" :key="source">{{ source }}</p>
                </article>
                <article v-if="planningSelectionView.supplement">
                  <h4>补充方向</h4>
                  <p>{{ planningSelectionView.supplement }}</p>
                </article>
                <article v-if="planningSelectionView.freeTextContext">
                  <h4>背景说明</h4>
                  <p>{{ planningSelectionView.freeTextContext }}</p>
                </article>
              </div>
            </section>
          </div>
        </section>

        <section v-else-if="activeResultTab === 'citations'" class="result-tab-panel">
          <div v-if="acceptedCitationSourcesLoading" class="source-empty-state">
            正在加载后端已校验引用...
          </div>
          <div v-else-if="!citationItems.length" class="source-empty-state">
            当前报告未返回结构化引用依据。
          </div>
          <div v-else class="citation-list">
            <article v-for="item in citationItems" :key="item.number" class="citation-card">
              <div class="citation-number">[{{ item.number }}]</div>
              <div class="citation-body">
                <div class="citation-title">{{ item.title }}</div>
                <div class="citation-meta">
                  <span>对应章节：{{ item.chapter }}</span>
                  <span>来源机构：{{ item.sourceName }}</span>
                  <span>采集方式：{{ item.method }}</span>
                  <span>可信度：{{ item.credibility }}</span>
                </div>
                <p>{{ item.summary }}</p>
              </div>
            </article>
          </div>
        </section>

        <section v-else-if="activeResultTab === 'quality'" class="result-tab-panel">
          <div class="quality-review-panel">
            <header class="quality-review-header">
              <div>
                <span class="quality-eyebrow">QUALITY REVIEW</span>
                <h2>成稿自检</h2>
                <p>检查报告是否围绕规划展开、信源是否清楚、风险判断是否有依据。</p>
              </div>
              <button type="button" class="result-action-btn result-action-primary" :disabled="qualityReviewRunning" @click="rerunQualityReview">
                {{ qualityReviewRunning ? '自检中...' : '重新自检' }}
              </button>
            </header>

            <div v-if="qualityReviewLoading" class="source-empty-state">正在读取成稿自检结果...</div>
            <div v-else-if="qualityReviewError" class="report-edit-alert error">{{ qualityReviewError }}</div>
            <div v-else-if="!qualityReview" class="source-empty-state">
              暂无成稿自检结果。可点击“重新自检”生成检查建议。
            </div>
            <div v-else class="quality-review-content">
              <div v-if="qualityReviewNotice" class="report-edit-alert notice">{{ qualityReviewNotice }}</div>
              <div v-if="qualityReview.status === 'failed'" class="report-edit-alert error">
                {{ qualityReview.errorMessage || '成稿自检失败，可稍后重试。' }}
              </div>

              <div class="quality-score-grid">
                <article class="quality-overall-card">
                  <span>总体评分</span>
                  <strong>{{ qualityScoreLabel(qualityReview.overallScore) }}</strong>
                  <p>{{ qualityReview.summary || '暂无摘要。' }}</p>
                  <em>字数估算：{{ qualityReview.wordCount || '--' }}</em>
                </article>
                <article v-for="item in qualityDimensionCards" :key="item.label" class="quality-dimension-card">
                  <span>{{ item.label }}</span>
                  <strong>{{ qualityScoreLabel(item.score) }}</strong>
                </article>
              </div>

              <div class="quality-section">
                <h3>检查项</h3>
                <div class="quality-check-grid">
                  <article v-for="check in qualityReview.checks || []" :key="check.key || check.label" class="quality-check-card" :class="`quality-check-${check.status || 'unknown'}`">
                    <strong>{{ check.label || check.key }}</strong>
                    <span>{{ qualityStatusLabel(check.status) }}</span>
                    <p>{{ check.comment }}</p>
                  </article>
                </div>
              </div>

              <div class="quality-section">
                <h3>问题清单</h3>
                <div v-if="!(qualityReview.issues || []).length" class="source-empty-state">未发现需要优先处理的问题。</div>
                <article v-for="issue in qualityReview.issues || []" v-else :key="`${issue.section}-${issue.problem}-${issue.targetText}`" class="quality-issue-card">
                  <div class="quality-issue-head">
                    <span>{{ issue.severity || 'warning' }}</span>
                    <strong>{{ issue.section || '报告正文' }}</strong>
                  </div>
                  <p><b>问题：</b>{{ issue.problem }}</p>
                  <p v-if="issue.evidence"><b>证据：</b>{{ issue.evidence }}</p>
                  <p><b>建议：</b>{{ issue.suggestion }}</p>
                  <button type="button" class="result-action-btn" @click="openReportEditFromQualityIssue(issue)">
                    发起局部修改
                  </button>
                </article>
              </div>

              <div class="quality-section quality-bottom-grid">
                <div>
                  <h3>推荐修改</h3>
                  <article v-for="item in qualityReview.recommendedEdits || []" :key="`${item.section}-${item.instruction}`" class="quality-edit-card">
                    <strong>{{ item.section || '报告正文' }}</strong>
                    <span>{{ item.editMode || 'polish' }}</span>
                    <p>{{ item.instruction }}</p>
                  </article>
                  <div v-if="!(qualityReview.recommendedEdits || []).length" class="source-empty-state">暂无推荐修改。</div>
                </div>
                <div>
                  <h3>信源使用情况</h3>
                  <div class="quality-source-usage">
                    <span>数据库信源 <b>{{ qualityReview.sourceUsage?.databaseSourcesUsed ?? 0 }}</b></span>
                    <span>互联网搜索 <b>{{ qualityReview.sourceUsage?.internetSourcesUsed ?? 0 }}</b></span>
                    <span>未核实判断 <b>{{ qualityReview.sourceUsage?.unverifiedClaims ?? 0 }}</b></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section v-else class="result-tab-panel">
          <div class="task-progress-panel">
            <div class="task-stage-flow">
              <article
                v-for="stage in progressStageFlow"
                :key="stage.key"
                class="task-stage-card"
                :class="`task-stage-${stage.status}`"
              >
                <div class="task-stage-badge">{{ stage.status === 'done' ? '✓' : stage.number }}</div>
                <div class="task-stage-copy">
                  <strong>{{ stage.title }}</strong>
                  <span>{{ stage.desc }}</span>
                </div>
                <em>{{ progressStatusLabel(stage.status) }}</em>
              </article>
            </div>

            <div v-if="false" class="ai-process-panel">
              <header class="ai-process-header">
                <div>
                  <strong>AI执行过程</strong>
                  <span>{{ taskProgressView.subtitle }}</span>
                </div>
                <span>{{ progressStatusLabel(overallProgressStatus) }}</span>
              </header>
              <div class="ai-process-grid">
                <article
                  v-for="task in executionTaskCards"
                  :key="task.key"
                  class="ai-process-card"
                  :class="`ai-process-${task.status}`"
                >
                  <div class="ai-process-icon">{{ task.status === 'done' ? '✓' : task.icon }}</div>
                  <div>
                    <strong>{{ task.title }}</strong>
                    <p>{{ task.desc }}</p>
                  </div>
                  <span>{{ progressStatusLabel(task.status) }}</span>
                </article>
              </div>
            </div>
          </div>

          <details class="source-technical-details result-technical-details" open>
            <summary>查看技术详情</summary>
            <div ref="liveLogListRef" class="source-technical-log" @scroll="handleLogScroll('live', $event)">
              <div v-if="technicalLogs.length" class="space-y-3">
                <div
                  v-for="log in technicalLogs"
                  :key="log.id"
                  class="friendly-log-card"
                  :class="friendlyLogStatusClass(translateHermesLog(log).status)"
                >
                  <div class="friendly-log-main">
                    <div class="friendly-log-dot"></div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <div class="friendly-log-stage">{{ translateHermesLog(log).stage }}</div>
                          <div v-if="translateHermesLog(log).toolDisplayName" class="friendly-log-tool">
                            工具：{{ translateHermesLog(log).toolDisplayName }}
                          </div>
                          <div class="friendly-log-title">{{ translateHermesLog(log).title }}</div>
                        </div>
                        <span class="friendly-log-status">{{ friendlyLogStatusLabel(translateHermesLog(log).status) }}</span>
                      </div>
                      <div class="friendly-log-description">{{ translateHermesLog(log).description }}</div>
                      <pre v-if="translateHermesLog(log).raw" class="friendly-log-raw">{{ translateHermesLog(log).raw }}</pre>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="source-empty-state">当前任务暂无可展示进度日志。</div>
              <button
                v-if="liveLogHasNewItems"
                class="log-new-items-button"
                type="button"
                @click="scrollLogToBottom('live')"
              >
                有新日志，点击查看最新
              </button>
            </div>
          </details>
        </section>
      </div>
    </div>

  </main>
</template>
