<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  analyzeDraftEvent,
  generateDraftOutline,
  getDraftEvent,
  getDraftEvents,
  getDraftEventOutlines,
  getDraftOutline,
  createReportJob,
  importDraftOutline,
  manualUpdateDraftOutline,
  refineDraftOutline,
} from '../lib/api.js'
import { displayUserRoleNames } from '../lib/permissionModules.js'
import { normalizeRiskSummary, riskSummaryTitle } from '../lib/riskSummary.js'
import DraftEditorToolbar from './DraftEditorToolbar.vue'
import StrategyTabs from './StrategyTabs.vue'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
  initialEventId: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['back', 'request-login', 'report-job-created'])

const form = reactive({
  title: '',
  materials: '',
  linksText: '',
  category: '',
  region: '',
})

const outlinePreference = ref('')
const refineFeedback = ref('')
const editNote = ref('')
const isAnalyzing = ref(false)
const isGeneratingOutline = ref(false)
const isRefining = ref(false)
const isSavingManual = ref(false)
const isLoadingEvents = ref(false)
const errorMessage = ref('')
const notice = ref('')
const eventResult = ref(null)
const eventList = ref([])
const outlineVersions = ref([])
const selectedOutline = ref(null)
const editMode = ref(false)
const previewMode = ref(false)
const confirmationMode = ref(false)
const importStatus = ref('待确认当前提纲版本')
const editSnapshot = ref('')
const importedPlan = ref(null)
const isImportingOutline = ref(false)
const isCreatingReportJob = ref(false)
const createdReportJob = ref(null)
const showAllRiskVerifications = ref(false)
const leftPanelOpen = ref(false)
const rightPanelOpen = ref(false)
const lastSavedAt = ref(null)
const saveFailed = ref(false)
const eventSearch = ref('')

const outlineEdit = reactive({
  reportTitle: '',
  reportTheme: '',
  coreArgument: '',
  outlineItems: [],
  writingFocus: [],
  sourceRequirements: [],
  uncertaintiesToVerify: [],
})

const stepDefinitions = [
  { key: 'input', title: '事件输入' },
  { key: 'analysis', title: '事件分析' },
  { key: 'outline', title: '拟稿提纲' },
  { key: 'confirm', title: '确认版本' },
  { key: 'import', title: '导入深度编报' },
]

const cnNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

const analysis = computed(() => eventResult.value?.analysis || eventResult.value?.event?.analysis || null)
const attitudes = computed(() => eventResult.value?.attitudes || analysis.value?.attitudes || [])
const currentEventId = computed(() => eventResult.value?.eventId || eventResult.value?.event?.eventId || '')
const currentOutlineId = computed(() => selectedOutline.value?.outlineId || '')
const canUse = computed(() => Boolean(props.currentUser))
const displayOutline = computed(() => normalizeOutlineForDisplay(selectedOutline.value?.outline || {}))
const hasAnalysis = computed(() => Boolean(analysis.value))
const hasOutline = computed(() => Boolean(selectedOutline.value?.outline && displayOutline.value.outlineItems.length))
const isVersionConfirmed = computed(() => confirmationMode.value && hasOutline.value && !editMode.value)
const userModules = computed(() => Array.isArray(props.currentUser?.modules) ? props.currentUser.modules : [])
const canImportDraftOutline = computed(() => userModules.value.includes('draft'))
const displayRoleName = computed(() => displayUserRoleNames(props.currentUser))
const isImportReady = computed(() => isVersionConfirmed.value && canImportDraftOutline.value && !importedPlan.value)
const isReportJobReady = computed(() => Boolean(importedPlan.value?.planId) && canImportDraftOutline.value && !editMode.value)
const importedPlanIdShort = computed(() => importedPlan.value?.planId ? shortId(importedPlan.value.planId) : '')
const importedVersionLabel = computed(() => importedPlan.value?.outlineId === currentOutlineId.value ? selectedVersionLabel.value : (importedPlan.value?.versionLabel || '已导入版本'))
const currentVersionTime = computed(() => selectedOutline.value?.createdAt ? formatTime(selectedOutline.value.createdAt) : '')
const selectedVersionLabel = computed(() => selectedOutline.value ? versionLabel(selectedOutline.value) : '尚未选择版本')
const currentEventTitle = computed(() => eventResult.value?.event?.title || form.title || '未命名事件')
const editingVersionLabel = computed(() => selectedOutline.value ? versionLabel(selectedOutline.value) : '当前版本')
const previewDisplayOutline = computed(() => normalizeOutlineForDisplay(editDraftToOutline()))
const hasEditChanges = computed(() => editMode.value && editSnapshot.value !== serializeEditState())
const editorSaveState = computed(() => {
  if (saveFailed.value) return 'failed'
  if (isSavingManual.value) return 'saving'
  if (hasEditChanges.value) return 'dirty'
  return 'saved'
})
const editorSaveStateLabel = computed(() => {
  if (saveFailed.value) return '保存失败'
  if (isSavingManual.value) return '保存中'
  if (hasEditChanges.value) return '存在未保存修改'
  return lastSavedAt.value ? `已保存 ${formatClock(lastSavedAt.value)}` : '已保存'
})
const eventDescription = computed(() => (
  analysis.value?.basicSituation
  || analysis.value?.oneSentenceSummary
  || eventResult.value?.event?.summary
  || eventResult.value?.summary
  || '当前事件暂无补充说明。'
))

const currentStepKey = computed(() => {
  if (importedPlan.value || isImportReady.value) return 'import'
  if ((editMode.value || confirmationMode.value || isRefining.value) && hasOutline.value) return 'confirm'
  if (hasOutline.value) return 'outline'
  if (hasAnalysis.value) return 'analysis'
  return 'input'
})

const currentStepIndex = computed(() => stepDefinitions.findIndex((step) => step.key === currentStepKey.value))
const expandedStrategyCards = reactive({
  writingFocus: false,
  sourceRequirements: false,
  uncertaintiesToVerify: false,
})

const sourceTypeTags = [
  { label: '官方文件', tone: 'official' },
  { label: '主流媒体', tone: 'media' },
  { label: '行业组织', tone: 'industry' },
  { label: '研究报告', tone: 'report' },
  { label: '企业声明', tone: 'company' },
]

const analysisCards = computed(() => {
  const item = analysis.value || {}
  return [
    { label: '一句话概括', value: item.oneSentenceSummary || item.summary || '' },
    { label: '基本情况', value: item.basicSituation || item.background || '' },
    { label: '主要事实', value: compactList(item.mainFacts) },
    { label: '各方态度摘要', value: compactAttitudes(attitudes.value) },
  ].map((entry) => ({ ...entry, value: entry.value || '暂无' }))
})
const riskSummary = computed(() => {
  const item = analysis.value || {}
  return normalizeRiskSummary(item.riskSummary ?? item.risks ?? item.riskToUs)
})
const riskTitle = computed(() => riskSummaryTitle({
  ...(analysis.value || {}),
  analysis: analysis.value || {},
  event: eventResult.value?.event || eventResult.value || {},
}))
const visibleRiskVerifications = computed(() => (
  showAllRiskVerifications.value
    ? riskSummary.value.pendingVerifications
    : riskSummary.value.pendingVerifications.slice(0, 5)
))
const riskVerificationHasMore = computed(() => riskSummary.value.pendingVerifications.length > 5)
const filteredEventList = computed(() => {
  const query = eventSearch.value.trim().toLowerCase()
  if (!query) return eventList.value
  return eventList.value.filter((item) => String(item.title || '').toLowerCase().includes(query))
})

