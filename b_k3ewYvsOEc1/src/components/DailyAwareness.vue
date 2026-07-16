<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  downloadDailyAwarenessByDate,
  getCurrentDailyAwareness,
  getDailyAwarenessByDate,
  getDailyAwarenessHistory,
  importDailyEventToDraft,
} from '../lib/api.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['back', 'open-draft-event'])

const MESSAGE_MAP = {
  TODAY_READY: { tone: 'success', text: '今日简报已就绪。' },
  TODAY_NO_DATA: { tone: 'neutral', text: '今日暂无可用数据，当前展示最近一期简报。' },
  TODAY_GENERATING: { tone: 'progress', text: '今日数据已到达，简报正在后台生成，当前展示最近一期简报。' },
  TODAY_GENERATION_FAILED: { tone: 'warning', text: '今日简报生成未成功，当前展示最近一期简报。' },
  TODAY_WAITING: { tone: 'neutral', text: '今日数据尚未完成，当前展示最近一期简报。' },
  NO_SUCCESSFUL_BRIEF: { tone: 'neutral', text: '暂无可展示的历史简报。' },
}

const loading = ref(false)
const historyLoading = ref(false)
const openingDate = ref('')
const importingItemId = ref('')
const exportingWord = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const currentState = ref(null)
const activeBrief = ref(null)
const historyItems = ref([])
const showHistoryDrawer = ref(false)
const selectedCategory = ref('')
const expandedEventIds = ref(new Set())
const importedEventIds = ref(new Set())
const viewMode = ref('current')

const userPermissions = computed(() => Array.isArray(props.currentUser?.permissions) ? props.currentUser.permissions : [])
const canView = computed(() => userPermissions.value.includes('daily-awareness:view'))
const canImportToDraft = computed(() => canView.value && userPermissions.value.includes('draft_assistant:create'))
const isHistoryMode = computed(() => viewMode.value === 'history')
const businessDate = computed(() => currentState.value?.businessDate || '--')
const displayedDate = computed(() => activeBrief.value?.businessDate || '--')
const events = computed(() => Array.isArray(activeBrief.value?.events) ? activeBrief.value.events : [])
const qualityStatus = computed(() => activeBrief.value?.qualityStatus || currentState.value?.qualityStatus || '')
const banner = computed(() => MESSAGE_MAP[currentState.value?.messageCode] || MESSAGE_MAP.TODAY_WAITING)
const title = computed(() => activeBrief.value?.title || '每日动态简报')
const contentMarkdown = computed(() => activeBrief.value?.contentMarkdown || '')
const categoryDistribution = computed(() => {
  const distribution = activeBrief.value?.categoryDistribution
  if (distribution && typeof distribution === 'object' && !Array.isArray(distribution)) {
    return Object.entries(distribution).map(([category, count]) => ({ category, count: Number(count || 0) }))
  }
  const counts = new Map()
  for (const event of events.value) {
    const category = event.category || '其他'
    counts.set(category, (counts.get(category) || 0) + 1)
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count }))
})
const visibleEvents = computed(() => {
  const filtered = selectedCategory.value
    ? events.value.filter((event) => (event.category || '其他') === selectedCategory.value)
    : events.value
  return [...filtered].sort((left, right) => Number(left.rankNo || 0) - Number(right.rankNo || 0))
})
const reportStats = computed(() => [
  { label: '入选新闻', value: events.value.length },
  { label: '分类数量', value: categoryDistribution.value.length },
  { label: '简报版本', value: qualityLabel(qualityStatus.value) },
  { label: '生成时间', value: formatTime(activeBrief.value?.generatedAt) },
])

