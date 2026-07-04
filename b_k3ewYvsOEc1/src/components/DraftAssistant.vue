<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  analyzeDraftEvent,
  generateDraftOutline,
  getDraftEvent,
  getDraftEvents,
  getDraftEventOutlines,
  getDraftOutline,
  manualUpdateDraftOutline,
  refineDraftOutline,
} from '../lib/api.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['back', 'request-login'])

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
const confirmationMode = ref(false)
const importStatus = ref('待确认当前提纲版本')

const outlineEdit = reactive({
  reportTitle: '',
  reportTheme: '',
  coreArgument: '',
  outlineItems: [],
  writingFocus: '',
  sourceRequirements: '',
  uncertaintiesToVerify: '',
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
const isImportReady = computed(() => false)
const currentVersionTime = computed(() => selectedOutline.value?.createdAt ? formatTime(selectedOutline.value.createdAt) : '')
const selectedVersionLabel = computed(() => selectedOutline.value ? versionLabel(selectedOutline.value) : '尚未选择版本')

const currentStepKey = computed(() => {
  if (isImportReady.value && importStatus.value === '可导入深度编报') return 'import'
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
    { label: '涉我风险摘要', value: compactList(item.riskToUs) },
  ].map((entry) => ({ ...entry, value: entry.value || '暂无' }))
})

function roleLabel(role) {
  if (role === 'admin') return '管理员'
  if (role === 'operator') return '操作员'
  if (role === 'viewer') return '观察员'
  return role || ''
}

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
  selectedOutline.value = null
  outlineVersions.value = []
  editMode.value = false
  confirmationMode.value = false
  importStatus.value = '待确认当前提纲版本'
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
  importStatus.value = '待确认当前提纲版本'
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
  importStatus.value = '待确认当前提纲版本'
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
  importStatus.value = 'AI 修改后请重新确认版本'
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
  confirmationMode.value = true
  try {
    selectedOutline.value = await manualUpdateDraftOutline({
      outlineId: currentOutlineId.value,
      outline: editToOutline(),
      editNote: editNote.value,
    })
    editMode.value = false
    editNote.value = ''
    await refreshOutlineVersions()
    syncOutlineEdit()
    importStatus.value = '手动修改后请重新确认版本'
    notice.value = `已保存 V${selectedOutline.value.versionNo} 手动修改版`
  } catch (error) {
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
  try {
    selectedOutline.value = await getDraftOutline(outlineId)
    syncOutlineEdit()
    editMode.value = false
    confirmationMode.value = false
    importStatus.value = '待确认当前提纲版本'
  } catch (error) {
    showError(error)
  }
}

function enterEditMode() {
  if (!selectedOutline.value) return
  syncOutlineEdit()
  editMode.value = true
  confirmationMode.value = true
  importStatus.value = '编辑完成后保存为新版本'
}

function cancelEditMode() {
  editMode.value = false
  syncOutlineEdit()
}

function confirmCurrentVersion() {
  if (!hasOutline.value) return
  editMode.value = false
  confirmationMode.value = true
  importStatus.value = '当前版本已确认，导入入口待接入'
  notice.value = `已确认 ${selectedVersionLabel.value}`
}

function syncOutlineEdit() {
  const outline = normalizeOutlineForDisplay(selectedOutline.value?.outline || {})
  outlineEdit.reportTitle = outline.reportTitle || ''
  outlineEdit.reportTheme = outline.reportTheme || ''
  outlineEdit.coreArgument = outline.coreArgument || ''
  outlineEdit.outlineItems = cloneOutlineItems(outline.outlineItems)
  outlineEdit.writingFocus = arrayToLines(outline.writingFocus)
  outlineEdit.sourceRequirements = arrayToLines(outline.sourceRequirements)
  outlineEdit.uncertaintiesToVerify = arrayToLines(outline.uncertaintiesToVerify)
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

  const invalidTop = outlineItems.find((item) => !item.title || !item.summary)
  const invalidChild = outlineItems.flatMap((item) => item.children).find((item) => !item.title || !item.summary)
  if (!outlineItems.length || invalidTop || invalidChild) {
    throw new Error('请检查目录：每个一级/二级标题都需要填写标题和简短说明')
  }

  return {
    reportTitle: outlineEdit.reportTitle,
    reportTheme: outlineEdit.reportTheme,
    coreArgument: outlineEdit.coreArgument,
    outlineItems,
    writingFocus: linesToArray(outlineEdit.writingFocus),
    sourceRequirements: linesToArray(outlineEdit.sourceRequirements),
    uncertaintiesToVerify: linesToArray(outlineEdit.uncertaintiesToVerify),
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
    children: Array.isArray(item.children) ? cloneOutlineItems(item.children) : [],
  }))
}