function parseLinks(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function showError(error) {
  errorMessage.value = error instanceof Error ? error.message : String(error)
}

function clearMessages() {
  errorMessage.value = ''
  notice.value = ''
}

async function loadEvents() {
  if (!canUse.value) return
  isLoadingEvents.value = true
  try {
    const result = await getDraftEvents({ page: 1, pageSize: 20 })
    eventList.value = Array.isArray(result?.items) ? result.items : []
  } catch (error) {
    showError(error)
  } finally {
    isLoadingEvents.value = false
  }
}

async function runAnalyze() {
  clearMessages()
  if (!canUse.value) {
    emit('request-login')
    return
  }
  if (!form.title.trim()) {
    errorMessage.value = '请先输入事件标题'
    return
  }
  isAnalyzing.value = true
  showAllRiskVerifications.value = false
  selectedOutline.value = null
  outlineVersions.value = []
  editMode.value = false
  confirmationMode.value = false
  resetImportState('待确认当前提纲版本')
  try {
    eventResult.value = await analyzeDraftEvent({
      title: form.title,
      materials: form.materials,
      links: parseLinks(form.linksText),
      category: form.category,
      region: form.region,
    })
    notice.value = '事件分析已生成，请继续生成拟稿提纲'
    await loadEvents()
  } catch (error) {
    showError(error)
  } finally {
    isAnalyzing.value = false
  }
}

async function openEvent(eventId) {
  clearMessages()
  if (!eventId) return
  editMode.value = false
  confirmationMode.value = false
  showAllRiskVerifications.value = false
  resetImportState('待确认当前提纲版本')
  try {
    eventResult.value = await getDraftEvent(eventId)
    form.title = eventResult.value?.event?.title || form.title
    form.category = eventResult.value?.event?.category || ''
    form.region = eventResult.value?.event?.region || ''
    outlineVersions.value = await getDraftEventOutlines(eventId)
    selectedOutline.value = eventResult.value?.latestOutline || outlineVersions.value[0] || null
    if (selectedOutline.value?.outlineId) await loadOutline(selectedOutline.value.outlineId)
  } catch (error) {
    showError(error)
  }
}

async function createOutline() {
  clearMessages()
  if (!currentEventId.value) {
    errorMessage.value = '请先完成事件分析'
    return
  }
  isGeneratingOutline.value = true
  editMode.value = false
  confirmationMode.value = false
  resetImportState('待确认当前提纲版本')
  try {
    selectedOutline.value = await generateDraftOutline({
      eventId: currentEventId.value,
      outlinePreference: outlinePreference.value,
    })
    await refreshOutlineVersions()
    syncOutlineEdit()
    notice.value = `已生成 V${selectedOutline.value.versionNo} 提纲`
  } catch (error) {
    showError(error)
  } finally {
    isGeneratingOutline.value = false
  }
}

async function refineOutline() {
  clearMessages()
  if (!currentOutlineId.value) {
    errorMessage.value = '请先生成或选择提纲'
    return
  }
  if (!refineFeedback.value.trim()) {
    errorMessage.value = '请填写 AI 修改反馈'
    return
  }
  isRefining.value = true
  editMode.value = false
  confirmationMode.value = true
  resetImportState('AI 修改后请重新确认版本')
  try {
    selectedOutline.value = await refineDraftOutline({
      outlineId: currentOutlineId.value,
      userFeedback: refineFeedback.value,
    })
    refineFeedback.value = ''
    await refreshOutlineVersions()
    syncOutlineEdit()
    notice.value = `已生成 V${selectedOutline.value.versionNo} AI 修改版`
  } catch (error) {
    showError(error)
  } finally {
    isRefining.value = false
  }
}

async function saveManualOutline() {
  clearMessages()
  if (!currentOutlineId.value) {
    errorMessage.value = '请先生成或选择提纲'
    return
  }
  isSavingManual.value = true
  saveFailed.value = false
  confirmationMode.value = true
  try {
    selectedOutline.value = await manualUpdateDraftOutline({
      outlineId: currentOutlineId.value,
      outline: editToOutline(),
      editNote: editNote.value.trim().slice(0, 200),
    })
    editMode.value = false
    previewMode.value = false
    editNote.value = ''
    await refreshOutlineVersions()
    syncOutlineEdit()
    editSnapshot.value = serializeEditState()
    lastSavedAt.value = new Date()
    resetImportState('手动修改后请重新确认版本')
    notice.value = `已保存 V${selectedOutline.value.versionNo} 手动修改版`
  } catch (error) {
    saveFailed.value = true
    showError(error)
  } finally {
    isSavingManual.value = false
  }
}

async function refreshOutlineVersions() {
  if (!currentEventId.value) return
  outlineVersions.value = await getDraftEventOutlines(currentEventId.value)
}

async function loadOutline(outlineId) {
  clearMessages()
  if (editMode.value && hasEditChanges.value && !window.confirm('当前修改尚未保存，切换版本会放弃修改，确定继续吗？')) return
  try {
    selectedOutline.value = await getDraftOutline(outlineId)
    syncOutlineEdit()
    editMode.value = false
    previewMode.value = false
    confirmationMode.value = false
    resetImportState('待确认当前提纲版本')
  } catch (error) {
    showError(error)
  }
}

function enterEditMode() {
  if (!selectedOutline.value) return
  syncOutlineEdit()
  editNote.value = ''
  editSnapshot.value = serializeEditState()
  lastSavedAt.value = selectedOutline.value?.createdAt ? new Date(selectedOutline.value.createdAt) : new Date()
  saveFailed.value = false
  editMode.value = true
  previewMode.value = false
  confirmationMode.value = true
  resetImportState('编辑完成后保存为新版本')
}

function cancelEditMode() {
  if (hasEditChanges.value && !window.confirm('当前修改尚未保存，确定放弃吗？')) return
  editMode.value = false
  previewMode.value = false
  syncOutlineEdit()
}

function updateStrategyItem(key, index, value) {
  if (!Array.isArray(outlineEdit[key]) || index < 0 || index >= outlineEdit[key].length) return
  outlineEdit[key][index] = value
}

function duplicateStrategyItem(key, index) {
  if (!Array.isArray(outlineEdit[key]) || index < 0 || index >= outlineEdit[key].length) return
  outlineEdit[key].splice(index + 1, 0, itemToText(outlineEdit[key][index]))
}

function restoreStrategyItem(key, index, item) {
  if (!Array.isArray(outlineEdit[key])) return
  outlineEdit[key].splice(Math.max(0, Math.min(index, outlineEdit[key].length)), 0, item)
}

function closeResponsivePanels() {
  leftPanelOpen.value = false
  rightPanelOpen.value = false
}

function startNewEvent() {
  if (hasEditChanges.value && !window.confirm('当前修改尚未保存，确定新建事件吗？')) return
  eventResult.value = null
  selectedOutline.value = null
  outlineVersions.value = []
  editMode.value = false
  confirmationMode.value = false
  form.title = ''
  form.materials = ''
  form.linksText = ''
  form.category = ''
  form.region = ''
  closeResponsivePanels()
}

function handleBeforeUnload(event) {
  if (!hasEditChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}

function confirmCurrentVersion() {
  if (!hasOutline.value) return
  editMode.value = false
  confirmationMode.value = true
  resetImportState(canImportDraftOutline.value ? '当前版本已确认，可生成深度编报规划' : '当前账号无权导入深度编报')
  notice.value = `已确认 ${selectedVersionLabel.value}`
}

async function importCurrentOutline() {
  clearMessages()
  if (!currentOutlineId.value) {
    errorMessage.value = '请先选择提纲版本'
    return
  }
  if (!canImportDraftOutline.value) {
    errorMessage.value = '当前账号无权导入深度编报'
    return
  }
  if (!isVersionConfirmed.value) {
    errorMessage.value = '请先确认当前提纲版本'
    return
  }
  isImportingOutline.value = true
  try {
    const result = await importDraftOutline({ outlineId: currentOutlineId.value })
    importedPlan.value = {
      planId: result.planId,
      outlineId: result.outlineId,
      eventId: result.eventId,
      plan: result.plan || {},
      createdAt: result.createdAt || new Date().toISOString(),
      versionLabel: selectedVersionLabel.value,
    }
    importStatus.value = '已生成深度编报规划'
    notice.value = `已生成深度编报规划：${shortId(result.planId)}`
  } catch (error) {
    showError(error)
  } finally {
    isImportingOutline.value = false
  }
}

async function createDeepReportJob() {
  clearMessages()
  if (!isReportJobReady.value) return
  isCreatingReportJob.value = true
  try {
    const plan = importedPlan.value.plan || {}
    const reportTitle = plan.reportTitle || displayOutline.value.reportTitle || currentEventTitle.value
    const knownContext = {
      kind: 'draft_assistant_import',
      topic: reportTitle,
      reportType: 'K报',
      draftAssistantMode: true,
      eventId: importedPlan.value.eventId,
      outlineId: importedPlan.value.outlineId,
      planId: importedPlan.value.planId,
      databaseSourceOptions: {
        enabled: true,
        lookbackDays: 30,
        maxMetadataRows: 50,
        maxContentRows: 8,
      },
      draftAssistantInstructions: [
        '严格依据用户已确认的 Draft Assistant report_plan 生成深度编报。',
        '不得脱离确认提纲自由发挥。',
        '缺少来源的信息必须标注待核实。',
      ],
    }
    const created = await createReportJob({
      skill: 'write-hb',
      payload: {
        title: reportTitle,
        topic: reportTitle,
        report_type: 'K报',
        eventId: importedPlan.value.eventId,
        outlineId: importedPlan.value.outlineId,
        planId: importedPlan.value.planId,
        draftAssistantMode: true,
        known_context: JSON.stringify(knownContext, null, 2),
        focus_areas: ['主要内容', '各方态度', '涉我风险', '趋势研判'],
        language: 'zh-CN',
      },
    })
    createdReportJob.value = { ...created, payload: { topic: reportTitle, report_type: 'K报' } }
    importStatus.value = `深度编报任务已创建：${shortId(created.jobId)}`
    notice.value = '已创建深度编报任务，正在进入任务进度页'
    emit('report-job-created', createdReportJob.value)
  } catch (error) {
    showError(error)
  } finally {
    isCreatingReportJob.value = false
  }
}

function resetImportState(status = '待确认当前提纲版本') {
  importedPlan.value = null
  createdReportJob.value = null
  importStatus.value = status
}

function previewEditedOutline() {
  clearMessages()
  try {
    editToOutline()
    previewMode.value = true
  } catch (error) {
    showError(error)
  }
}

function continueEditing() {
  previewMode.value = false
}

function syncOutlineEdit() {
  const outline = normalizeOutlineForDisplay(selectedOutline.value?.outline || {})
  outlineEdit.reportTitle = outline.reportTitle || ''
  outlineEdit.reportTheme = outline.reportTheme || ''
  outlineEdit.coreArgument = outline.coreArgument || ''
  outlineEdit.outlineItems = cloneOutlineItems(outline.outlineItems)
  outlineEdit.writingFocus = listFromValue(outline.writingFocus)
  outlineEdit.sourceRequirements = listFromValue(outline.sourceRequirements)
  outlineEdit.uncertaintiesToVerify = listFromValue(outline.uncertaintiesToVerify)
}

function editDraftToOutline() {
  return {
    reportTitle: outlineEdit.reportTitle,
    reportTheme: outlineEdit.reportTheme,
    coreArgument: outlineEdit.coreArgument,
    outlineItems: cloneOutlineItems(outlineEdit.outlineItems).map((item) => ({
      level: 1,
      title: item.title,
      summary: item.summary,
      children: cloneOutlineItems(item.children).map((child) => ({
        level: 2,
        title: child.title,
        summary: child.summary,
      })),
    })),
    writingFocus: cleanStringList(outlineEdit.writingFocus),
    sourceRequirements: cleanStringList(outlineEdit.sourceRequirements),
    uncertaintiesToVerify: cleanStringList(outlineEdit.uncertaintiesToVerify),
  }
}

function editToOutline() {
  const outlineItems = cloneOutlineItems(outlineEdit.outlineItems)
    .map((item) => ({
      level: 1,
      title: item.title.trim(),
      summary: item.summary.trim(),
      children: cloneOutlineItems(item.children).map((child) => ({
        level: 2,
        title: child.title.trim(),
        summary: child.summary.trim(),
      })),
    }))
    .filter((item) => item.title || item.summary || item.children.length)

  if (!outlineEdit.reportTitle.trim() || !outlineEdit.reportTheme.trim() || !outlineEdit.coreArgument.trim()) {
    throw new Error('请补全建议标题、主题立意和核心判断')
  }
  const invalidTop = outlineItems.find((item) => !item.title || !item.summary)
  const invalidChild = outlineItems.flatMap((item) => item.children).find((item) => !item.title || !item.summary)
  if (!outlineItems.length || invalidTop || invalidChild) {
    throw new Error('请检查目录：每个一级/二级标题都需要填写标题和简短说明')
  }

  return {
    reportTitle: outlineEdit.reportTitle.trim(),
    reportTheme: outlineEdit.reportTheme.trim(),
    coreArgument: outlineEdit.coreArgument.trim(),
    outlineItems,
    writingFocus: cleanStringList(outlineEdit.writingFocus),
    sourceRequirements: cleanStringList(outlineEdit.sourceRequirements),
    uncertaintiesToVerify: cleanStringList(outlineEdit.uncertaintiesToVerify),
  }
}

function normalizeOutlineForDisplay(outline) {
  const normalized = {
    reportTitle: outline?.reportTitle || '',
    reportTheme: outline?.reportTheme || '',
    coreArgument: outline?.coreArgument || outline?.coreJudgement || '',
    outlineItems: normalizeOutlineItems(outline?.outlineItems),
    writingFocus: listFromValue(outline?.writingFocus).length
      ? listFromValue(outline?.writingFocus)
      : listFromValue(outline?.writingConstraints),
    sourceRequirements: listFromValue(outline?.sourceRequirements),
    uncertaintiesToVerify: listFromValue(outline?.uncertaintiesToVerify),
  }
  if (!normalized.outlineItems.length) {
    normalized.outlineItems = legacyOutlineItems(outline)
  }
  return normalized
}

function normalizeOutlineItems(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      const title = String(item?.title || '').trim()
      const summary = String(item?.summary || '').trim()
      if (!title && !summary) return null
      return {
        level: 1,
        title,
        summary,
        children: Array.isArray(item?.children)
          ? item.children
              .map((child) => ({
                level: 2,
                title: String(child?.title || '').trim(),
                summary: String(child?.summary || '').trim(),
              }))
              .filter((child) => child.title || child.summary)
          : [],
      }
    })
    .filter(Boolean)
}

