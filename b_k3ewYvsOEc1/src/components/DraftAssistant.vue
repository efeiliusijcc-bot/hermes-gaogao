<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Check, History, LoaderCircle, Pencil } from '@lucide/vue'
import {
  analyzeDraftEvent,
  createReportJob,
  generateDraftOutline,
  getDraftEvent,
  getDraftEvents,
  importDraftOutline,
  manualUpdateDraftOutline,
  refineDraftOutline,
} from '../lib/api.js'
import {
  buildDraftAnalysisSections,
  buildDraftAnalyzePayload,
  resetDraftScroll,
  restoredDraftStage,
} from '../lib/draftAssistantFlow.js'
import { createDraftAutosave } from '../lib/draftAutosave.js'
import DraftAnalysisView from './DraftAnalysisView.vue'
import DraftHistorySidebar from './DraftHistorySidebar.vue'
import DraftImportState from './DraftImportState.vue'
import DraftOutlineEditor from './DraftOutlineEditor.vue'
import DraftOutlineView from './DraftOutlineView.vue'
import DraftSourceComposer from './DraftSourceComposer.vue'

const props = defineProps({
  currentUser: { type: Object, default: null },
  initialEventId: { type: String, default: '' },
})

const emit = defineEmits(['back', 'request-login', 'report-job-created'])

const stage = ref('input')
const sourceInput = ref('')
const sourceError = ref('')
const analysisError = ref('')
const pageError = ref('')
const eventResult = ref(null)
const eventList = ref([])
const selectedOutline = ref(null)
const outlineDraft = ref(emptyOutline())
const revisionFeedback = ref('')
const saveStatus = ref('idle')
const saveError = ref('')
const historyOpen = ref(false)
const isAnalyzing = ref(false)
const isGeneratingOutline = ref(false)
const isRevising = ref(false)
const isLoadingEvents = ref(false)
const importState = reactive({ status: 'idle', error: '', job: null })
const mainRef = ref(null)

const currentEventId = computed(() => (
  eventResult.value?.eventId
  || eventResult.value?.event?.eventId
  || selectedOutline.value?.eventId
  || ''
))
const analysisSections = computed(() => buildDraftAnalysisSections(eventResult.value || {}))
const isImporting = computed(() => stage.value === 'importing' || stage.value === 'completed')

function emptyOutline() {
  return {
    reportTitle: '',
    reportTheme: '',
    coreArgument: '',
    outlineItems: [],
    writingFocus: [],
    sourceRequirements: [],
    uncertaintiesToVerify: [],
  }
}

function cloneOutline(value = {}) {
  const normalized = normalizeOutline(value)
  return JSON.parse(JSON.stringify(normalized))
}

function normalizeOutline(value = {}) {
  const outlineItems = normalizeOutlineItems(value.outlineItems)
  return {
    ...emptyOutline(),
    reportTitle: String(value.reportTitle || ''),
    reportTheme: String(value.reportTheme || ''),
    coreArgument: String(value.coreArgument || value.coreJudgement || ''),
    outlineItems: outlineItems.length ? outlineItems : legacyOutlineItems(value),
    writingFocus: arrayValue(value.writingFocus || value.writingConstraints),
    sourceRequirements: arrayValue(value.sourceRequirements),
    uncertaintiesToVerify: arrayValue(value.uncertaintiesToVerify),
  }
}

function normalizeOutlineItems(items) {
  if (!Array.isArray(items)) return []
  return items.map((item) => ({
    level: 1,
    title: String(item?.title || ''),
    summary: String(item?.summary || ''),
    children: Array.isArray(item?.children)
      ? item.children.map((child) => ({
          level: 2,
          title: String(child?.title || ''),
          summary: String(child?.summary || ''),
        }))
      : [],
  }))
}