async function loadWorkspace() {
  if (!canView.value) {
    currentState.value = null
    activeBrief.value = null
    historyItems.value = []
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const [current, history] = await Promise.all([
      getCurrentDailyAwareness(),
      getDailyAwarenessHistory({ page: 1, pageSize: 30 }),
    ])
    currentState.value = current || null
    activeBrief.value = current?.displayedBrief || null
    historyItems.value = Array.isArray(history?.items) ? history.items : []
    viewMode.value = 'current'
    selectedCategory.value = ''
    expandedEventIds.value = new Set()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

async function refreshHistory() {
  if (!canView.value) return
  historyLoading.value = true
  try {
    const history = await getDailyAwarenessHistory({ page: 1, pageSize: 30 })
    historyItems.value = Array.isArray(history?.items) ? history.items : []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    historyLoading.value = false
  }
}

async function openHistoryDrawer() {
  showHistoryDrawer.value = true
  await refreshHistory()
}

function closeHistoryDrawer() {
  showHistoryDrawer.value = false
}

async function openHistoryBrief(date) {
  if (!date || openingDate.value) return
  openingDate.value = date
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    activeBrief.value = await getDailyAwarenessByDate(date)
    viewMode.value = 'history'
    selectedCategory.value = ''
    expandedEventIds.value = new Set()
    closeHistoryDrawer()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    openingDate.value = ''
  }
}

function returnToCurrent() {
  activeBrief.value = currentState.value?.displayedBrief || null
  viewMode.value = 'current'
  selectedCategory.value = ''
  expandedEventIds.value = new Set()
}

function toggleEventDetails(itemId) {
  const next = new Set(expandedEventIds.value)
  if (next.has(itemId)) next.delete(itemId)
  else next.add(itemId)
  expandedEventIds.value = next
}

function isEventExpanded(itemId) {
  return expandedEventIds.value.has(itemId)
}

function isEventImported(itemId) {
  return importedEventIds.value.has(itemId)
}

async function importToDraft(event) {
  if (!event?.itemId || !canImportToDraft.value) return
  importingItemId.value = event.itemId
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const result = await importDailyEventToDraft(event.itemId)
    importedEventIds.value = new Set([...importedEventIds.value, event.itemId])
    noticeMessage.value = '已导入拟稿助手。'
    if (result?.eventId) emit('open-draft-event', { eventId: result.eventId })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    importingItemId.value = ''
  }
}

async function copyReport() {
  if (!contentMarkdown.value) return
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await navigator.clipboard.writeText(contentMarkdown.value)
    noticeMessage.value = '简报内容已复制。'
  } catch {
    errorMessage.value = '复制失败，请检查浏览器剪贴板权限。'
  }
}

async function exportWord() {
  if (!activeBrief.value?.businessDate || exportingWord.value) return
  exportingWord.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const result = await downloadDailyAwarenessByDate(activeBrief.value.businessDate, 'docx')
    const filename = result.filename || `${activeBrief.value.businessDate}-每日动态简报.docx`
    const url = URL.createObjectURL(result.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    noticeMessage.value = 'Word 文件已开始下载。'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    exportingWord.value = false
  }
}

function qualityLabel(status) {
  if (status === 'TITLE_ONLY') return '简要版'
  if (status === 'PARTIAL_SUMMARY') return '部分摘要版'
  if (status === 'NORMAL') return '标准版'
  return '--'
}

function qualityClass(status) {
  if (status === 'TITLE_ONLY') return 'brief-quality compact'
  if (status === 'PARTIAL_SUMMARY') return 'brief-quality partial'
  return 'brief-quality normal'
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function eventTitle(event) {
  return event?.eventTitle || event?.title || '未命名新闻'
}

function eventSummary(event) {
  return event?.basicSituation || event?.backgroundContext || event?.importanceJudgement || '暂无摘要。'
}

function sourceList(event) {
  return Array.isArray(event?.sourceInfo) ? event.sourceInfo : []
}

function sourceLabel(source) {
  return source?.publisher || source?.title || source?.url || '来源未知'
}

function handleKeydown(event) {
  if (event.key === 'Escape' && showHistoryDrawer.value) closeHistoryDrawer()
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  void loadWorkspace()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})