function legacyOutlineItems(outline) {
  const sections = [
    ['mainContentPlan', '事件概况'],
    ['attitudesPlan', '各方态度'],
    ['riskPlan', '涉我风险'],
    ['trendPlan', '趋势研判'],
  ]
  return sections
    .map(([key, title]) => {
      const values = arrayOrEmpty(outline?.[key])
      if (!values.length) return null
      return {
        level: 1,
        title,
        summary: values.map(itemToText).join('；'),
        children: values.slice(0, 6).map((item) => ({
          level: 2,
          title: itemToText(item).split(/[，。；;,.]/)[0]?.slice(0, 40) || '分项内容',
          summary: itemToText(item),
        })),
      }
    })
    .filter(Boolean)
}

function cloneOutlineItems(items = []) {
  if (!Array.isArray(items)) return []
  return items.map((item) => ({
    level: item.level || 1,
    title: item.title || '',
    summary: item.summary || '',
    expanded: item.expanded !== false,
    children: Array.isArray(item.children) ? cloneOutlineItems(item.children) : [],
  }))
}

function addOutlineItem() {
  outlineEdit.outlineItems.push({ level: 1, title: '', summary: '', expanded: true, children: [] })
}

function removeOutlineItem(index) {
  if (!window.confirm('确定删除这个一级目录吗？')) return
  outlineEdit.outlineItems.splice(index, 1)
}

function addChildItem(item) {
  if (!Array.isArray(item.children)) item.children = []
  item.expanded = true
  item.children.push({ level: 2, title: '', summary: '' })
}

function removeChildItem(item, childIndex) {
  if (!window.confirm('确定删除这个二级目录吗？')) return
  item.children.splice(childIndex, 1)
}

function moveOutlineItem(index, direction) {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= outlineEdit.outlineItems.length) return
  const [item] = outlineEdit.outlineItems.splice(index, 1)
  outlineEdit.outlineItems.splice(nextIndex, 0, item)
}

function moveChildItem(item, childIndex, direction) {
  if (!Array.isArray(item.children)) return
  const nextIndex = childIndex + direction
  if (nextIndex < 0 || nextIndex >= item.children.length) return
  const [child] = item.children.splice(childIndex, 1)
  item.children.splice(nextIndex, 0, child)
}

function toggleOutlineItem(item) {
  item.expanded = item.expanded === false
}

function setAllOutlineItemsExpanded(expanded) {
  outlineEdit.outlineItems.forEach((item) => {
    item.expanded = expanded
  })
}

function addStrategyItem(key) {
  if (!Array.isArray(outlineEdit[key])) outlineEdit[key] = []
  outlineEdit[key].push('')
}

function removeStrategyItem(key, index) {
  if (!Array.isArray(outlineEdit[key])) return
  outlineEdit[key].splice(index, 1)
}

function moveStrategyItem(key, index, direction) {
  if (!Array.isArray(outlineEdit[key])) return
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= outlineEdit[key].length) return
  const [item] = outlineEdit[key].splice(index, 1)
  outlineEdit[key].splice(nextIndex, 0, item)
}

function cleanStringList(value) {
  return arrayOrEmpty(value)
    .map((item) => itemToText(item).trim())
    .filter(Boolean)
}

function serializeEditState() {
  return JSON.stringify({
    outline: editDraftToOutline(),
    editNote: editNote.value.trim().slice(0, 200),
  })
}

function outlineNumber(index) {
  return cnNumbers[index] || String(index + 1)
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : []
}

function listFromValue(value) {
  if (Array.isArray(value)) return value.map(itemToText).map((item) => item.trim()).filter(Boolean)
  if (typeof value === 'string') return linesToArray(value)
  return []
}

function itemToText(item) {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    return item.summary || item.title || item.name || item.content || JSON.stringify(item)
  }
  return String(item ?? '')
}

function strategyText(item) {
  const text = itemToText(item).trim()
  return text.length > 72 ? `${text.slice(0, 72)}...` : text
}

function strategyVisibleItems(items, key, max = 5) {
  const list = arrayOrEmpty(items).map(strategyText).filter(Boolean)
  return expandedStrategyCards[key] ? list : list.slice(0, max)
}

function strategyHasMore(items, key, max = 5) {
  return !expandedStrategyCards[key] && arrayOrEmpty(items).length > max
}

function toggleStrategyCard(key) {
  expandedStrategyCards[key] = !expandedStrategyCards[key]
}

function isMandatorySourceRequirement(item) {
  const text = itemToText(item)
  return /必须|时间|媒体|来源|标注/.test(text)
}

function compactList(value) {
  const items = arrayOrEmpty(value).map(itemToText).filter(Boolean)
  return items.slice(0, 4).join('；')
}

function compactAttitudes(value) {
  const items = arrayOrEmpty(value)
    .map((item) => {
      if (typeof item === 'string') return item
      const actor = item?.actor ? `${item.actor}：` : ''
      return `${actor}${item?.attitudeSummary || item?.summary || itemToText(item)}`
    })
    .filter(Boolean)
  return items.slice(0, 4).join('；')
}

function arrayToLines(value) {
  if (!Array.isArray(value)) return ''
  return value.map(itemToText).join('\n')
}

function linesToArray(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function versionLabel(item) {
  const type = item?.editType === 'ai_refine' ? 'AI修改版' : item?.editType === 'manual' ? '手动修改版' : 'AI生成版'
  return `V${item?.versionNo || '-'} ${type}`
}

function versionTypeLabel(item) {
  if (item?.editType === 'ai_refine') return 'AI修改版'
  if (item?.editType === 'manual') return '手动修改版'
  return 'AI生成版'
}

function versionSummary(item) {
  return String(item?.userFeedback || (item?.editType === 'manual' ? '手动调整提纲结构' : '基于事件分析生成')).slice(0, 60)
}

function versionClass(item) {
  return {
    active: item.outlineId === currentOutlineId.value,
    refine: item?.editType === 'ai_refine',
    manual: item?.editType === 'manual',
  }
}

function stepClass(step, index) {
  return {
    active: step.key === currentStepKey.value,
    done: index < currentStepIndex.value,
    disabled: step.key === 'import' && !isImportReady.value,
  }
}

function formatTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function formatClock(value) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false })
}

function shortId(value) {
  const text = String(value || '')
  return text.length > 12 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text
}

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  await loadEvents()
  if (props.initialEventId) await openEvent(props.initialEventId)
})

onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload))

watch(() => props.initialEventId, (eventId) => {
  if (eventId && eventId !== currentEventId.value) void openEvent(eventId)
})
</script>