function legacyOutlineItems(value) {
  const sections = [
    ['mainContentPlan', '事件概况'],
    ['attitudesPlan', '各方态度'],
    ['riskPlan', '涉我风险'],
    ['trendPlan', '趋势研判'],
  ]
  return sections.map(([key, title]) => {
    const rows = arrayValue(value[key]).map(readableText).filter(Boolean)
    if (!rows.length) return null
    return {
      level: 1,
      title,
      summary: rows.join('；'),
      children: rows.slice(0, 6).map((summary) => ({
        level: 2,
        title: summary.split(/[，。；;,.]/)[0]?.slice(0, 40) || '分项内容',
        summary,
      })),
    }
  }).filter(Boolean)
}

function arrayValue(value) {
  return Array.isArray(value) ? value : []
}

function readableText(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (!value || typeof value !== 'object') return ''
  return String(value.summary || value.text || value.content || value.title || '').trim()
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || '操作失败')
}

function validateOutline(value) {
  if (!String(value.reportTitle || '').trim()) throw new Error('请填写建议标题后再保存')
  if (!Array.isArray(value.writingFocus)) value.writingFocus = []
  if (!Array.isArray(value.sourceRequirements)) value.sourceRequirements = []
  if (!Array.isArray(value.uncertaintiesToVerify)) value.uncertaintiesToVerify = []
  const invalidSection = value.outlineItems.some((item) => (
    !String(item.title || '').trim()
    || !String(item.summary || '').trim()
    || item.children.some((child) => !String(child.title || '').trim() || !String(child.summary || '').trim())
  ))
  if (!value.outlineItems.length || invalidSection) throw new Error('请补全目录标题和说明后再保存')
}

let syncingOutline = false

function syncOutlineDraft(value) {
  syncingOutline = true
  outlineDraft.value = cloneOutline(value)
  saveStatus.value = 'saved'
  saveError.value = ''
  queueMicrotask(() => { syncingOutline = false })
}

const autosave = createDraftAutosave({
  save: async (snapshot) => {
    validateOutline(snapshot)
    const saved = await manualUpdateDraftOutline({
      outlineId: selectedOutline.value.outlineId,
      outline: snapshot,
      editNote: '',
    })
    selectedOutline.value = saved
  },
  onState: (status, error) => {
    saveStatus.value = status
    saveError.value = error ? messageOf(error) : ''
  },
})

watch(outlineDraft, (value) => {
  if (syncingOutline || stage.value !== 'outline' || !selectedOutline.value?.outlineId) return
  autosave.schedule(cloneOutline(value))
}, { deep: true, flush: 'sync' })

async function loadEvents() {
  if (!props.currentUser) return
  isLoadingEvents.value = true
  try {
    const result = await getDraftEvents({ page: 1, pageSize: 50 })
    eventList.value = Array.isArray(result?.items) ? result.items : []
  } catch (error) {
    pageError.value = messageOf(error)
  } finally {
    isLoadingEvents.value = false
  }
}

function resetImportState() {
  importState.status = 'idle'
  importState.error = ''
  importState.job = null
}

function resetCurrentDraft() {
  eventResult.value = null
  selectedOutline.value = null
  syncingOutline = true
  outlineDraft.value = emptyOutline()
  queueMicrotask(() => { syncingOutline = false })
  revisionFeedback.value = ''
  analysisError.value = ''
  pageError.value = ''
  saveStatus.value = 'idle'
  saveError.value = ''
  resetImportState()
}

async function startDraft() {
  sourceError.value = ''
  analysisError.value = ''
  pageError.value = ''
  if (!props.currentUser) {
    emit('request-login')
    return
  }

  let payload
  try {
    payload = buildDraftAnalyzePayload(sourceInput.value)
  } catch (error) {
    sourceError.value = messageOf(error)
    return
  }

  resetCurrentDraft()
  stage.value = 'analysis'
  isAnalyzing.value = true
  try {
    eventResult.value = await analyzeDraftEvent(payload)
    await loadEvents()
  } catch (error) {
    analysisError.value = messageOf(error)
  } finally {
    isAnalyzing.value = false
  }
}