watch(() => props.currentUser?.id, () => {
  showHistoryDrawer.value = false
  noticeMessage.value = ''
  void loadWorkspace()
})
</script>

<template>
  <main class="daily-awareness-page">
    <header class="daily-header">
      <button type="button" class="icon-button back-button" title="返回" aria-label="返回" @click="emit('back')">‹</button>
      <div class="daily-title-block">
        <span class="eyebrow">DAILY AWARENESS</span>
        <h1>每日动态感知</h1>
        <p>面向全局共享的每日重点动态简报。</p>
      </div>
      <button type="button" class="history-button" @click="openHistoryDrawer">
        历史简报 <span>{{ historyItems.length }}</span>
      </button>
    </header>

    <section class="date-strip" aria-label="简报日期信息">
      <div>
        <span>今日业务日期</span>
        <strong>{{ businessDate }}</strong>
      </div>
      <div>
        <span>当前展示</span>
        <strong>{{ displayedDate }}</strong>
      </div>
      <div class="date-strip-actions">
        <span :class="qualityClass(qualityStatus)">{{ qualityLabel(qualityStatus) }}</span>
        <button v-if="isHistoryMode" type="button" class="text-button" @click="returnToCurrent">返回今日视图</button>
      </div>
    </section>

    <section v-if="!isHistoryMode && currentState" :class="['status-banner', banner.tone]">
      <span class="status-dot" aria-hidden="true"></span>
      <p>{{ banner.text }}</p>
    </section>

    <div v-if="errorMessage" class="feedback error">{{ errorMessage }}</div>
    <div v-if="noticeMessage" class="feedback success">{{ noticeMessage }}</div>

    <section v-if="loading" class="empty-state">
      <strong>正在读取每日简报</strong>
      <p>请稍候。</p>
    </section>

    <template v-else-if="activeBrief">
      <section class="overview-grid">
        <div v-for="item in reportStats" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </section>

      <section class="brief-heading">
        <div>
          <span class="section-label">DAILY BRIEF</span>
          <h2>{{ title }}</h2>
          <p>{{ displayedDate }} · {{ activeBrief.generatedByType === 'MANUAL' ? '人工补生成' : '系统生成' }}</p>
        </div>
        <div class="brief-actions">
          <button type="button" class="secondary-button" :disabled="!contentMarkdown" @click="copyReport">复制</button>
          <button type="button" class="primary-button" :disabled="exportingWord" @click="exportWord">
            {{ exportingWord ? '导出中...' : '导出 Word' }}
          </button>
        </div>
      </section>

      <section class="report-document" aria-label="简报正文">
        <pre>{{ contentMarkdown || '暂无简报正文。' }}</pre>
      </section>

      <nav v-if="categoryDistribution.length" class="category-tabs" aria-label="新闻分类筛选">
        <button type="button" :class="{ active: !selectedCategory }" @click="selectedCategory = ''">全部</button>
        <button
          v-for="item in categoryDistribution"
          :key="item.category"
          type="button"
          :class="{ active: selectedCategory === item.category }"
          @click="selectedCategory = item.category"
        >
          {{ item.category }} <span>{{ item.count }}</span>
        </button>
      </nav>

      <section class="news-section">
        <header>
          <div>
            <span class="section-label">SELECTED NEWS</span>
            <h2>入选新闻</h2>
          </div>
          <strong>{{ visibleEvents.length }} 条</strong>
        </header>

        <div v-if="!visibleEvents.length" class="empty-inline">当前分类暂无新闻。</div>
        <article v-for="event in visibleEvents" :key="event.itemId" class="news-card">
          <div class="news-rank">{{ String(event.rankNo || 0).padStart(2, '0') }}</div>
          <div class="news-content">
            <div class="news-title-row">
              <div>
                <span class="news-category">{{ event.category || '其他' }}</span>
                <h3>{{ eventTitle(event) }}</h3>
              </div>
              <button
                type="button"
                class="icon-button expand-button"
                :title="isEventExpanded(event.itemId) ? '收起详情' : '展开详情'"
                :aria-label="isEventExpanded(event.itemId) ? '收起详情' : '展开详情'"
                @click="toggleEventDetails(event.itemId)"
              >
                {{ isEventExpanded(event.itemId) ? '−' : '+' }}
              </button>
            </div>
            <p class="news-summary">{{ eventSummary(event) }}</p>
            <div class="news-meta">
              <span>重要性 {{ Number(event.importanceScore || 0).toFixed(0) }}</span>
              <span>风险 {{ Number(event.riskScore || 0).toFixed(0) }}</span>
              <span>{{ sourceList(event).length }} 个来源</span>
            </div>

            <div v-if="isEventExpanded(event.itemId)" class="event-details">
              <div v-if="event.backgroundContext"><strong>背景</strong><p>{{ event.backgroundContext }}</p></div>
              <div v-if="event.importanceJudgement"><strong>重要性研判</strong><p>{{ event.importanceJudgement }}</p></div>
              <div v-if="event.riskToUs"><strong>对我风险</strong><p>{{ event.riskToUs }}</p></div>
              <div v-if="sourceList(event).length" class="source-list">
                <strong>来源</strong>
                <a
                  v-for="(source, index) in sourceList(event)"
                  :key="`${event.itemId}-source-${index}`"
                  :href="source.url || undefined"
                  :target="source.url ? '_blank' : undefined"
                  rel="noreferrer"
                >
                  {{ sourceLabel(source) }}
                </a>
              </div>
            </div>

            <div v-if="canImportToDraft" class="news-actions">
              <button
                type="button"
                class="secondary-button"
                :disabled="importingItemId === event.itemId || isEventImported(event.itemId)"
                @click="importToDraft(event)"
              >
                {{ isEventImported(event.itemId) ? '已导入' : importingItemId === event.itemId ? '导入中...' : '导入拟稿助手' }}
              </button>
            </div>
          </div>
        </article>
      </section>
    </template>

    <section v-else class="empty-state">
      <strong>暂无可展示简报</strong>
      <p>{{ canView ? '可稍后刷新查看。' : '当前账号没有查看权限。' }}</p>
    </section>

    <div v-if="showHistoryDrawer" class="history-overlay" role="presentation" @click.self="closeHistoryDrawer">
      <aside class="history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <header>
          <div>
            <span class="section-label">ARCHIVE</span>
            <h2 id="history-title">历史简报</h2>
          </div>
          <button type="button" class="icon-button" title="关闭" aria-label="关闭" @click="closeHistoryDrawer">×</button>
        </header>
        <div class="history-list">
          <p v-if="historyLoading" class="history-empty">正在读取...</p>
          <p v-else-if="!historyItems.length" class="history-empty">暂无历史简报。</p>
          <button
            v-for="item in historyItems"
            :key="item.briefId"
            type="button"
            class="history-item"
            :class="{ active: item.businessDate === displayedDate }"
            :disabled="Boolean(openingDate)"
            @click="openHistoryBrief(item.businessDate)"
          >
            <span>{{ item.businessDate }}</span>
            <strong>{{ item.title || `${item.businessDate} 每日动态简报` }}</strong>
            <small>{{ qualityLabel(item.qualityStatus) }} · {{ formatTime(item.generatedAt) }}</small>
          </button>
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.daily-awareness-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 28px clamp(20px, 4vw, 64px) 72px;
  color: #172133;
  background: #f4f6f8;
  box-sizing: border-box;
}