<template>
  <main class="draft-assistant-main">
    <section class="draft-toolbar">
      <div>
        <h1>拟稿助手</h1>
        <p>按事件输入、事件分析、拟稿提纲、版本确认、导入编报推进拟稿流程</p>
      </div>
      <div class="draft-toolbar-actions">
        <span v-if="currentUser" class="draft-user-chip">{{ currentUser.username }} · {{ displayRoleName }}</span>
        <button class="sci-btn" type="button" @click="emit('back')">返回</button>
      </div>
    </section>

    <div v-if="!currentUser" class="draft-login-gate">
      <div>
        <h2>请先登录</h2>
        <p>拟稿助手会保存事件、信源和提纲版本，需要账号归属。</p>
      </div>
      <button class="sci-btn sci-btn-primary" type="button" @click="emit('request-login')">登录</button>
    </div>

    <template v-else>
      <nav class="draft-stepper" aria-label="拟稿步骤">
        <div
          v-for="(step, index) in stepDefinitions"
          :key="step.key"
          class="draft-step"
          :class="stepClass(step, index)"
        >
          <span class="draft-step-index">{{ index + 1 }}</span>
          <span>{{ step.title }}</span>
        </div>
      </nav>

      <div v-if="errorMessage" class="draft-error">{{ errorMessage }}</div>
      <div v-if="notice" class="draft-notice">{{ notice }}</div>

      <section class="draft-workspace-grid" :class="{ 'editor-active': editMode }">
        <button v-if="leftPanelOpen || rightPanelOpen" class="draft-panel-backdrop" type="button" aria-label="关闭侧栏" @click="closeResponsivePanels"></button>
        <aside class="draft-panel draft-left" :class="{ open: leftPanelOpen }">
          <button class="draft-panel-close" type="button" aria-label="关闭事件栏" @click="leftPanelOpen = false">×</button>
          <template v-if="editMode">
            <div class="draft-panel-head draft-event-nav-head">
              <div>
                <h2>事件输入</h2>
                <span>当前提纲所属事件</span>
              </div>
              <button class="sci-btn draft-small-btn" type="button" @click="startNewEvent">+ 新建事件</button>
            </div>
            <label class="draft-event-search">
              <span>搜索事件</span>
              <input v-model="eventSearch" class="sci-input" placeholder="搜索事件标题" />
            </label>
            <div class="draft-event-filter-tabs" role="tablist" aria-label="事件列表范围">
              <button class="active" type="button" role="tab" aria-selected="true">最近编辑</button>
              <button type="button" role="tab" aria-selected="false">全部事件</button>
            </div>
            <div class="draft-history draft-editor-event-list">
              <button
                v-for="item in filteredEventList"
                :key="item.eventId"
                class="draft-history-item"
                :class="{ selected: item.eventId === currentEventId }"
                type="button"
                @click="openEvent(item.eventId); leftPanelOpen = false"
              >
                <strong>{{ item.title }}</strong>
                <span>{{ formatTime(item.createdAt) }}</span>
                <small>{{ item.eventId === currentEventId ? '正在编辑' : '已有分析' }}</small>
              </button>
              <div v-if="!filteredEventList.length" class="draft-empty">没有匹配的事件</div>
            </div>
          </template>

          <template v-else>
          <div class="draft-panel-head">
            <h2>事件源输入</h2>
            <button class="sci-btn draft-small-btn" type="button" :disabled="isLoadingEvents" @click="loadEvents">刷新</button>
          </div>

          <label class="draft-field">
            <span>事件标题</span>
            <input v-model="form.title" class="sci-input" placeholder="输入需要分析的事件标题" />
          </label>
          <label class="draft-field">
            <span>补充材料</span>
            <textarea v-model="form.materials" class="sci-input draft-textarea" placeholder="粘贴已知事实、背景、口径或材料片段"></textarea>
          </label>
          <label class="draft-field">
            <span>相关链接</span>
            <textarea v-model="form.linksText" class="sci-input draft-links" placeholder="一行一个链接"></textarea>
          </label>
          <div class="draft-two">
            <label class="draft-field">
              <span>类别</span>
              <input v-model="form.category" class="sci-input" placeholder="例如 欧洲政治" />
            </label>
            <label class="draft-field">
              <span>地区</span>
              <input v-model="form.region" class="sci-input" placeholder="例如 欧洲" />
            </label>
          </div>
          <button class="sci-btn sci-btn-primary draft-primary" type="button" :disabled="isAnalyzing" @click="runAnalyze">
            {{ isAnalyzing ? '分析中...' : '开始分析' }}
          </button>

          <div class="draft-history">
            <h3>最近事件</h3>
            <button
              v-for="item in eventList"
              :key="item.eventId"
              class="draft-history-item"
              type="button"
              @click="openEvent(item.eventId)"
            >
              <strong>{{ item.title }}</strong>
              <span>{{ formatTime(item.createdAt) }}</span>
              <small v-if="item.ownerUsername">{{ item.ownerUsername }}</small>
            </button>
            <div v-if="!eventList.length" class="draft-empty">暂无事件分析</div>
          </div>
          </template>
        </aside>

        <section class="draft-main-workarea">
          <div v-if="currentStepKey === 'input'" class="draft-state-card draft-empty-state">
            <span class="draft-state-kicker">Step 1</span>
            <h2>先输入事件源</h2>
            <p>左侧填写事件标题、补充材料、相关链接、类别和地区后，点击“开始分析”进入事件分析步骤。</p>
          </div>

          <div v-else-if="currentStepKey === 'analysis'" class="draft-state-card">
            <div class="draft-main-head">
              <div>
                <span class="draft-state-kicker">Step 2</span>
                <h2>事件分析</h2>
                <p>分析结果已压缩为提纲生成前需要确认的关键摘要。</p>
              </div>
              <button class="sci-btn sci-btn-primary" type="button" :disabled="isGeneratingOutline" @click="createOutline">
                {{ isGeneratingOutline ? '生成中...' : '生成拟稿提纲' }}
              </button>
            </div>
            <div class="draft-analysis-summary">
              <article v-for="item in analysisCards" :key="item.label" class="draft-analysis-row">
                <span>{{ item.label }}</span>
                <p>{{ item.value }}</p>
              </article>
            </div>

            <section class="draft-risk-section" aria-label="风险研判">
              <div class="draft-risk-head">
                <h3>{{ riskTitle }}</h3>
                <span>AI 初步研判</span>
              </div>

              <div v-if="riskSummary.note === 'parse_failed'" class="draft-risk-state">
                <strong>风险信息暂时无法结构化展示</strong>
                <p>系统已保留原始分析结果，可重新运行分析或检查模型输出格式。</p>
              </div>

              <template v-else-if="riskSummary.items.length">
                <div class="draft-risk-overview">
                  <span>综合风险：{{ riskSummary.overallLevelLabel }}</span>
                  <p>
                    当前识别出 {{ riskSummary.items.length }} 项潜在风险，{{ riskSummary.pendingVerifications.length }} 项关键信息仍待核验。
                  </p>
                  <small>以下内容基于当前资料自动分析，不代表相关事实已经得到确认。</small>
                </div>

                <div class="draft-risk-list">
                  <article v-for="item in riskSummary.items" :key="item.id" class="draft-risk-card">
                    <div class="draft-risk-card-head">
                      <span class="draft-risk-badge" :class="item.riskLevel">{{ item.riskLevelLabel }}</span>
                      <div>
                        <h4>{{ item.title || item.riskType }}</h4>
                        <small v-if="item.title && item.riskType">{{ item.riskType }}</small>
                      </div>
                    </div>
                    <div v-if="item.description" class="draft-risk-block">
                      <strong>风险说明</strong>
                      <p>{{ item.description }}</p>
                    </div>
                    <div v-if="item.basis" class="draft-risk-block muted">
                      <strong>判断依据</strong>
                      <p>{{ item.basis }}</p>
                    </div>
                    <div v-if="item.uncertainty" class="draft-risk-block muted">
                      <strong>不确定性</strong>
                      <p>{{ item.uncertainty }}</p>
                    </div>
                  </article>
                </div>

                <div v-if="riskSummary.pendingVerifications.length" class="draft-risk-verifications">
                  <div class="draft-risk-subhead">
                    <h4>待核验事项</h4>
                    <button
                      v-if="riskVerificationHasMore"
                      class="draft-risk-more"
                      type="button"
                      @click="showAllRiskVerifications = !showAllRiskVerifications"
                    >
                      {{ showAllRiskVerifications ? '收起' : '查看全部' }}
                    </button>
                  </div>
                  <ol>
                    <li v-for="(item, index) in visibleRiskVerifications" :key="`${index}-${item}`">
                      <span>{{ index + 1 }}</span>
                      <b>{{ item }}</b>
                    </li>
                  </ol>
                </div>
              </template>

              <div v-else class="draft-risk-state">
                <strong>暂未识别到明确风险</strong>
                <p v-if="riskSummary.pendingVerifications.length">暂未发现明确风险，但仍有若干事实需要进一步核实。</p>
                <p v-else>当前资料不足以形成可靠的风险判断。建议补充官方公告、企业新闻、行业资料或相关链接后重新分析。</p>
              </div>
            </section>
          </div>

          <div v-else-if="editMode && selectedOutline" class="draft-state-card draft-editor-card">
            <DraftEditorToolbar
              :version-label="editingVersionLabel"
              :save-state="editorSaveState"
              :save-state-label="editorSaveStateLabel"
              :is-saving="isSavingManual"
              :can-confirm="!hasEditChanges && !previewMode"
              :preview-mode="previewMode"
              @cancel="cancelEditMode"
              @preview="previewMode ? continueEditing() : previewEditedOutline()"
              @save="saveManualOutline"
              @confirm="confirmCurrentVersion"
              @open-left="leftPanelOpen = true"
              @open-right="rightPanelOpen = true"
            />

            <section class="draft-event-basic-info">
              <div class="draft-event-basic-head">
                <div>
                  <span>当前编辑对象</span>
                  <h2>{{ currentEventTitle }}</h2>
                </div>
                <span class="draft-event-version">{{ editingVersionLabel }}</span>
              </div>
              <div class="draft-event-description">
                <strong>事件说明</strong>
                <p>{{ eventDescription }}</p>
              </div>
            </section>

            <template v-if="previewMode">
              <div class="draft-preview-banner">
                <strong>临时预览</strong>
                <span>当前内容尚未保存。确认无误后点击“保存为新版本”，或继续编辑。</span>
              </div>

              <div class="draft-outline-meta">
                <div class="draft-meta-row">
                  <span>建议标题</span>
                  <strong>{{ previewDisplayOutline.reportTitle || '暂无' }}</strong>
                </div>
                <div class="draft-meta-row">
                  <span>主题立意</span>
                  <strong>{{ previewDisplayOutline.reportTheme || '暂无' }}</strong>
                </div>
                <div class="draft-meta-row">
                  <span>核心判断</span>
                  <p>{{ previewDisplayOutline.coreArgument || '暂无' }}</p>
                </div>
              </div>

              <div class="draft-directory">
                <article v-for="(item, index) in previewDisplayOutline.outlineItems" :key="`preview-${index}-${item.title}`" class="draft-directory-item">
                  <h3>{{ outlineNumber(index) }}、{{ item.title }}</h3>
                  <p>{{ item.summary }}</p>
                  <div v-if="item.children?.length" class="draft-directory-children">
                    <section v-for="(child, childIndex) in item.children" :key="`preview-child-${childIndex}-${child.title}`" class="draft-directory-child">
                      <h4>（{{ outlineNumber(childIndex) }}）{{ child.title }}</h4>
                      <p>{{ child.summary }}</p>
                    </section>
                  </div>
                </article>
              </div>
            </template>

            <template v-else>
              <div class="draft-edit-fields">
                <section class="draft-edit-info-card title">
                  <div class="draft-edit-info-head">
                    <span class="draft-edit-info-icon">T</span>
                    <div>
                      <h3>建议标题 <b>*</b></h3>
                      <small>{{ outlineEdit.reportTitle.length }}/80</small>
                    </div>
                  </div>
                  <input v-model="outlineEdit.reportTitle" class="sci-input" maxlength="80" placeholder="报告建议标题" />
                </section>
                <section class="draft-edit-info-card theme">
                  <div class="draft-edit-info-head">
                    <span class="draft-edit-info-icon">A</span>
                    <div>
                      <h3>主题立意 <b>*</b></h3>
                      <small>{{ outlineEdit.reportTheme.length }}/120</small>
                    </div>
                  </div>
                  <input v-model="outlineEdit.reportTheme" class="sci-input" maxlength="120" placeholder="报告主题立意" />
                </section>
                <section class="draft-edit-info-card argument">
                  <div class="draft-edit-info-head">
                    <span class="draft-edit-info-icon">J</span>
                    <div>
                      <h3>核心判断 <b>*</b></h3>
                      <small>{{ outlineEdit.coreArgument.length }}/180</small>
                    </div>
                  </div>
                  <textarea v-model="outlineEdit.coreArgument" class="sci-input draft-compact-textarea" maxlength="180" placeholder="一句话说明核心判断"></textarea>
                </section>
              </div>

              <div class="draft-edit-outline">
                <div class="draft-section-head draft-edit-section-head">
                  <div>
                    <h3>目录结构编辑</h3>
                    <p>拖拽把手为排序提示，可用上移 / 下移调整顺序。</p>
                  </div>
                  <div class="draft-section-actions">
                    <button class="sci-btn draft-small-btn" type="button" @click="addOutlineItem">添加一级标题</button>
                    <button class="sci-btn draft-small-btn" type="button" @click="setAllOutlineItemsExpanded(true)">全部展开</button>
                    <button class="sci-btn draft-small-btn" type="button" @click="setAllOutlineItemsExpanded(false)">全部收起</button>
                  </div>
                </div>
                <article v-for="(item, index) in outlineEdit.outlineItems" :key="index" class="draft-outline-edit-card">
                  <div class="draft-outline-edit-head">
                    <button class="draft-outline-handle" type="button" title="排序把手">::</button>
                    <strong>{{ outlineNumber(index) }}、一级目录</strong>
                    <button class="draft-collapse-btn" type="button" @click="toggleOutlineItem(item)">
                      {{ item.expanded === false ? '展开' : '收起' }}
                    </button>
                    <div class="draft-outline-actions">
                      <button class="sci-btn draft-small-btn" type="button" :disabled="index === 0" @click="moveOutlineItem(index, -1)">上移</button>
                      <button class="sci-btn draft-small-btn" type="button" :disabled="index === outlineEdit.outlineItems.length - 1" @click="moveOutlineItem(index, 1)">下移</button>
                      <button class="sci-btn draft-small-btn" type="button" @click="addChildItem(item)">添加二级标题</button>
                      <button class="sci-btn draft-small-btn draft-danger-btn" type="button" @click="removeOutlineItem(index)">删除</button>
                    </div>
                  </div>
                  <div v-if="item.expanded !== false" class="draft-outline-edit-body">
                    <label class="draft-field">
                      <span>一级标题 <b>*</b></span>
                      <input v-model="item.title" class="sci-input" placeholder="一级标题" />
                    </label>
                    <label class="draft-field">
                      <span>这一部分写什么 <b>*</b></span>
                      <textarea v-model="item.summary" class="sci-input draft-compact-textarea" placeholder="简短说明这一部分的写作内容，不写正文"></textarea>
                    </label>
                    <div class="draft-edit-children">
                      <div class="draft-edit-child-head">
                        <span>二级目录</span>
                        <small>{{ item.children.length }} 项</small>
                      </div>
                      <div v-for="(child, childIndex) in item.children" :key="childIndex" class="draft-edit-child">
                        <div class="draft-edit-child-title">
                          <b>（{{ outlineNumber(childIndex) }}）</b>
                          <div class="draft-child-actions">
                            <button class="sci-btn draft-small-btn" type="button" :disabled="childIndex === 0" @click="moveChildItem(item, childIndex, -1)">上移</button>
                            <button class="sci-btn draft-small-btn" type="button" :disabled="childIndex === item.children.length - 1" @click="moveChildItem(item, childIndex, 1)">下移</button>
                            <button class="sci-btn draft-small-btn draft-danger-btn" type="button" @click="removeChildItem(item, childIndex)">删除</button>
                          </div>
                        </div>
                        <input v-model="child.title" class="sci-input" placeholder="二级标题" />
                        <textarea v-model="child.summary" class="sci-input draft-compact-textarea" placeholder="简短说明这一部分写什么"></textarea>
                      </div>
                    </div>
                  </div>
                </article>
                <div v-if="!outlineEdit.outlineItems.length" class="draft-empty">暂无目录，请新增一级目录。</div>
              </div>

              <StrategyTabs
                :writing-focus="outlineEdit.writingFocus"
                :source-requirements="outlineEdit.sourceRequirements"
                :uncertainties-to-verify="outlineEdit.uncertaintiesToVerify"
                @add="addStrategyItem"
                @move="moveStrategyItem"
                @remove="removeStrategyItem"
                @duplicate="duplicateStrategyItem"
                @update="updateStrategyItem"
                @restore="restoreStrategyItem"
              />

              <section class="draft-edit-note-card">
                <label class="draft-field">
                  <span>修改说明</span>
                  <textarea
                    v-model="editNote"
                    class="sci-input draft-compact-textarea"
                    maxlength="200"
                    placeholder="说明本次手动调整原因，例如：优化目录结构，补充涉我风险方向，调整来源要求。"
                  ></textarea>
                </label>
                <small>{{ editNote.length }}/200</small>
              </section>
            </template>
          </div>

          <div v-else-if="hasOutline" class="draft-state-card draft-outline-card">
            <div class="draft-main-head">
              <div>
                <span class="draft-state-kicker">{{ currentStepKey === 'confirm' ? 'Step 4' : 'Step 3' }}</span>
                <h2>{{ currentStepKey === 'confirm' ? '确认提纲版本' : '拟稿提纲' }}</h2>
                <p>{{ currentStepKey === 'confirm' ? '请确认当前版本后再导入深度编报。' : '当前版本以论文目录式结构展示。' }}</p>
              </div>
              <div class="draft-outline-version-chip">
                <strong>{{ selectedVersionLabel }}</strong>
                <span>{{ currentVersionTime || '暂无时间' }}</span>
              </div>
            </div>

            <div class="draft-outline-meta">
              <div class="draft-meta-row">
                <span>建议标题</span>
                <strong>{{ displayOutline.reportTitle || '暂无' }}</strong>
              </div>
              <div class="draft-meta-row">
                <span>主题立意</span>
                <strong>{{ displayOutline.reportTheme || '暂无' }}</strong>
              </div>
              <div class="draft-meta-row">
                <span>核心判断</span>
                <p>{{ displayOutline.coreArgument || '暂无' }}</p>
              </div>
            </div>

            <div class="draft-directory">
              <article v-for="(item, index) in displayOutline.outlineItems" :key="`${index}-${item.title}`" class="draft-directory-item">
                <h3>{{ outlineNumber(index) }}、{{ item.title }}</h3>
                <p>{{ item.summary }}</p>
                <div v-if="item.children?.length" class="draft-directory-children">
                  <section v-for="(child, childIndex) in item.children" :key="`${childIndex}-${child.title}`" class="draft-directory-child">
                    <h4>（{{ outlineNumber(childIndex) }}）{{ child.title }}</h4>
                    <p>{{ child.summary }}</p>
                  </section>
                </div>
              </article>
            </div>

            <div class="draft-strategy-section">
              <div class="draft-strategy-head">
                <div>
                  <h3>写作策略与核查</h3>
                  <p>用于明确本篇编报的写作重点、来源使用要求和后续核实事项。</p>
                </div>
              </div>
              <div class="draft-strategy-grid">
                <section class="draft-strategy-card focus">
                  <div class="draft-strategy-card-head">
                    <span class="draft-strategy-icon">P</span>
                    <div>
                      <h4>写作重点</h4>
                      <p>突出本篇编报应该展开的核心方向。</p>
                    </div>
                  </div>
                  <ul v-if="displayOutline.writingFocus.length" class="draft-strategy-list focus-list">
                    <li v-for="(item, index) in strategyVisibleItems(displayOutline.writingFocus, 'writingFocus')" :key="`focus-${index}`">
                      <span></span>
                      <b>{{ strategyText(item) }}</b>
                    </li>
                  </ul>
                  <p v-else class="draft-strategy-empty">暂无写作重点，可在编辑提纲时补充。</p>
                  <button
                    v-if="strategyHasMore(displayOutline.writingFocus, 'writingFocus') || expandedStrategyCards.writingFocus"
                    class="draft-strategy-more"
                    type="button"
                    @click="toggleStrategyCard('writingFocus')"
                  >
                    {{ expandedStrategyCards.writingFocus ? '收起' : '展开更多' }}
                  </button>
                </section>

                <section class="draft-strategy-card source">
                  <div class="draft-strategy-card-head">
                    <span class="draft-strategy-icon">L</span>
                    <div>
                      <h4>来源要求</h4>
                      <p>形成后续正文的来源核查清单。</p>
                    </div>
                  </div>
                  <div class="draft-source-tags">
                    <span v-for="tag in sourceTypeTags" :key="tag.label" :class="tag.tone">{{ tag.label }}</span>
                  </div>
                  <ol v-if="displayOutline.sourceRequirements.length" class="draft-source-list">
                    <li
                      v-for="(item, index) in strategyVisibleItems(displayOutline.sourceRequirements, 'sourceRequirements')"
                      :key="`source-${index}`"
                      :class="{ mandatory: isMandatorySourceRequirement(item) }"
                    >
                      <span>{{ index + 1 }}</span>
                      <b>{{ strategyText(item) }}</b>
                    </li>
                  </ol>
                  <p v-else class="draft-strategy-empty">暂无来源要求，后续正文仍建议优先使用官方文件、权威媒体和可追溯来源。</p>
                  <button
                    v-if="strategyHasMore(displayOutline.sourceRequirements, 'sourceRequirements') || expandedStrategyCards.sourceRequirements"
                    class="draft-strategy-more"
                    type="button"
                    @click="toggleStrategyCard('sourceRequirements')"
                  >
                    {{ expandedStrategyCards.sourceRequirements ? '收起' : '展开更多' }}
                  </button>
                </section>

                <section class="draft-strategy-card verify">
                  <div class="draft-strategy-card-head">
                    <span class="draft-strategy-icon">!</span>
                    <div>
                      <h4>待核实事项</h4>
                      <p>避免将未确认事实直接写入正文。</p>
                    </div>
                  </div>
                  <ol v-if="displayOutline.uncertaintiesToVerify.length" class="draft-verify-list">
                    <li
                      v-for="(item, index) in strategyVisibleItems(displayOutline.uncertaintiesToVerify, 'uncertaintiesToVerify')"
                      :key="`verify-${index}`"
                    >
                      <span>{{ index + 1 }}</span>
                      <b>{{ strategyText(item) }}</b>
                    </li>
                  </ol>
                  <p v-else class="draft-strategy-empty">
                    暂无明显待核实事项，但正式编报前仍建议复核关键时间、主体表态和来源链接。
                  </p>
                  <button
                    v-if="strategyHasMore(displayOutline.uncertaintiesToVerify, 'uncertaintiesToVerify') || expandedStrategyCards.uncertaintiesToVerify"
                    class="draft-strategy-more"
                    type="button"
                    @click="toggleStrategyCard('uncertaintiesToVerify')"
                  >
                    {{ expandedStrategyCards.uncertaintiesToVerify ? '收起' : '展开更多' }}
                  </button>
                </section>
              </div>
            </div>
          </div>

          <div v-else class="draft-state-card draft-empty-state">
            <span class="draft-state-kicker">Step 2</span>
            <h2>分析完成后生成提纲</h2>
            <p>当前事件还没有可展示的拟稿提纲。请先完成事件分析，再生成目录式提纲。</p>
          </div>
        </section>

        <aside class="draft-panel draft-right" :class="{ open: rightPanelOpen }">
          <button class="draft-panel-close" type="button" aria-label="关闭操作面板" @click="rightPanelOpen = false">×</button>
          <template v-if="editMode">
            <section class="draft-side-section draft-ai-revision-panel">
              <div class="draft-side-head">
                <div>
                  <h2>AI 修改建议</h2>
                  <small>让 AI 按你的要求生成新版本</small>
                </div>
                <span v-if="isRefining" class="draft-side-status running">调整中</span>
              </div>
              <label class="draft-field">
                <span>修改要求</span>
                <textarea
                  v-model="refineFeedback"
                  class="sci-input draft-revision-textarea"
                  placeholder="例如：补充某个角度、调整章节顺序、强化来源要求或减少重复内容。"
                ></textarea>
              </label>
              <button class="sci-btn sci-btn-primary draft-primary" type="button" :disabled="isRefining || !currentOutlineId || hasEditChanges" @click="refineOutline">
                {{ isRefining ? 'AI 正在调整...' : '提交修改建议' }}
              </button>
              <p v-if="hasEditChanges" class="draft-side-hint">请先保存或取消当前手动修改，再提交 AI 建议。</p>
            </section>

            <section class="draft-side-section draft-version-timeline">
              <div class="draft-side-head">
                <h2>版本记录</h2>
                <span>{{ outlineVersions.length }} 个版本</span>
              </div>
              <button
                v-for="item in outlineVersions"
                :key="item.outlineId"
                class="draft-version-timeline-item"
                :class="versionClass(item)"
                type="button"
                @click="loadOutline(item.outlineId)"
              >
                <span class="draft-version-dot"></span>
                <div>
                  <strong>V{{ item.versionNo }} · {{ versionTypeLabel(item) }}</strong>
                  <span>{{ formatTime(item.createdAt) }}</span>
                  <small>{{ item.outlineId === currentOutlineId ? '当前编辑版本' : versionSummary(item) }}</small>
                </div>
              </button>
              <div v-if="!outlineVersions.length" class="draft-empty">暂无提纲版本</div>
            </section>

            <section class="draft-side-section draft-next-step-panel">
              <h2>下一步操作</h2>
              <p>保存修改后确认当前版本，即可继续进入深度编报。</p>
              <button class="sci-btn sci-btn-primary draft-primary" type="button" :disabled="hasEditChanges || isSavingManual" @click="confirmCurrentVersion">
                确认当前版本并继续
              </button>
              <span v-if="hasEditChanges" class="draft-side-hint">当前有未保存修改</span>
            </section>
          </template>

          <template v-else>
          <section class="draft-side-section">
            <div class="draft-side-head">
              <h2>版本列表</h2>
              <span>{{ outlineVersions.length }} 个版本</span>
            </div>
            <button
              v-for="item in outlineVersions"
              :key="item.outlineId"
              class="draft-version"
              :class="versionClass(item)"
              type="button"
              @click="loadOutline(item.outlineId)"
            >
              <strong>V{{ item.versionNo }} {{ versionTypeLabel(item) }}</strong>
              <span>{{ formatTime(item.createdAt) }}</span>
              <small>{{ versionSummary(item) }}</small>
            </button>
            <div v-if="!outlineVersions.length" class="draft-empty">暂无提纲版本</div>
          </section>

          <section class="draft-side-section">
            <h2>提纲操作</h2>
            <label class="draft-field">
              <span>生成偏好</span>
              <textarea v-model="outlinePreference" class="sci-input draft-links" placeholder="例如突出涉我风险、强化各方态度来源"></textarea>
            </label>
            <button class="sci-btn sci-btn-primary draft-primary" type="button" :disabled="isGeneratingOutline || !currentEventId" @click="createOutline">
              {{ isGeneratingOutline ? '生成中...' : '生成提纲' }}
            </button>

            <label class="draft-field draft-refine-field">
              <span>AI 修改要求</span>
              <textarea v-model="refineFeedback" class="sci-input draft-links" placeholder="说明希望调整的目录顺序、一级标题、二级标题或写作重点"></textarea>
            </label>
            <button class="sci-btn draft-primary" type="button" :disabled="isRefining || !currentOutlineId" @click="refineOutline">
              {{ isRefining ? '修改中...' : 'AI 修改提纲' }}
            </button>
            <div v-if="editMode" class="draft-editing-side-note">
              当前正在编辑 {{ editingVersionLabel }}，保存后将生成新的手动修改版本，不会覆盖原版本。
            </div>
            <button class="sci-btn draft-primary" type="button" :disabled="!selectedOutline || editMode" @click="enterEditMode">编辑提纲</button>
            <button class="sci-btn draft-primary" type="button" :disabled="!hasOutline || editMode" @click="confirmCurrentVersion">确认当前版本</button>
          </section>

          <section class="draft-side-section draft-import-box">
            <h2>导入深度编报</h2>
            <div class="draft-import-status" :class="{ ready: isVersionConfirmed || importedPlan }">
              <strong>{{ importedPlan ? importedVersionLabel : selectedVersionLabel }}</strong>
              <span v-if="editMode">请先保存或取消编辑后再导入</span>
              <span v-else-if="!canImportDraftOutline">当前账号无权导入深度编报</span>
              <span v-else-if="!isVersionConfirmed && !importedPlan">请先确认当前提纲版本</span>
              <span v-else>{{ importStatus }}</span>
            </div>
            <div v-if="importedPlan" class="draft-import-plan-card">
              <span>Plan ID</span>
              <strong>{{ importedPlanIdShort }}</strong>
              <small>{{ formatTime(importedPlan.createdAt) }}</small>
              <b>{{ importedPlan.plan?.reportTitle || displayOutline.reportTitle || '深度编报规划' }}</b>
              <p>{{ importedPlan.plan?.reportTheme || displayOutline.reportTheme || '已生成可供 report-jobs 使用的规划。' }}</p>
            </div>
            <button
              v-if="!importedPlan"
              class="sci-btn sci-btn-primary draft-primary"
              type="button"
              :disabled="!isImportReady || isImportingOutline || editMode"
              @click="importCurrentOutline"
            >
              {{ isImportingOutline ? '导入中...' : '导入深度编报' }}
            </button>
            <button
              v-else
              class="sci-btn sci-btn-primary draft-primary"
              type="button"
              :disabled="!isReportJobReady || isCreatingReportJob"
              @click="createDeepReportJob"
            >
              {{ isCreatingReportJob ? '创建中...' : '创建深度编报任务' }}
            </button>
            <p v-if="editMode">请先保存或取消编辑后再导入，未保存内容不会进入深度编报。</p>
            <p v-else-if="!canImportDraftOutline">当前账号无权导入深度编报。</p>
            <p v-else-if="importedPlan">创建任务后将进入现有编报任务进度页，任务会携带 eventId、outlineId、planId。</p>
            <p v-else>确认当前版本后可生成深度编报规划，不会覆盖原提纲版本。</p>
          </section>
          </template>
        </aside>
      </section>
    </template>
  </main>
