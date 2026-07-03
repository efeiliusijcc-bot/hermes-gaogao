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
const outlineEdit = reactive({
  reportTitle: '',
  reportTheme: '',
  coreArgument: '',
  outlineItemsText: '',
  writingFocus: '',
  sourceRequirements: '',
  uncertaintiesToVerify: '',
})

const analysis = computed(() => eventResult.value?.analysis || eventResult.value?.event?.analysis || null)
const sources = computed(() => eventResult.value?.sources || [])
const attitudes = computed(() => eventResult.value?.attitudes || analysis.value?.attitudes || [])
const currentEventId = computed(() => eventResult.value?.eventId || eventResult.value?.event?.eventId || '')
const currentOutlineId = computed(() => selectedOutline.value?.outlineId || '')
const canUse = computed(() => Boolean(props.currentUser))
const displayOutline = computed(() => normalizeOutlineForDisplay(selectedOutline.value?.outline || {}))
const hasOutline = computed(() => Boolean(selectedOutline.value?.outline && displayOutline.value.outlineItems.length))
const currentVersionText = computed(() => selectedOutline.value ? `当前版本：${versionLabel(selectedOutline.value)}` : '尚未生成提纲')
const currentVersionTime = computed(() => selectedOutline.value?.createdAt ? formatTime(selectedOutline.value.createdAt) : '')
const eventAnalyzed = computed(() => Boolean(analysis.value))

const cnNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

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
  try {
    eventResult.value = await analyzeDraftEvent({
      title: form.title,
      materials: form.materials,
      links: parseLinks(form.linksText),
      category: form.category,
      region: form.region,
    })
    notice.value = '事件分析已生成'
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
  try {
    eventResult.value = await getDraftEvent(eventId)
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
  } catch (error) {
    showError(error)
  }
}

function syncOutlineEdit() {
  const outline = normalizeOutlineForDisplay(selectedOutline.value?.outline || {})
  outlineEdit.reportTitle = outline.reportTitle || ''
  outlineEdit.reportTheme = outline.reportTheme || ''
  outlineEdit.coreArgument = outline.coreArgument || ''
  outlineEdit.outlineItemsText = outlineItemsToText(outline.outlineItems)
  outlineEdit.writingFocus = arrayToLines(outline.writingFocus)
  outlineEdit.sourceRequirements = arrayToLines(outline.sourceRequirements)
  outlineEdit.uncertaintiesToVerify = arrayToLines(outline.uncertaintiesToVerify)
}

function editToOutline() {
  return {
    reportTitle: outlineEdit.reportTitle,
    reportTheme: outlineEdit.reportTheme,
    coreArgument: outlineEdit.coreArgument,
    outlineItems: parseOutlineItemsText(outlineEdit.outlineItemsText),
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
    writingFocus: Array.isArray(outline?.writingFocus) ? outline.writingFocus : arrayOrEmpty(outline?.writingConstraints),
    sourceRequirements: arrayOrEmpty(outline?.sourceRequirements),
    uncertaintiesToVerify: arrayOrEmpty(outline?.uncertaintiesToVerify),
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
      if (!title || !summary) return null
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
              .filter((child) => child.title && child.summary)
          : [],
      }
    })
    .filter(Boolean)
}