async function createOutline() {
  pageError.value = ''
  if (!currentEventId.value) {
    pageError.value = '请先完成事件分析'
    return
  }
  isGeneratingOutline.value = true
  try {
    const created = await generateDraftOutline({
      eventId: currentEventId.value,
      outlinePreference: '',
    })
    selectedOutline.value = created
    syncOutlineDraft(created.outline)
    stage.value = 'outline'
  } catch (error) {
    pageError.value = messageOf(error)
  } finally {
    isGeneratingOutline.value = false
  }
}

async function flushBeforeLeaving() {
  try {
    await autosave.flush()
    return saveStatus.value !== 'error'
  } catch (error) {
    pageError.value = `当前提纲保存失败：${messageOf(error)}`
    return false
  }
}

async function reviseOutline() {
  pageError.value = ''
  if (!revisionFeedback.value.trim() || !selectedOutline.value?.outlineId) return
  if (!(await flushBeforeLeaving())) return
  isRevising.value = true
  try {
    const revised = await refineDraftOutline({
      outlineId: selectedOutline.value.outlineId,
      userFeedback: revisionFeedback.value.trim(),
    })
    selectedOutline.value = revised
    syncOutlineDraft(revised.outline)
    revisionFeedback.value = ''
  } catch (error) {
    pageError.value = messageOf(error)
  } finally {
    isRevising.value = false
  }
}

async function retrySave() {
  pageError.value = ''
  try {
    await autosave.retry()
  } catch (error) {
    pageError.value = `当前提纲保存失败：${messageOf(error)}`
  }
}

async function showConfirmation() {
  pageError.value = ''
  if (!(await flushBeforeLeaving())) return
  stage.value = 'confirm'
}

async function returnToAnalysis() {
  pageError.value = ''
  if (!(await flushBeforeLeaving())) return
  stage.value = 'analysis'
}

function buildDraftReportPayload(imported, reportTitle) {
  const knownContext = {
    kind: 'draft_assistant_import',
    topic: reportTitle,
    reportType: 'K报',
    draftAssistantMode: true,
    eventId: imported.eventId,
    outlineId: imported.outlineId,
    planId: imported.planId,
    databaseSourceOptions: {
      enabled: true,
      lookbackDays: 30,
      maxMetadataRows: 50,
      maxContentRows: 8,
    },
    draftAssistantInstructions: [
      '严格依据用户已确认的拟稿提纲生成深度编报。',
      '不得脱离确认提纲自由发挥。',
      '缺少来源的信息必须标注待核实。',
    ],
  }
  return {
    skill: 'write-hb',
    payload: {
      title: reportTitle,
      topic: reportTitle,
      report_type: 'K报',
      eventId: imported.eventId,
      outlineId: imported.outlineId,
      planId: imported.planId,
      draftAssistantMode: true,
      deepReportEnabled: true,
      known_context: JSON.stringify(knownContext, null, 2),
      focus_areas: ['主要内容', '各方态度', '涉我风险', '趋势研判'],
      language: 'zh-CN',
    },
  }
}

async function importToDeepReport() {
  pageError.value = ''
  if (!selectedOutline.value?.outlineId) return
  if (!(await flushBeforeLeaving())) return
  stage.value = 'importing'
  importState.status = 'creating'
  importState.error = ''
  try {
    const imported = await importDraftOutline({ outlineId: selectedOutline.value.outlineId })
    const reportTitle = imported.plan?.reportTitle || outlineDraft.value.reportTitle || '未命名编报'
    const created = await createReportJob(buildDraftReportPayload(imported, reportTitle))
    const job = { ...created, payload: { topic: reportTitle, report_type: 'K报' } }
    importState.status = 'completed'
    importState.job = job
    stage.value = 'completed'
    emit('report-job-created', job)
  } catch (error) {
    importState.status = 'error'
    importState.error = messageOf(error)
  }
}

function sourceFromEvent(result) {
  const raw = result?.event?.rawInput || {}
  if (String(raw.materials || '').trim()) return String(raw.materials).trim()
  return [result?.event?.title, result?.event?.summary].filter(Boolean).join('\n\n')
}