.daily-header {
  max-width: 1320px;
  margin: 0 auto;
  min-height: 72px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
}

.daily-title-block h1,
.brief-heading h2,
.news-section h2,
.history-drawer h2 {
  margin: 0;
  letter-spacing: 0;
}

.daily-title-block h1 {
  margin-top: 3px;
  font-size: 28px;
  line-height: 1.25;
}

.daily-title-block p,
.brief-heading p {
  margin: 6px 0 0;
  color: #667085;
  font-size: 14px;
}

.eyebrow,
.section-label {
  color: #28724f;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}

button {
  font: inherit;
}

.icon-button {
  width: 38px;
  height: 38px;
  border: 1px solid #d8dee7;
  border-radius: 6px;
  display: inline-grid;
  place-items: center;
  color: #344054;
  background: #fff;
  cursor: pointer;
}

.back-button {
  font-size: 28px;
  line-height: 1;
}

.history-button,
.primary-button,
.secondary-button,
.text-button {
  min-height: 38px;
  border-radius: 6px;
  padding: 0 14px;
  border: 1px solid #cfd6df;
  cursor: pointer;
  font-weight: 700;
}

.history-button,
.secondary-button,
.text-button {
  color: #344054;
  background: #fff;
}

.history-button span {
  margin-left: 8px;
  color: #28724f;
}

.primary-button {
  border-color: #1f6b48;
  color: #fff;
  background: #1f6b48;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.date-strip,
.status-banner,
.feedback,
.overview-grid,
.brief-heading,
.report-document,
.category-tabs,
.news-section,
.empty-state {
  max-width: 1320px;
  margin-left: auto;
  margin-right: auto;
}

.date-strip {
  margin-top: 24px;
  min-height: 68px;
  display: grid;
  grid-template-columns: minmax(170px, 1fr) minmax(170px, 1fr) auto;
  gap: 24px;
  align-items: center;
  padding: 12px 18px;
  border-top: 1px solid #d8dee7;
  border-bottom: 1px solid #d8dee7;
  background: #fff;
  box-sizing: border-box;
}

.date-strip > div:not(.date-strip-actions) {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.date-strip span,
.overview-grid span {
  color: #667085;
  font-size: 12px;
}

.date-strip strong {
  font-size: 17px;
}

.date-strip-actions,
.brief-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.brief-quality {
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
}

.brief-quality.normal { color: #166534; background: #dcfce7; }
.brief-quality.partial { color: #92400e; background: #fef3c7; }
.brief-quality.compact { color: #9a3412; background: #ffedd5; }

.status-banner {
  margin-top: 16px;
  min-height: 44px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #fff;
  box-sizing: border-box;
}

.status-banner p { margin: 0; font-size: 14px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #667085; flex: 0 0 auto; }
.status-banner.success .status-dot { background: #16835d; }
.status-banner.progress .status-dot { background: #2563eb; }
.status-banner.warning .status-dot { background: #d97706; }

.feedback {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
}

.feedback.error { color: #991b1b; background: #fee2e2; }
.feedback.success { color: #166534; background: #dcfce7; }

.overview-grid {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid #d8dee7;
  background: #fff;
}

.overview-grid > div {
  min-height: 76px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 7px;
  border-right: 1px solid #e4e8ee;
  box-sizing: border-box;
}

.overview-grid > div:last-child { border-right: 0; }
.overview-grid strong { font-size: 17px; overflow-wrap: anywhere; }

.brief-heading {
  margin-top: 30px;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
}

.brief-heading h2 { margin-top: 5px; font-size: 24px; }

.report-document {
  margin-top: 14px;
  padding: clamp(22px, 4vw, 48px);
  border: 1px solid #d8dee7;
  background: #fff;
  box-sizing: border-box;
}

.report-document pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  font-size: 15px;
  line-height: 1.9;
  color: #27364a;
}

.category-tabs {
  margin-top: 18px;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.category-tabs button {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid #d4dae3;
  border-radius: 5px;
  color: #475467;
  background: #fff;
  cursor: pointer;
}

.category-tabs button.active {
  border-color: #1f6b48;
  color: #fff;
  background: #1f6b48;
}

.category-tabs span { margin-left: 5px; opacity: 0.76; }

.news-section { margin-top: 28px; }
.news-section > header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; }
.news-section h2 { margin-top: 4px; font-size: 21px; }
.news-section > header > strong { color: #667085; font-size: 14px; }

.news-card {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 16px;
  margin-top: 8px;
  padding: 18px;
  border: 1px solid #dbe1e8;
  border-radius: 7px;
  background: #fff;
}

.news-rank {
  width: 42px;
  height: 32px;
  display: grid;
  place-items: center;
  color: #1f6b48;
  background: #e4f2eb;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 800;
}

.news-title-row { display: flex; justify-content: space-between; gap: 18px; }
.news-title-row h3 { margin: 5px 0 0; font-size: 17px; line-height: 1.45; letter-spacing: 0; overflow-wrap: anywhere; }
.news-category { color: #28724f; font-size: 12px; font-weight: 800; }
.expand-button { flex: 0 0 auto; width: 32px; height: 32px; font-size: 20px; }
.news-summary { margin: 12px 0 0; color: #475467; line-height: 1.75; font-size: 14px; }
.news-meta { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px 16px; color: #667085; font-size: 12px; }

.event-details {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #e4e7ec;
  display: grid;
  gap: 12px;
}

.event-details strong { font-size: 13px; }
.event-details p { margin: 4px 0 0; color: #475467; line-height: 1.7; font-size: 14px; }
.source-list { display: flex; flex-wrap: wrap; gap: 8px 14px; }
.source-list strong { width: 100%; }
.source-list a { color: #175cd3; font-size: 13px; text-decoration: none; overflow-wrap: anywhere; }
.news-actions { margin-top: 14px; }

.empty-state,
.empty-inline {
  color: #667085;
  text-align: center;
}

.empty-state { margin-top: 24px; padding: 72px 24px; border: 1px dashed #cbd3dd; background: #fff; }
.empty-state strong { color: #344054; font-size: 17px; }
.empty-state p { margin: 8px 0 0; }
.empty-inline { padding: 28px; background: #fff; border: 1px solid #dbe1e8; }

.history-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  justify-content: flex-end;
  background: rgba(16, 24, 40, 0.36);
}

.history-drawer {
  width: min(440px, 94vw);
  height: 100%;
  padding: 24px;
  background: #f8fafb;
  box-sizing: border-box;
  overflow-y: auto;
}

.history-drawer > header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.history-drawer h2 { margin-top: 4px; font-size: 22px; }
.history-list { display: grid; gap: 8px; }

.history-item {
  width: 100%;
  min-height: 104px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  text-align: left;
  border: 1px solid #dbe1e8;
  border-radius: 6px;
  color: #344054;
  background: #fff;
  cursor: pointer;
}

.history-item.active { border-color: #1f6b48; box-shadow: inset 3px 0 #1f6b48; }
.history-item span { color: #28724f; font-size: 12px; font-weight: 800; }
.history-item strong { line-height: 1.4; overflow-wrap: anywhere; }
.history-item small { color: #667085; }
.history-empty { color: #667085; text-align: center; padding: 40px 0; }

@media (max-width: 760px) {
  .daily-awareness-page { padding: 18px 14px 48px; }
  .daily-header { grid-template-columns: 40px minmax(0, 1fr); gap: 12px; }
  .history-button { grid-column: 2; justify-self: start; }
  .daily-title-block h1 { font-size: 23px; }
  .date-strip { grid-template-columns: 1fr 1fr; gap: 14px; }
  .date-strip-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .overview-grid { grid-template-columns: 1fr 1fr; }
  .overview-grid > div:nth-child(2) { border-right: 0; }
  .overview-grid > div:nth-child(-n + 2) { border-bottom: 1px solid #e4e8ee; }
  .brief-heading { align-items: flex-start; flex-direction: column; }
  .brief-actions { width: 100%; justify-content: flex-start; }
  .news-card { grid-template-columns: 1fr; }
  .news-rank { width: 38px; }
  .report-document { padding: 22px 18px; }
}
</style>