function legacyOutlineItems(outline) {
  const sections = [
    ['mainContentPlan', '事件概况与主要内容'],
    ['attitudesPlan', '各方态度'],
    ['riskPlan', '涉我风险'],
    ['trendPlan', '后续趋势研判'],
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

function outlineItemsToText(items) {
  return normalizeOutlineItems(items)
    .map((item, index) => {
      const lines = [`${cnNumbers[index] || index + 1}、${item.title}`, item.summary]
      item.children.forEach((child, childIndex) => {
        lines.push(`（${cnNumbers[childIndex] || childIndex + 1}）${child.title}`)
        lines.push(child.summary)
      })
      return lines.join('\n')
    })
    .join('\n\n')
}

function parseOutlineItemsText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const items = []
  let current = null
  let currentChild = null

  for (const line of lines) {
    const top = line.match(/^([一二三四五六七八九十\d]+)[、.．]\s*(.+)$/)
    const child = line.match(/^（([一二三四五六七八九十\d]+)）\s*(.+)$/)
    if (top) {
      current = { level: 1, title: top[2].trim(), summary: '', children: [] }
      items.push(current)
      currentChild = null
      continue
    }
    if (child) {
      if (!current) throw new Error('二级目录前缺少一级目录')
      currentChild = { level: 2, title: child[2].trim(), summary: '' }
      current.children.push(currentChild)
      continue
    }
    if (currentChild) {
      currentChild.summary = currentChild.summary ? `${currentChild.summary}\n${line}` : line
    } else if (current) {
      current.summary = current.summary ? `${current.summary}\n${line}` : line
    } else {
      throw new Error('目录文本必须从“一、标题”开始')
    }
  }

  const invalidTop = items.find((item) => !item.title || !item.summary)
  const invalidChild = items.flatMap((item) => item.children).find((item) => !item.title || !item.summary)
  if (!items.length || invalidTop || invalidChild) {
    throw new Error('请检查目录格式：每个一级/二级标题下都需要填写简短说明')
  }
  return items
}

function outlineNumber(index) {
  return cnNumbers[index] || String(index + 1)
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : []
}

function itemToText(item) {
  return typeof item === 'string' ? item : JSON.stringify(item)
}

function arrayToLines(value) {
  if (!Array.isArray(value)) return ''
  return value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n')
}

function linesToArray(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function versionLabel(item) {
  const type = item?.editType === 'ai_refine' ? 'AI修改' : item?.editType === 'manual' ? '手动修改' : 'AI生成'
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
        <p>开源情报分析、证据整理、各方态度归纳与编报提纲版本管理</p>
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

    <section v-else class="draft-grid">
      <aside class="draft-panel draft-left">
        <div class="draft-panel-head">
          <h2>事件输入</h2>
          <button class="sci-btn text-[10px]" type="button" :disabled="isLoadingEvents" @click="loadEvents">刷新历史</button>
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
          <textarea v-model="form.linksText" class="sci-input draft-links" placeholder="一行一个链接，本阶段保存为待核实信源"></textarea>
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

      <section class="draft-panel draft-center draft-outline-workbench">
        <div class="draft-panel-head draft-workbench-head">
          <div>
            <h2>拟稿提纲（目录式）</h2>
            <div class="draft-version-meta">
              <span>{{ currentVersionText }}</span>
              <span v-if="currentVersionTime">生成时间：{{ currentVersionTime }}</span>
              <span v-if="currentEventId">事件 {{ currentEventId.slice(0, 8) }}</span>
            </div>
          </div>
          <div class="draft-workbench-actions">
            <button class="sci-btn" type="button" :disabled="!selectedOutline" @click="editMode = !editMode; syncOutlineEdit()">
              {{ editMode ? '退出编辑' : '编辑提纲' }}
            </button>
            <button class="sci-btn sci-btn-primary" type="button" :disabled="isRefining || !currentOutlineId" @click="refineOutline">
              {{ isRefining ? '修改中...' : 'AI修改提纲' }}
            </button>
          </div>
        </div>
        <div v-if="errorMessage" class="draft-error">{{ errorMessage }}</div>
        <div v-if="notice" class="draft-notice">{{ notice }}</div>

        <div v-if="hasOutline && !editMode" class="draft-outline-view">
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

          <div class="draft-outline-section-title">
            <span>目录结构</span>
          </div>
          <div class="draft-outline-directory">
            <div v-for="(item, index) in displayOutline.outlineItems" :key="`${index}-${item.title}`" class="draft-outline-item">
              <button class="draft-outline-title" type="button">
                <span class="draft-outline-index">{{ outlineNumber(index) }}</span>
                <span>{{ outlineNumber(index) }}、{{ item.title }}</span>
                <span class="draft-outline-chevron">⌄</span>
              </button>
              <p>{{ item.summary }}</p>
              <div v-if="item.children?.length" class="draft-outline-children">
                <div v-for="(child, childIndex) in item.children" :key="`${childIndex}-${child.title}`" class="draft-outline-child">
                  <div class="draft-outline-child-title">（{{ outlineNumber(childIndex) }}）{{ child.title }}</div>
                  <p>{{ child.summary }}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="draft-outline-footer">
            <div>
              <b>写作重点</b>
              <ul><li v-for="(item, index) in displayOutline.writingFocus" :key="index">{{ itemToText(item) }}</li></ul>
            </div>
            <div>
              <b>来源使用要求</b>
              <ul><li v-for="(item, index) in displayOutline.sourceRequirements" :key="index">{{ itemToText(item) }}</li></ul>
            </div>
            <div>
              <b>待核实事项</b>
              <ul><li v-for="(item, index) in displayOutline.uncertaintiesToVerify" :key="index">{{ itemToText(item) }}</li></ul>
            </div>
          </div>
        </div>

        <div v-else-if="editMode && selectedOutline" class="draft-outline-edit draft-center-edit">
          <input v-model="outlineEdit.reportTitle" class="sci-input" placeholder="建议标题" />
          <input v-model="outlineEdit.reportTheme" class="sci-input" placeholder="主题立意" />
          <textarea v-model="outlineEdit.coreArgument" class="sci-input" placeholder="核心判断"></textarea>
          <textarea
            v-model="outlineEdit.outlineItemsText"
            class="sci-input draft-outline-text"
            placeholder="一、事件概况&#10;简要说明事件背景、主要措施和当前进展。&#10;（一）政策提出背景&#10;说明该事件发生的背景和原因。"
          ></textarea>
          <div class="draft-three-edit">
            <textarea v-model="outlineEdit.writingFocus" class="sci-input" placeholder="写作重点：一行一条"></textarea>
            <textarea v-model="outlineEdit.sourceRequirements" class="sci-input" placeholder="来源要求：一行一条"></textarea>
            <textarea v-model="outlineEdit.uncertaintiesToVerify" class="sci-input" placeholder="待核实事项：一行一条"></textarea>
          </div>
          <textarea v-model="editNote" class="sci-input" placeholder="手动修改说明"></textarea>
          <button class="sci-btn sci-btn-primary draft-primary" type="button" :disabled="isSavingManual" @click="saveManualOutline">
            {{ isSavingManual ? '保存中...' : '保存为新版本' }}
          </button>
        </div>

        <div v-else-if="eventAnalyzed" class="draft-analysis-brief">
          <article class="draft-block highlight">
            <h3>分析已生成</h3>
            <p>{{ analysis.oneSentenceSummary || analysis.basicSituation || '事件分析已完成，请在右侧生成目录式提纲。' }}</p>
          </article>
          <button class="sci-btn sci-btn-primary draft-primary" type="button" :disabled="isGeneratingOutline" @click="createOutline">
            {{ isGeneratingOutline ? '生成中...' : '生成目录式提纲' }}
          </button>
        </div>

        <div v-else class="draft-empty large">输入事件并开始分析后，可生成目录式拟稿提纲。</div>
      </section>

      <aside class="draft-panel draft-right">
        <div class="draft-panel-head">
          <h2>提纲版本</h2>
        </div>

        <section class="draft-block compact">
          <div class="draft-side-head">
            <h3>版本列表</h3>
            <button class="sci-btn text-[10px]" type="button" :disabled="isGeneratingOutline || !currentEventId" @click="createOutline">
              + 生成新提纲
            </button>
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

        <section class="draft-block compact">
          <h3>生成提纲</h3>
          <textarea v-model="outlinePreference" class="sci-input draft-links" placeholder="提纲偏好，例如突出涉我风险、强化各方态度来源"></textarea>
          <button class="sci-btn sci-btn-primary draft-primary" type="button" :disabled="isGeneratingOutline || !currentEventId" @click="createOutline">
            {{ isGeneratingOutline ? '生成中...' : '生成提纲' }}
          </button>
        </section>

        <section class="draft-block compact">
          <h3>AI 修改提纲</h3>
          <textarea v-model="refineFeedback" class="sci-input draft-links" placeholder="说明希望调整的目录顺序、一级标题、二级标题或写作重点"></textarea>
          <button class="sci-btn draft-primary" type="button" :disabled="isRefining || !currentOutlineId" @click="refineOutline">
            {{ isRefining ? '修改中...' : 'AI 修改提纲' }}
          </button>
        </section>

        <section class="draft-block compact draft-import-box">
          <h3>导入深度编报</h3>
          <div v-if="selectedOutline" class="draft-import-success">
            <strong>已准备好提纲版本</strong>
            <span>版本：{{ versionLabel(selectedOutline) }}</span>
            <span>时间：{{ currentVersionTime || '暂无' }}</span>
          </div>
          <button class="sci-btn sci-btn-primary draft-primary" type="button" disabled title="下一阶段支持导入深度编报">
            创建深度编报任务
          </button>
          <button class="sci-btn draft-primary draft-disabled-btn" type="button" disabled>
            导入深度编报（下一阶段支持）
          </button>
        </section>

        <section class="draft-block compact draft-tip-box">
          <h3>使用提示</h3>
          <p>先生成并确认提纲，后续系统将按目录结构进行内容规划和撰写。当前阶段只管理拟稿提纲，不会直接启动深度编报。</p>
        </section>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.draft-assistant-main {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px;
}

.draft-toolbar,
.draft-login-gate,
.draft-panel {
  border: 1px solid rgba(14, 165, 233, 0.18);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
}

.draft-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 18px 20px;
  border-radius: 8px;
}

.draft-toolbar h1 {
  margin: 0;
  color: #0f172a;
  font-size: 22px;
  font-weight: 800;
}

.draft-toolbar p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 13px;
}

.draft-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.draft-user-chip {
  border: 1px solid rgba(14, 165, 233, 0.24);
  background: rgba(236, 254, 255, 0.8);
  color: #0369a1;
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

.draft-grid {
  display: grid;
  grid-template-columns: minmax(270px, 0.85fr) minmax(520px, 1.8fr) minmax(280px, 0.85fr);
  gap: 16px;
  align-items: start;
}

.draft-panel {
  border-radius: 8px;
  padding: 16px;
}

.draft-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.draft-panel-head h2,
.draft-block h3 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  font-weight: 800;
}

.draft-id {
  color: #64748b;
  font-size: 12px;
}

.draft-outline-workbench {
  min-width: 0;
}

.draft-workbench-head {
  align-items: flex-start;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  padding-bottom: 14px;
}

.draft-version-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  color: #64748b;
  font-size: 12px;
}