async function openEvent(eventId) {
  if (!eventId || stage.value === 'importing') return
  pageError.value = ''
  if (!(await flushBeforeLeaving())) return
  try {
    const result = await getDraftEvent(eventId)
    eventResult.value = result
    sourceInput.value = sourceFromEvent(result)
    selectedOutline.value = result.latestOutline || null
    revisionFeedback.value = ''
    analysisError.value = ''
    resetImportState()
    if (selectedOutline.value?.outline) syncOutlineDraft(selectedOutline.value.outline)
    else {
      syncingOutline = true
      outlineDraft.value = emptyOutline()
      queueMicrotask(() => { syncingOutline = false })
      saveStatus.value = 'idle'
    }
    stage.value = restoredDraftStage(result)
    historyOpen.value = false
  } catch (error) {
    pageError.value = messageOf(error)
  }
}

async function startNewEvent() {
  if (!(await flushBeforeLeaving())) return
  sourceInput.value = ''
  sourceError.value = ''
  resetCurrentDraft()
  stage.value = 'input'
  historyOpen.value = false
}

function handleBeforeUnload(event) {
  if (!['dirty', 'saving'].includes(saveStatus.value)) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  await loadEvents()
  if (props.initialEventId) await openEvent(props.initialEventId)
})

watch(() => props.initialEventId, (eventId) => {
  if (eventId && eventId !== currentEventId.value) void openEvent(eventId)
})

watch(() => props.currentUser, (user) => {
  if (user && !eventList.value.length) void loadEvents()
})

watch(stage, () => {
  resetDraftScroll(mainRef.value)
}, { flush: 'post' })

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  void autosave.flush().catch(() => undefined).finally(() => autosave.dispose())
})
</script>

<template>
  <main ref="mainRef" class="draft-assistant-main">
    <div v-if="!currentUser" class="draft-login-gate">
      <h1>请先登录</h1>
      <p>登录后可使用拟稿助手并保存当前进度。</p>
      <button type="button" @click="emit('request-login')">登录</button>
    </div>

    <template v-else>
      <header class="draft-assistant-bar">
        <button
          type="button"
          aria-label="查看历史编报"
          title="历史编报"
          :disabled="stage === 'importing'"
          @click="historyOpen = true"
        >
          <History :size="19" aria-hidden="true" />
        </button>
        <strong>拟稿助手</strong>
        <span class="draft-bar-spacer" aria-hidden="true"></span>
      </header>

      <div class="draft-assistant-content" :class="`stage-${stage}`">
        <div v-if="pageError" class="draft-page-error" role="alert">{{ pageError }}</div>

        <DraftSourceComposer
          v-if="stage === 'input'"
          v-model="sourceInput"
          :loading="isAnalyzing"
          :error="sourceError"
          @submit="startDraft"
        />

        <DraftAnalysisView
          v-else-if="stage === 'analysis'"
          :source-input="sourceInput"
          :sections="analysisSections"
          :loading="isAnalyzing"
          :error="analysisError"
          :generating="isGeneratingOutline"
          @back="stage = 'input'"
          @retry="startDraft"
          @generate="createOutline"
        />

        <DraftOutlineEditor
          v-else-if="stage === 'outline'"
          v-model="outlineDraft"
          v-model:feedback="revisionFeedback"
          :save-status="saveStatus"
          :save-error="saveError"
          :revising="isRevising"
          @revise="reviseOutline"
          @retry-save="retrySave"
          @confirm="showConfirmation"
          @back="returnToAnalysis"
        />

        <section v-else-if="stage === 'confirm'" class="draft-confirmation" aria-labelledby="draft-confirm-title">
          <header>
            <p>拟稿提纲</p>
            <h1 id="draft-confirm-title">确认提纲</h1>
            <span>请核对以下内容。确认后将自动创建深度编报任务。</span>
          </header>
          <DraftOutlineView :outline="outlineDraft" />
          <footer>
            <button class="secondary" type="button" @click="stage = 'outline'">
              <Pencil :size="17" aria-hidden="true" />返回修改
            </button>
            <button class="primary" type="button" @click="importToDeepReport">
              <Check :size="17" aria-hidden="true" />确认并创建深度编报
            </button>
          </footer>
        </section>

        <DraftImportState
          v-else-if="isImporting"
          :status="importState.status"
          :error="importState.error"
          @retry="importToDeepReport"
          @back="stage = 'confirm'"
        />

        <div v-else class="draft-route-loading" aria-live="polite">
          <LoaderCircle :size="22" class="draft-spin" aria-hidden="true" />正在加载...
        </div>
      </div>

      <DraftHistorySidebar
        :open="historyOpen"
        :current-event-id="currentEventId"
        :events="eventList"
        :loading="isLoadingEvents"
        @close="historyOpen = false"
        @select-event="openEvent"
        @create-event="startNewEvent"
      />
    </template>
  </main>