function addOutlineItem() {
  outlineEdit.outlineItems.push({ level: 1, title: '', summary: '', children: [] })
}

function removeOutlineItem(index) {
  outlineEdit.outlineItems.splice(index, 1)
}

function addChildItem(item) {
  if (!Array.isArray(item.children)) item.children = []
  item.children.push({ level: 2, title: '', summary: '' })
}

function removeChildItem(item, childIndex) {
  item.children.splice(childIndex, 1)
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

onMounted(() => {
  void loadEvents()
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
        <span v-if="currentUser" class="draft-user-chip">{{ currentUser.username }} · {{ roleLabel(currentUser.role) }}</span>
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

      <section class="draft-workspace-grid">
        <aside class="draft-panel draft-left">
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
          </div>

          <div v-else-if="editMode && selectedOutline" class="draft-state-card draft-editor-card">
            <div class="draft-main-head">
              <div>
                <span class="draft-state-kicker">Step 4</span>
                <h2>结构化编辑提纲</h2>
                <p>编辑后会保存为新版本，不覆盖当前版本。</p>
              </div>
              <div class="draft-head-actions">
                <button class="sci-btn" type="button" @click="cancelEditMode">取消</button>
                <button class="sci-btn sci-btn-primary" type="button" :disabled="isSavingManual" @click="saveManualOutline">
                  {{ isSavingManual ? '保存中...' : '保存为新版本' }}
                </button>
              </div>
            </div>

            <div class="draft-edit-fields">
              <label class="draft-field">
                <span>建议标题</span>
                <input v-model="outlineEdit.reportTitle" class="sci-input" placeholder="报告建议标题" />
              </label>
              <label class="draft-field">
                <span>主题立意</span>
                <input v-model="outlineEdit.reportTheme" class="sci-input" placeholder="报告主题立意" />
              </label>
              <label class="draft-field">
                <span>核心判断</span>
                <textarea v-model="outlineEdit.coreArgument" class="sci-input draft-compact-textarea" placeholder="一句话说明核心判断"></textarea>
              </label>
            </div>

            <div class="draft-edit-outline">
              <div class="draft-section-head">
                <h3>目录结构</h3>
                <button class="sci-btn draft-small-btn" type="button" @click="addOutlineItem">新增一级目录</button>
              </div>
              <article v-for="(item, index) in outlineEdit.outlineItems" :key="index" class="draft-edit-item">
                <div class="draft-edit-item-head">
                  <strong>{{ outlineNumber(index) }}、一级目录</strong>
                  <button class="sci-btn draft-small-btn" type="button" @click="removeOutlineItem(index)">删除</button>
                </div>
                <input v-model="item.title" class="sci-input" placeholder="一级标题" />
                <textarea v-model="item.summary" class="sci-input draft-compact-textarea" placeholder="一级目录摘要"></textarea>
                <div class="draft-edit-children">
                  <div class="draft-edit-child-head">
                    <span>二级目录</span>
                    <button class="sci-btn draft-small-btn" type="button" @click="addChildItem(item)">新增二级目录</button>
                  </div>
                  <div v-for="(child, childIndex) in item.children" :key="childIndex" class="draft-edit-child">
                    <div class="draft-edit-child-title">
                      <b>（{{ outlineNumber(childIndex) }}）</b>
                      <button class="sci-btn draft-small-btn" type="button" @click="removeChildItem(item, childIndex)">删除</button>
                    </div>
                    <input v-model="child.title" class="sci-input" placeholder="二级标题" />
                    <textarea v-model="child.summary" class="sci-input draft-compact-textarea" placeholder="二级目录摘要"></textarea>
                  </div>
                </div>
              </article>
              <div v-if="!outlineEdit.outlineItems.length" class="draft-empty">暂无目录，请新增一级目录。</div>
            </div>

            <div class="draft-strategy-section draft-strategy-editor">
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
                      <p>突出本篇编报的核心写作方向。</p>
                    </div>
                  </div>
                  <textarea v-model="outlineEdit.writingFocus" class="sci-input draft-strategy-textarea" placeholder="一行一条写作重点"></textarea>
                  <small>一行一条，保存后将作为新版本提纲的一部分。</small>
                </section>

                <section class="draft-strategy-card source">
                  <div class="draft-strategy-card-head">
                    <span class="draft-strategy-icon">L</span>
                    <div>
                      <h4>来源要求</h4>
                      <p>标明正文需要补充和交叉验证的来源。</p>
                    </div>
                  </div>
                  <textarea v-model="outlineEdit.sourceRequirements" class="sci-input draft-strategy-textarea" placeholder="一行一条来源要求"></textarea>
                  <small>一行一条，保存后将作为新版本提纲的一部分。</small>
                </section>

                <section class="draft-strategy-card verify">
                  <div class="draft-strategy-card-head">
                    <span class="draft-strategy-icon">!</span>
                    <div>
                      <h4>待核实事项</h4>
                      <p>提示正式编报前仍需确认的关键事实。</p>
                    </div>
                  </div>
                  <textarea v-model="outlineEdit.uncertaintiesToVerify" class="sci-input draft-strategy-textarea" placeholder="一行一条待核实事项"></textarea>
                  <small>一行一条，保存后将作为新版本提纲的一部分。</small>
                </section>
              </div>
            </div>
            <label class="draft-field">
              <span>修改说明</span>
              <textarea v-model="editNote" class="sci-input draft-compact-textarea" placeholder="说明本次手动调整原因"></textarea>
            </label>
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

        <aside class="draft-panel draft-right">
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
            <button class="sci-btn draft-primary" type="button" :disabled="!selectedOutline" @click="enterEditMode">编辑提纲</button>
            <button class="sci-btn draft-primary" type="button" :disabled="!hasOutline" @click="confirmCurrentVersion">确认当前版本</button>
          </section>

          <section class="draft-side-section draft-import-box">
            <h2>导入深度编报</h2>
            <div class="draft-import-status" :class="{ ready: isVersionConfirmed }">
              <strong>{{ selectedVersionLabel }}</strong>
              <span>{{ importStatus }}</span>
            </div>
            <button class="sci-btn sci-btn-primary draft-primary" type="button" disabled title="本次重构不修改深度编报主流程">
              {{ isVersionConfirmed ? '导入入口待接入' : '确认版本后可导入' }}
            </button>
            <p>确认当前版本后可导入深度编报。本次仅完成拟稿工作台前端重构，不启动 report-jobs 主流程。</p>
          </section>
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
  grid-template-columns: 300px minmax(560px, 1fr) 320px;
  gap: 16px;
  align-items: start;
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

.draft-state-card {
  min-height: calc(100vh - 190px);
  padding: 28px;
}

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

.draft-edit-fields,
.draft-edit-outline {
  display: grid;
  gap: 12px;
}

.draft-edit-outline {
  margin: 12px 0 16px;
}

.draft-edit-item {
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #f8fafc;
  border-radius: 8px;
  padding: 14px;
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

@media (max-width: 1280px) {
  .draft-workspace-grid {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  .draft-right {
    position: static;
    grid-column: 1 / -1;
    max-height: none;
  }
}

@media (max-width: 860px) {
  .draft-assistant-main {
    padding: 12px;
  }

  .draft-toolbar,
  .draft-login-gate,
  .draft-main-head {
    align-items: stretch;
    flex-direction: column;
  }

  .draft-stepper,
  .draft-workspace-grid,
  .draft-two,
  .draft-edit-tail,
  .draft-strategy-grid,
  .draft-analysis-row {
    grid-template-columns: 1fr;
  }

  .draft-left,
  .draft-right {
    position: static;
    max-height: none;
  }

  .draft-state-card {
    min-height: 0;
    padding: 18px;
  }

  .draft-directory-children {
    margin-left: 14px;
  }
}
</style>