</template>

<style scoped>
.draft-assistant-main {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 22px;
  background: #f1f5f9;
  color: #0f172a;
}

.draft-toolbar,
.draft-login-gate,
.draft-panel,
.draft-state-card,
.draft-stepper {
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 46px rgba(15, 23, 42, 0.08);
}

.draft-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  padding: 18px 20px;
  border-radius: 8px;
}

.draft-toolbar h1,
.draft-state-card h2,
.draft-panel h2,
.draft-side-section h2 {
  margin: 0;
  color: #0f172a;
  font-weight: 800;
  letter-spacing: 0;
}

.draft-toolbar h1 {
  font-size: 22px;
}

.draft-toolbar p,
.draft-state-card > p,
.draft-main-head p,
.draft-import-box p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.draft-toolbar-actions,
.draft-main-head,
.draft-panel-head,
.draft-side-head,
.draft-head-actions,
.draft-section-head,
.draft-edit-item-head,
.draft-edit-child-head,
.draft-edit-child-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.draft-user-chip {
  border: 1px solid rgba(37, 99, 235, 0.18);
  background: #eff6ff;
  color: #1d4ed8;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
}

.draft-login-gate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px;
  border-radius: 8px;
}

.draft-login-gate h2 {
  margin: 0 0 6px;
  color: #0f172a;
}