</template>

<style scoped>
.draft-assistant-main { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; background: #fbfbfc; color: #1f2937; }
.draft-assistant-bar { position: sticky; top: 0; z-index: 20; display: grid; grid-template-columns: 40px minmax(0, 1fr) 40px; align-items: center; min-height: 56px; border-bottom: 1px solid #e5e7eb; background: rgba(251, 251, 252, 0.96); padding: 0 18px; backdrop-filter: blur(12px); }
.draft-assistant-bar strong { overflow: hidden; color: #292e37; font-size: 14px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.draft-assistant-bar button { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 0; background: transparent; color: #586171; border-radius: 7px; cursor: pointer; }
.draft-assistant-bar button:hover:not(:disabled) { background: #eef0f3; color: #20252d; }
.draft-assistant-bar button:disabled { color: #b9bec6; cursor: not-allowed; }
.draft-assistant-bar button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.2); outline-offset: 1px; }
.draft-bar-spacer { width: 36px; }
.draft-assistant-content { width: 100%; min-width: 0; box-sizing: border-box; padding: 0 28px; }
.draft-page-error { width: min(1040px, 100%); box-sizing: border-box; margin: 16px auto 0; border-left: 3px solid #d14343; background: #fff4f4; color: #9f2424; padding: 11px 13px; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.draft-confirmation { width: min(920px, 100%); margin: 0 auto; padding: 24px 0 64px; }
.draft-confirmation > header { margin-bottom: 24px; border-bottom: 1px solid #e1e5ea; padding-bottom: 17px; }
.draft-confirmation > header p { margin: 0 0 4px; color: #64748b; font-size: 12px; font-weight: 700; }
.draft-confirmation > header h1 { margin: 0; color: #111827; font-size: 24px; line-height: 1.4; letter-spacing: 0; }
.draft-confirmation > header span { display: block; margin-top: 7px; color: #737d8b; font-size: 12px; line-height: 1.7; }
.draft-confirmation > footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 32px; border-top: 1px solid #e1e5ea; padding-top: 18px; }
.draft-confirmation > footer button, .draft-login-gate button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; border-radius: 7px; padding: 0 14px; cursor: pointer; font-size: 12px; font-weight: 700; }
.draft-confirmation .secondary { border: 1px solid #d5dbe3; background: #fff; color: #4b5563; }
.draft-confirmation .primary, .draft-login-gate button { border: 1px solid #1f2937; background: #1f2937; color: #fff; }
.draft-login-gate { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: calc(100vh - 120px); padding: 32px; text-align: center; }
.draft-login-gate h1 { margin: 0; color: #172033; font-size: 24px; }
.draft-login-gate p { margin: 10px 0 22px; color: #6b7280; font-size: 13px; }
.draft-route-loading { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 420px; color: #6b7280; font-size: 13px; }
.draft-spin { animation: draft-spin 800ms linear infinite; }
@keyframes draft-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .draft-assistant-bar { padding: 0 10px; }
  .draft-assistant-content { padding: 0 14px; }
  .draft-confirmation { padding-top: 18px; }
  .draft-confirmation > footer { align-items: stretch; flex-direction: column-reverse; }
  .draft-confirmation > footer button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .draft-spin { animation: none; } }
</style>