.draft-version-meta span:first-child {
  border: 1px solid #bbf7d0;
  background: #ecfdf5;
  color: #047857;
  border-radius: 999px;
  padding: 3px 8px;
  font-weight: 800;
}

.draft-workbench-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
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
  font-weight: 700;
}

.draft-textarea {
  min-height: 150px;
  resize: vertical;
}

.draft-links {
  min-height: 86px;
  resize: vertical;
}

.draft-two {
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

.draft-history h3 {
  margin: 0 0 10px;
  color: #334155;
  font-size: 13px;
  font-weight: 800;
}

.draft-history-item,
.draft-version {
  width: 100%;
  display: block;
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(248, 250, 252, 0.9);
  color: #0f172a;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
}

.draft-history-item:hover,
.draft-version:hover,
.draft-version.active {
  border-color: rgba(14, 165, 233, 0.55);
  background: rgba(236, 254, 255, 0.9);
}

.draft-history-item strong,
.draft-version strong {
  display: block;
  font-size: 12px;
}

.draft-history-item span,
.draft-history-item small,
.draft-version span,
.draft-version small {
  display: block;
  margin-top: 4px;
  color: #64748b;
  font-size: 11px;
}

.draft-version {
  position: relative;
  padding: 12px;
}

.draft-version.active {
  border-color: rgba(37, 99, 235, 0.75);
  background: linear-gradient(135deg, rgba(239, 246, 255, 0.98), rgba(255, 255, 255, 0.94));
  box-shadow: 0 12px 26px rgba(37, 99, 235, 0.12);
}

.draft-version.refine strong {
  color: #2563eb;
}

.draft-version.manual strong {
  color: #7c3aed;
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

.draft-analysis,
.draft-right {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.draft-block {
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(248, 250, 252, 0.7);
  border-radius: 8px;
  padding: 12px;
}

.draft-block.highlight {
  border-color: rgba(14, 165, 233, 0.35);
  background: linear-gradient(135deg, rgba(236, 254, 255, 0.95), rgba(255, 255, 255, 0.95));
}

.draft-block.compact {
  padding: 12px;
}

.draft-block p {
  margin: 8px 0 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.draft-block ul {
  margin: 8px 0 0;
  padding-left: 18px;
  color: #334155;
  font-size: 13px;
  line-height: 1.7;
}

.draft-block-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.draft-source-list,
.draft-attitudes,
.draft-outline-edit,
.draft-outline-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.draft-source-card,
.draft-attitude {
  border: 1px solid rgba(14, 165, 233, 0.18);
  background: rgba(255, 255, 255, 0.85);
  border-radius: 8px;
  padding: 10px;
}

.draft-source-card div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.draft-source-card strong,
.draft-attitude strong {
  color: #0f172a;
  font-size: 13px;
}

.draft-source-card span,
.draft-attitude span {
  color: #64748b;
  font-size: 11px;
}

.draft-source-card a {
  color: #0284c7;
  font-size: 12px;
  font-weight: 700;
}

.draft-outline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.draft-outline-view h4 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
}

.draft-outline-meta,
.draft-outline-directory,
.draft-outline-footer {
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.78);
  border-radius: 8px;
  padding: 10px;
}

.draft-outline-directory {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.draft-outline-item {
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  padding: 12px;
}

.draft-outline-title {
  width: 100%;
  display: grid;
  grid-template-columns: 34px 1fr 20px;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  color: #0f172a;
  font-size: 14px;
  font-weight: 800;
  cursor: default;
}

.draft-outline-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(37, 99, 235, 0.2);
  background: #f8fafc;
  border-radius: 999px;
  color: #2563eb;
  font-size: 12px;
}

.draft-outline-chevron {
  color: #64748b;
  text-align: right;
}

.draft-outline-item > p,
.draft-outline-child p {
  color: #475569;
  font-size: 13px;
  line-height: 1.75;
}

.draft-outline-child {
  margin-top: 8px;
  margin-left: 38px;
  padding: 10px 12px;
  border-left: 2px solid rgba(37, 99, 235, 0.22);
  background: rgba(248, 250, 252, 0.78);
  border-radius: 6px;
}

.draft-outline-child-title {
  color: #334155;
  font-size: 13px;
  font-weight: 800;
}

.draft-outline-footer {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.draft-meta-row {
  display: grid;
  grid-template-columns: 82px 1fr;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.draft-meta-row:last-child {
  border-bottom: 0;
}

.draft-meta-row span {
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}

.draft-meta-row strong,
.draft-meta-row p {
  margin: 0;
  color: #0f172a;
  font-size: 14px;
  line-height: 1.7;
}

.draft-outline-section-title {
  margin-top: 14px;
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

.draft-analysis-brief {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.draft-three-edit {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.draft-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.draft-import-success {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid #bbf7d0;
  background: #ecfdf5;
  border-radius: 8px;
  padding: 12px;
  color: #047857;
  font-size: 12px;
}

.draft-import-success strong {
  color: #065f46;
  font-size: 13px;
}

.draft-disabled-btn {
  opacity: 0.58;
}

.draft-tip-box {
  background: #eff6ff;
  border-color: rgba(37, 99, 235, 0.18);
}

.draft-tip-box p {
  color: #334155;
  font-size: 12px;
  line-height: 1.7;
}

.draft-outline-edit textarea {
  min-height: 68px;
  resize: vertical;
}

.draft-outline-edit .draft-outline-text {
  min-height: 240px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  line-height: 1.65;
}

.draft-empty {
  border: 1px dashed rgba(148, 163, 184, 0.35);
  border-radius: 8px;
  padding: 12px;
  color: #64748b;
  font-size: 13px;
  text-align: center;
}

.draft-empty.large {
  padding: 72px 18px;
}

@media (max-width: 1200px) {
  .draft-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .draft-assistant-main {
    padding: 12px;
  }

  .draft-toolbar,
  .draft-login-gate {
    align-items: stretch;
    flex-direction: column;
  }

  .draft-two,
  .draft-block-list {
    grid-template-columns: 1fr;
  }
}
</style>