.draft-login-gate p {
  margin: 0;
  color: #64748b;
}

.draft-stepper {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0;
  margin-bottom: 14px;
  border-radius: 8px;
  overflow: hidden;
}

.draft-step {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid rgba(148, 163, 184, 0.22);
  color: #64748b;
  font-size: 13px;
  font-weight: 800;
}

.draft-step:last-child {
  border-right: 0;
}

.draft-step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
  font-size: 12px;
}

.draft-step.done {
  background: #f8fafc;
  color: #2563eb;
}

.draft-step.done .draft-step-index {
  background: #dbeafe;
  color: #1d4ed8;
}

.draft-step.active {
  background: linear-gradient(135deg, #eff6ff, #ecfeff);
  color: #0f172a;
}

.draft-step.active .draft-step-index {
  background: #2563eb;
  color: #fff;
}

.draft-step.disabled {
  color: #94a3b8;
}

.draft-workspace-grid {
  display: grid;
  grid-template-columns: 280px minmax(640px, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

.draft-workspace-grid.editor-active {
  grid-template-columns: 250px minmax(720px, 1fr) 280px;
  align-items: stretch;
  min-height: 0;
}

.draft-panel,
.draft-state-card {
  border-radius: 8px;
}

.draft-panel {
  padding: 16px;
}

.draft-left,
.draft-right {
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 150px);
  overflow: auto;
}

.draft-panel-close,
.draft-panel-backdrop {
  display: none;
}

.draft-right {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
}

.draft-panel-head {
  margin-bottom: 14px;
}

.draft-panel h2,
.draft-side-section h2 {
  font-size: 15px;
}

.draft-field {
  display: block;
  margin-bottom: 12px;
}

.draft-field span {
  display: block;
  margin-bottom: 6px;
  color: #475569;
  font-size: 12px;
  font-weight: 800;
}

.draft-assistant-main .sci-input {
  border-color: rgba(148, 163, 184, 0.28);
  background: #fff;
  color: #0f172a;
  border-radius: 8px;
  font-family: 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
  letter-spacing: 0;
}

.draft-assistant-main .sci-input::placeholder {
  color: #94a3b8;
}

.draft-assistant-main .sci-btn {
  border-color: rgba(37, 99, 235, 0.22);
  background: #fff;
  color: #1e3a8a;
  border-radius: 8px;
  font-family: 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
  letter-spacing: 0;
}

.draft-assistant-main .sci-btn:hover:not(:disabled) {
  background: #eff6ff;
  border-color: rgba(37, 99, 235, 0.5);
  color: #1d4ed8;
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.1);
}

.draft-assistant-main .sci-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.draft-assistant-main .sci-btn-primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.draft-assistant-main .sci-btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
  color: #fff;
}

.draft-small-btn {
  padding: 7px 10px;
  font-size: 11px;
}

.draft-textarea {
  min-height: 132px;
  resize: vertical;
}

.draft-links {
  min-height: 82px;
  resize: vertical;
}

.draft-compact-textarea {
  min-height: 70px;
  resize: vertical;
}

.draft-two,
.draft-edit-tail {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.draft-primary {
  width: 100%;
  justify-content: center;
  margin-top: 8px;
}

.draft-history {
  margin-top: 18px;
  border-top: 1px solid rgba(148, 163, 184, 0.25);
  padding-top: 14px;
}

.draft-history h3,
.draft-section-head h3 {
  margin: 0;
  color: #334155;
  font-size: 13px;
  font-weight: 900;
}

.draft-history-item,
.draft-version {
  width: 100%;
  display: block;
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #f8fafc;
  color: #0f172a;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
}

.draft-history-item:hover,
.draft-version:hover,
.draft-version.active {
  border-color: rgba(37, 99, 235, 0.5);
  background: #eff6ff;
}

.draft-history-item.selected {
  border-color: #93c5fd;
  border-left: 4px solid #2563eb;
  background: #eff6ff;
  padding-left: 8px;
}

.draft-history-item strong,
.draft-version strong {
  display: block;
  font-size: 12px;
  line-height: 1.45;
}

.draft-history-item span,
.draft-history-item small,
.draft-version span,
.draft-version small {
  display: block;
  margin-top: 4px;
  color: #64748b;
  font-size: 11px;
  line-height: 1.45;
}

.draft-version.active {
  border-color: rgba(37, 99, 235, 0.72);
  background: linear-gradient(135deg, #eff6ff, #fff);
  box-shadow: 0 12px 26px rgba(37, 99, 235, 0.12);
}

.draft-version.refine strong {
  color: #2563eb;
}

.draft-version.manual strong {
  color: #047857;
}

.draft-main-workarea {
  min-width: 0;
}

.editor-active .draft-main-workarea {
  max-height: calc(100vh - 220px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.editor-active .draft-left,
.editor-active .draft-right {
  top: 0;
  max-height: calc(100vh - 220px);
}

.draft-state-card {
  min-height: calc(100vh - 190px);
  padding: 28px;
}

.draft-editor-card {
  min-height: 100%;
  border-color: #dbe3ef;
  background: #f5f7fb;
  padding: 18px;
  box-shadow: none;
}

.draft-event-basic-info {
  border: 1px solid #dbe3ef;
  background: #fff;
  border-radius: 14px;
  padding: 22px 24px;
}

.draft-event-basic-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.draft-event-basic-head > div { min-width: 0; }
.draft-event-basic-head span:first-child {
  display: block;
  margin-bottom: 6px;
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}
.draft-event-basic-head h2 {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  font-weight: 900;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.draft-event-version {
  flex: 0 0 auto;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8 !important;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12px !important;
}
.draft-event-description {
  margin-top: 18px;
  border-top: 1px solid #e2e8f0;
  padding-top: 16px;
}
.draft-event-description strong { display: block; margin-bottom: 6px; color: #475569; font-size: 13px; }
.draft-event-description p { margin: 0; color: #334155; font-size: 14px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }

.draft-event-nav-head { align-items: flex-start; }
.draft-event-nav-head span { display: block; margin-top: 4px; color: #94a3b8; font-size: 11px; }
.draft-event-search { display: block; margin-bottom: 10px; }
.draft-event-search > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
.draft-event-filter-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; border-bottom: 1px solid #e2e8f0; }
.draft-event-filter-tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; color: #64748b; padding: 9px 4px; cursor: pointer; font-size: 12px; font-weight: 800; }
.draft-event-filter-tabs button.active { border-bottom-color: #2563eb; color: #1d4ed8; }
.draft-editor-event-list { margin-top: 10px; border-top: 0; padding-top: 0; }
.draft-editor-event-list .draft-history-item strong { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }

.draft-empty-state {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
}

.draft-state-kicker {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-bottom: 10px;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 900;
}

.draft-main-head {
  align-items: flex-start;
  margin-bottom: 22px;
  padding-bottom: 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
}

.draft-main-head h2 {
  font-size: 22px;
}

.draft-editor-commandbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: -28px -28px 22px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(255, 255, 255, 0.98);
  border-radius: 8px 8px 0 0;
  padding: 18px 22px;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06);
}

.draft-editor-commandbar h2 {
  margin: 8px 0 0;
  font-size: 22px;
}

.draft-editor-commandbar p {
  margin: 6px 0 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.6;
}

.draft-editor-kickers,
.draft-section-actions,
.draft-outline-actions,
.draft-child-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.draft-edit-mode-chip,
.draft-edit-version-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 900;
}

.draft-edit-mode-chip {
  border: 1px solid #bbf7d0;
  background: #ecfdf5;
  color: #047857;
}

.draft-edit-version-chip {
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.draft-preview-banner,
.draft-editing-side-note {
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1e40af;
  border-radius: 8px;
  padding: 11px 12px;
  font-size: 12px;
  line-height: 1.6;
}

.draft-preview-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.draft-preview-banner strong {
  flex: 0 0 auto;
  color: #1d4ed8;
  font-size: 13px;
}

.draft-analysis-summary {
  display: grid;
  gap: 12px;
}

.draft-analysis-row {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr);
  gap: 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  padding: 14px 0;
}

.draft-analysis-row span {
  color: #475569;
  font-size: 13px;
  font-weight: 900;
}

.draft-analysis-row p {
  margin: 0;
  color: #1e293b;
  font-size: 14px;
  line-height: 1.8;
}

.draft-risk-section {
  margin-top: 22px;
  border-top: 1px solid rgba(148, 163, 184, 0.22);
  padding-top: 20px;
}

.draft-risk-head,
.draft-risk-card-head,
.draft-risk-subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.draft-risk-head {
  margin-bottom: 14px;
}

.draft-risk-head h3,
.draft-risk-subhead h4 {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
  font-weight: 900;
  line-height: 1.45;
}

.draft-risk-head span {
  flex: 0 0 auto;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 900;
}

.draft-risk-overview,
.draft-risk-state {
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #f8fafc;
  border-radius: 8px;
  padding: 14px 16px;
}

.draft-risk-overview span,
.draft-risk-state strong {
  display: block;
  color: #0f172a;
  font-size: 15px;
  font-weight: 900;
}

.draft-risk-overview p,
.draft-risk-overview small,
.draft-risk-state p {
  display: block;
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.7;
}

.draft-risk-list {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.draft-risk-card {
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #fff;
  border-radius: 8px;
  padding: 16px;
}

.draft-risk-card-head {
  justify-content: flex-start;
  align-items: flex-start;
  margin-bottom: 12px;
}

.draft-risk-card-head h4 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  font-weight: 900;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.draft-risk-card-head small {
  display: block;
  margin-top: 2px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.draft-risk-badge {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 900;
  line-height: 1.2;
}

.draft-risk-badge.high {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}

.draft-risk-badge.medium {
  border: 1px solid #fed7aa;
  background: #fff7ed;
  color: #c2410c;
}

.draft-risk-badge.low {
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.draft-risk-badge.unknown {
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #475569;
}

.draft-risk-block {
  margin-top: 10px;
}

.draft-risk-block strong {
  display: block;
  margin-bottom: 4px;
  color: #334155;
  font-size: 12px;
  font-weight: 900;
}

.draft-risk-block p {
  margin: 0;
  color: #1e293b;
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.draft-risk-block.muted p {
  color: #64748b;
  font-size: 13px;
}

.draft-risk-verifications {
  margin-top: 14px;
  border: 1px solid #fed7aa;
  background: #fffaf3;
  border-radius: 8px;
  padding: 14px;
}

.draft-risk-subhead {
  margin-bottom: 10px;
}

.draft-risk-subhead h4 {
  font-size: 15px;
}

.draft-risk-more {
  border: 0;
  background: transparent;
  color: #1d4ed8;
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
}

.draft-risk-verifications ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.draft-risk-verifications li {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.draft-risk-verifications li span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #ffedd5;
  color: #c2410c;
  font-size: 11px;
  font-weight: 900;
}

.draft-risk-verifications li b {
  color: #334155;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.draft-outline-version-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  border: 1px solid #bbf7d0;
  background: #ecfdf5;
  color: #047857;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 12px;
}

.draft-outline-version-chip strong {
  color: #065f46;
}

.draft-outline-meta {
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  margin-bottom: 22px;
  padding-bottom: 16px;
}

.draft-meta-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 16px;
  padding: 9px 0;
}

.draft-meta-row span {
  color: #64748b;
  font-size: 13px;
  font-weight: 900;
}

.draft-meta-row strong,
.draft-meta-row p {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  line-height: 1.75;
}

.draft-directory {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.draft-directory-item {
  padding-bottom: 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.draft-directory-item h3 {
  margin: 0 0 8px;
  color: #0f172a;
  font-size: 18px;
  font-weight: 900;
  line-height: 1.45;
}

.draft-directory-item > p,
.draft-directory-child p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.85;
}

.draft-directory-children {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
  margin-left: 34px;
}

.draft-directory-child {
  border-left: 3px solid #dbeafe;
  padding-left: 14px;
}

.draft-directory-child h4 {
  margin: 0 0 6px;
  color: #334155;
  font-size: 15px;
  font-weight: 900;
  line-height: 1.5;
}

.draft-strategy-section {
  margin-top: 24px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: #fff;
  border-radius: 8px;
  padding: 18px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.04);
}

.draft-strategy-editor {
  margin: 18px 0;
}

.draft-strategy-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.draft-strategy-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0;
}

.draft-strategy-head p {
  margin: 5px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.draft-strategy-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

.draft-strategy-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 236px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  padding: 14px;
}

.draft-strategy-card.focus {
  border-color: #bfdbfe;
  background: #f8fbff;
}

.draft-strategy-card.source {
  border-color: #bbf7d0;
  background: #fbfefc;
}

.draft-strategy-card.verify {
  border-color: #fed7aa;
  background: #fffaf3;
}

.draft-strategy-card-head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.draft-strategy-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 900;
  line-height: 1;
}

.draft-strategy-card.focus .draft-strategy-icon {
  background: #dbeafe;
  color: #1d4ed8;
}

.draft-strategy-card.source .draft-strategy-icon {
  background: #dcfce7;
  color: #15803d;
}

.draft-strategy-card.verify .draft-strategy-icon {
  background: #ffedd5;
  color: #c2410c;
}

.draft-strategy-card h4 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  font-weight: 900;
  line-height: 1.4;
}

.draft-strategy-card-head p {
  margin: 3px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.55;
}

.draft-strategy-list,
.draft-source-list,
.draft-verify-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.draft-strategy-list li,
.draft-source-list li,
.draft-verify-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  border-radius: 8px;
  padding: 8px 9px;
  color: #334155;
  font-size: 12px;
  line-height: 1.55;
}

.draft-strategy-list li {
  background: #eff6ff;
}

.draft-strategy-list li span {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 999px;
  background: #2563eb;
}

.draft-strategy-list li b,
.draft-source-list li b,
.draft-verify-list li b {
  min-width: 0;
  color: inherit;
  font-weight: 800;
  word-break: break-word;
}

.draft-source-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.draft-source-tags span {
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 4px 7px;
  font-size: 11px;
  font-weight: 900;
  line-height: 1.2;
}

.draft-source-tags .official {
  border-color: #bbf7d0;
  background: #dcfce7;
  color: #166534;
}

.draft-source-tags .media {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.draft-source-tags .industry {
  border-color: #fed7aa;
  background: #fff7ed;
  color: #c2410c;
}

.draft-source-tags .report {
  border-color: #e9d5ff;
  background: #faf5ff;
  color: #7e22ce;
}

.draft-source-tags .company {
  border-color: #cbd5e1;
  background: #f8fafc;
  color: #475569;
}

.draft-source-list li {
  background: #f0fdf4;
}

.draft-source-list li.mandatory {
  border: 1px solid #86efac;
  background: #ecfdf5;
}

.draft-source-list li span,
.draft-verify-list li span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  color: #fff;
  font-size: 11px;
  font-weight: 900;
}

.draft-source-list li span {
  background: #16a34a;
}

.draft-verify-list li {
  background: #fff7ed;
}

.draft-verify-list li span {
  background: #f59e0b;
}

.draft-strategy-empty {
  margin: 0;
  border: 1px dashed rgba(148, 163, 184, 0.32);
  border-radius: 8px;
  padding: 10px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.65;
}

.draft-strategy-more {
  width: fit-content;
  margin-top: auto;
  padding: 8px 0 0;
  border: 0;
  background: transparent;
  color: #2563eb;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.draft-strategy-textarea {
  min-height: 132px;
  resize: vertical;
}

.draft-strategy-card small {
  margin-top: 8px;
  color: #64748b;
  font-size: 11px;
  line-height: 1.5;
}

.draft-editor-card {
  padding-bottom: 34px;
}

.draft-edit-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.draft-edit-info-card {
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #fff;
  border-radius: 8px;
  padding: 14px;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
}

.draft-edit-info-card.title {
  border-color: #bfdbfe;
}

.draft-edit-info-card.theme {
  border-color: #bbf7d0;
}

.draft-edit-info-card.argument {
  border-color: #ddd6fe;
}

.draft-edit-info-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
}

.draft-edit-info-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #eff6ff;
  color: #1d4ed8;
  font-weight: 900;
}

.draft-edit-info-card.theme .draft-edit-info-icon {
  background: #dcfce7;
  color: #15803d;
}

.draft-edit-info-card.argument .draft-edit-info-icon {
  background: #f5f3ff;
  color: #7c3aed;
}

.draft-edit-info-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

.draft-edit-info-head h3 b,
.draft-field span b {
  color: #dc2626;
}

.draft-edit-info-head small {
  display: block;
  margin-top: 4px;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 800;
}

.draft-edit-outline {
  display: grid;
  gap: 12px;
}

.draft-edit-outline {
  margin: 12px 0 16px;
}

.draft-edit-section-head {
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  padding-bottom: 10px;
}

.draft-edit-section-head p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.draft-outline-edit-card,
.draft-edit-item {
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #f8fafc;
  border-radius: 8px;
  padding: 14px;
}

.draft-outline-edit-card {
  background: #fff;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.04);
}

.draft-outline-edit-head {
  display: grid;
  grid-template-columns: 28px auto auto minmax(260px, 1fr);
  align-items: center;
  gap: 10px;
}

.draft-outline-edit-head strong {
  color: #0f172a;
  font-size: 15px;
  font-weight: 900;
}

.draft-outline-handle,
.draft-collapse-btn {
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: #f8fafc;
  color: #64748b;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.draft-outline-handle {
  width: 26px;
  height: 26px;
  letter-spacing: -2px;
}

.draft-collapse-btn {
  width: fit-content;
  padding: 6px 9px;
}

.draft-outline-actions {
  justify-content: flex-end;
}

.draft-outline-edit-body {
  margin-top: 14px;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
  padding-top: 14px;
}

.draft-danger-btn {
  border-color: rgba(239, 68, 68, 0.24) !important;
  color: #b91c1c !important;
}

.draft-danger-btn:hover:not(:disabled) {
  background: #fef2f2 !important;
  border-color: rgba(239, 68, 68, 0.48) !important;
  color: #dc2626 !important;
}

.draft-edit-item-head {
  margin-bottom: 10px;
}

.draft-edit-item-head strong {
  color: #0f172a;
  font-size: 14px;
}

.draft-edit-item > .sci-input {
  margin-bottom: 10px;
}

.draft-edit-children {
  margin-top: 12px;
  padding-left: 14px;
  border-left: 2px solid #dbeafe;
}

.draft-edit-child-head {
  margin-bottom: 10px;
  color: #64748b;
  font-size: 12px;
  font-weight: 900;
}

.draft-edit-child {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: #fff;
  border-radius: 8px;
  padding: 10px;
}

.draft-edit-child-title b {
  color: #334155;
  font-size: 13px;
}

.draft-strategy-edit-list {
  display: grid;
  gap: 8px;
}

.draft-strategy-edit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 6px;
  align-items: center;
}

.draft-edit-note-card {
  display: grid;
  gap: 6px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #fff;
  border-radius: 8px;
  padding: 14px;
  margin-top: 18px;
}

.draft-edit-note-card .draft-field {
  margin-bottom: 0;
}

.draft-edit-note-card small {
  justify-self: end;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 800;
}

.draft-editing-side-note {
  margin: 12px 0 4px;
}

.draft-side-section {
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  padding-bottom: 14px;
}

.draft-side-section:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.draft-side-head {
  margin-bottom: 10px;
}

.draft-side-head span {
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}

.draft-side-head small {
  display: block;
  margin-top: 4px;
  color: #94a3b8;
  font-size: 11px;
  line-height: 1.5;
}

.draft-side-status {
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8 !important;
  border-radius: 7px;
  padding: 4px 7px;
  font-size: 10px !important;
}

.draft-revision-textarea {
  min-height: 124px;
  resize: vertical;
  line-height: 1.7;
}

.draft-side-hint {
  display: block;
  margin-top: 8px;
  color: #b45309;
  font-size: 11px;
  line-height: 1.6;
}

.draft-version-timeline {
  display: grid;
  gap: 8px;
}

.draft-version-timeline-item {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 9px;
  width: 100%;
  border: 0;
  background: transparent;
  color: #334155;
  padding: 7px 4px;
  text-align: left;
  cursor: pointer;
}

.draft-version-timeline-item > div { min-width: 0; }
.draft-version-dot {
  position: relative;
  width: 9px;
  height: 9px;
  margin-top: 4px;
  border: 2px solid #94a3b8;
  background: #fff;
  border-radius: 50%;
}
.draft-version-timeline-item:not(:last-of-type) .draft-version-dot::after {
  content: '';
  position: absolute;
  top: 10px;
  left: 2px;
  width: 1px;
  height: 42px;
  background: #e2e8f0;
}
.draft-version-timeline-item strong,
.draft-version-timeline-item span,
.draft-version-timeline-item small { display: block; }
.draft-version-timeline-item strong { color: #334155; font-size: 12px; line-height: 1.45; }
.draft-version-timeline-item span { margin-top: 2px; color: #94a3b8; font-size: 10px; }
.draft-version-timeline-item small { margin-top: 3px; color: #64748b; font-size: 11px; line-height: 1.45; white-space: normal; }
.draft-version-timeline-item.active .draft-version-dot { border-color: #2563eb; background: #2563eb; box-shadow: 0 0 0 4px #dbeafe; }
.draft-version-timeline-item.active strong { color: #1d4ed8; }

.draft-next-step-panel {
  border: 1px solid #bfdbfe;
  background: #f8fbff;
  border-radius: 10px;
  padding: 14px;
}
.draft-next-step-panel p { margin: 6px 0 10px; color: #64748b; font-size: 12px; line-height: 1.6; }

.draft-refine-field {
  margin-top: 14px;
}

.draft-import-status {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #f8fafc;
  border-radius: 8px;
  padding: 12px;
  color: #64748b;
  font-size: 12px;
}

.draft-import-status.ready {
  border-color: #bbf7d0;
  background: #ecfdf5;
  color: #047857;
}

.draft-import-status strong {
  color: #0f172a;
  font-size: 13px;
}

.draft-import-plan-card {
  display: grid;
  gap: 6px;
  border: 1px solid #bbf7d0;
  border-radius: 14px;
  padding: 12px;
  background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%);
}

.draft-import-plan-card span,
.draft-import-plan-card small {
  font-size: 11px;
  color: #15803d;
  font-weight: 700;
}

.draft-import-plan-card strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #14532d;
}

.draft-import-plan-card b {
  color: #0f172a;
  font-size: 13px;
  line-height: 1.5;
}

.draft-import-plan-card p {
  margin: 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
}

.draft-error,
.draft-notice {
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}

.draft-error {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}

.draft-notice {
  border: 1px solid #bbf7d0;
  background: #f0fdf4;
  color: #047857;
}

.draft-empty {
  border: 1px dashed rgba(148, 163, 184, 0.38);
  border-radius: 8px;
  padding: 12px;
  color: #64748b;
  font-size: 13px;
  text-align: center;
}

@media (min-width: 1360px) and (max-width: 1599px) {
  .draft-workspace-grid.editor-active {
    grid-template-columns: 230px minmax(720px, 1fr) 250px;
    gap: 14px;
  }
}

@media (max-width: 1359px) {
  .draft-workspace-grid.editor-active {
    grid-template-columns: 230px minmax(720px, 1fr);
  }

  .editor-active .draft-right {
    position: fixed;
    z-index: 42;
    top: 84px;
    right: 12px;
    bottom: 12px;
    width: min(300px, calc(100vw - 24px));
    max-height: none;
    transform: translateX(calc(100% + 24px));
    transition: transform 160ms ease;
    box-shadow: 0 22px 48px rgba(15, 23, 42, 0.2);
  }

  .editor-active .draft-right.open { transform: translateX(0); }
  .editor-active .draft-right .draft-panel-close { display: inline-flex; }
  .draft-panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: block;
    border: 0;
    background: rgba(15, 23, 42, 0.28);
  }
  .draft-panel-close {
    position: absolute;
    top: 8px;
    right: 8px;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 0;
    background: #f1f5f9;
    color: #475569;
    border-radius: 8px;
    cursor: pointer;
    font-size: 18px;
  }
}

@media (max-width: 1280px) {
  .draft-workspace-grid:not(.editor-active) {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  .draft-workspace-grid:not(.editor-active) .draft-right {
    position: static;
    grid-column: 1 / -1;
    max-height: none;
  }
}

@media (max-width: 1099px) {
  .draft-workspace-grid.editor-active { grid-template-columns: minmax(0, 1fr); }
  .editor-active .draft-main-workarea { min-width: min(720px, 100%); }
  .editor-active .draft-left {
    position: fixed;
    z-index: 42;
    top: 84px;
    bottom: 12px;
    left: 12px;
    width: min(270px, calc(100vw - 24px));
    max-height: none;
    transform: translateX(calc(-100% - 24px));
    transition: transform 160ms ease;
    box-shadow: 0 22px 48px rgba(15, 23, 42, 0.2);
  }
  .editor-active .draft-left.open { transform: translateX(0); }
  .editor-active .draft-left .draft-panel-close { display: inline-flex; }
}

@media (max-width: 860px) {
  .draft-assistant-main {
    padding: 12px;
  }

  .draft-toolbar,
  .draft-login-gate,
  .draft-main-head,
  .draft-editor-commandbar,
  .draft-preview-banner,
  .draft-risk-head,
  .draft-risk-subhead {
    align-items: stretch;
    flex-direction: column;
  }

  .draft-stepper,
  .draft-workspace-grid:not(.editor-active),
  .draft-two,
  .draft-edit-tail,
  .draft-edit-fields,
  .draft-strategy-grid,
  .draft-outline-edit-head,
  .draft-strategy-edit-row,
  .draft-analysis-row {
    grid-template-columns: 1fr;
  }

  .draft-workspace-grid:not(.editor-active) .draft-left,
  .draft-workspace-grid:not(.editor-active) .draft-right {
    position: static;
    max-height: none;
  }

  .draft-state-card {
    min-height: 0;
    padding: 18px;
  }

  .draft-editor-commandbar {
    margin: -18px -18px 18px;
    padding: 16px;
  }

  .draft-head-actions,
  .draft-outline-actions,
  .draft-child-actions,
  .draft-section-actions {
    justify-content: flex-start;
  }

  .draft-directory-children {
    margin-left: 14px;
  }

  .draft-event-basic-info { padding: 18px; }
  .draft-event-basic-head { flex-direction: column; }
  .draft-event-basic-head h2 { font-size: 21px; }
  .draft-editor-card { padding: 12px; }
}
</style>
