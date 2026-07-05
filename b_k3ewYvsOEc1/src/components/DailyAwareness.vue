<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  generateDailyBrief,
  getDailyBrief,
  getDailyBriefs,
  importDailyEventToDraft,
} from '../lib/api.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['back', 'open-draft-event'])

const categoryOptions = [
  '欧洲政治',
  '欧洲经济',
  '美国政治',
  '美国经济',
  '国际安全',
  '俄乌局势',
  '中东局势',
  '亚太安全',
  '国际组织',
  '科技产业',
  '能源资源',
  '金融市场',
  '社会舆情',
  '其他',
]

const today = new Date().toISOString().slice(0, 10)
const filters = reactive({
  date: today,
  maxItems: 50,
  categories: ['欧洲政治', '欧洲经济', '国际安全', '科技产业'],
  region: '',
  keyword: '',
  lookbackHours: 24,
})
const loading = ref(false)
const historyLoading = ref(false)
const openingBriefId = ref('')
const importingItemId = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')
const diagnostics = ref(null)
const selectedCategory = ref('')
const activeBrief = ref(null)
const events = ref([])
const historyItems = ref([])
const showHistoryDrawer = ref(false)
const settingsCollapsed = ref(false)
const summaryExpanded = ref(false)
const viewMode = ref('compact')
const sortMode = ref('rank')
const highRiskOnly = ref(false)
const importFilter = ref('all')
const expandedEventIds = ref(new Set())
const importedEventIds = ref(new Set())

const RECOVERY_POLL_ATTEMPTS = 6
const RECOVERY_POLL_INTERVAL_MS = 1500
const HIGH_RISK_SCORE = 80

const isLoggedIn = computed(() => Boolean(props.currentUser))
const canGenerate = computed(() => isLoggedIn.value && props.currentUser.role !== 'viewer')
const permissionHint = computed(() => {
  if (!isLoggedIn.value) return '请先登录后查看或生成每日简报。'
  if (props.currentUser?.role === 'viewer') return 'viewer 账号仅可查看简报，不能生成每日简报。'
  return ''
})
const categoryStats = computed(() => {
  const fromBrief = activeBrief.value?.categories
  if (Array.isArray(fromBrief) && fromBrief.length) return fromBrief
  const counts = new Map()
  for (const event of events.value) {
    const category = event.category || '其他'
    counts.set(category, (counts.get(category) || 0) + 1)
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count }))
})
const visibleEvents = computed(() => {
  let items = enrichedEvents.value
  if (selectedCategory.value) items = items.filter((event) => event.category === selectedCategory.value)
  if (highRiskOnly.value) items = items.filter((event) => Number(event.riskScore || 0) >= HIGH_RISK_SCORE)
  if (importFilter.value === 'imported') items = items.filter((event) => event.imported)
  if (importFilter.value === 'notImported') items = items.filter((event) => !event.imported)

  return [...items].sort((a, b) => {
    if (sortMode.value === 'importance') return Number(b.importanceScore || 0) - Number(a.importanceScore || 0)
    if (sortMode.value === 'risk') return Number(b.riskScore || 0) - Number(a.riskScore || 0)
    if (sortMode.value === 'time') return b.latestPublishedAtValue - a.latestPublishedAtValue
    return Number(a.rankNo || 0) - Number(b.rankNo || 0)
  })
})
const overview = computed(() => {
  const content = activeBrief.value?.contentJson || {}
  const generation = content.generation || {}
  return {
    date: activeBrief.value?.briefDate || filters.date,
    materials: activeBrief.value?.candidateMaterialCount || generation.candidateMaterialCount || generation.totalMaterials || 0,
    candidates: activeBrief.value?.candidateEventCount || generation.candidateEventCount || activeBrief.value?.totalCandidates || generation.totalCandidates || 0,
    selected: activeBrief.value?.selectedEventCount || activeBrief.value?.selectedCount || generation.selectedEventCount || events.value.length,
    categoryCount: categoryStats.value.length,
    createdAt: activeBrief.value?.createdAt || '',
    usedFallback: Boolean(activeBrief.value?.usedFallback || generation.usedFallback),
    fallbackReason: activeBrief.value?.fallbackReason || generation.fallbackReason || '',
    diagnostics: generation.diagnostics || null,
  }
})
const enrichedEvents = computed(() => events.value.map((event) => normalizeEventForDisplay(event)))
const summaryCards = computed(() => {
  const content = activeBrief.value?.contentJson || {}
  const summary = activeBrief.value?.summary || ''
  const highRiskEvent = enrichedEvents.value.find((event) => Number(event.riskScore || 0) >= HIGH_RISK_SCORE) || enrichedEvents.value[0]
  return {
    overall: content.overallJudgement || splitSummary(summary)[0] || summary || '暂无总体判断。',
    themes: normalizeThemeList(content.keyThemes || content.themes).length
      ? normalizeThemeList(content.keyThemes || content.themes)
      : categoryStats.value.slice(0, 4).map((item) => item.category),
    risk: content.riskSummary || highRiskEvent?.riskToUs || highRiskEvent?.compactSummary || '暂无明确风险提示。',
    rawSummary: summary,
    shouldCollapse: String(summary || '').length > 180,
  }
})
const displayedSummaryText = computed(() => {
  const text = summaryCards.value.rawSummary || ''
  if (summaryExpanded.value || text.length <= 180) return text
  return `${text.slice(0, 180)}...`
})
const emptyState = computed(() => {
  if (errorMessage.value) {
    return {
      title: '生成失败',
      message: `原因：${errorMessage.value}`,
      suggestion: '建议：扩大回溯小时、检查信源库、减少筛选条件。',
    }
  }
  if (!isLoggedIn.value) {
    return {
      title: '请先登录',
      message: '登录后可查看和生成每日动态感知内容。',
      suggestion: '',
    }
  }
  if (events.value.length && !visibleEvents.value.length) {
    return {
      title: '当前筛选下暂无事件',
      message: '可切换分类、关闭高风险筛选，或调整导入状态筛选。',
      suggestion: '',
    }
  }
  return {
    title: '未生成每日简报',
    message: '请选择日期并点击“生成每日简报”。',
    suggestion: '',
  }
})

function toggleCategory(category) {
  if (filters.categories.includes(category)) {
    filters.categories = filters.categories.filter((item) => item !== category)
  } else {
    filters.categories = [...filters.categories, category]
  }
}

function toggleSettings() {
  settingsCollapsed.value = !settingsCollapsed.value
}

function toggleEventDetails(eventId) {
  const next = new Set(expandedEventIds.value)
  if (next.has(eventId)) next.delete(eventId)
  else next.add(eventId)
  expandedEventIds.value = next
}

function isEventExpanded(eventId) {
  return expandedEventIds.value.has(eventId)
}

function isEventImported(eventId) {
  return importedEventIds.value.has(eventId)
}

function markEventImported(eventId) {
  const next = new Set(importedEventIds.value)
  next.add(eventId)
  importedEventIds.value = next
}

async function loadHistory() {
  if (!isLoggedIn.value) {
    historyItems.value = []
    activeBrief.value = null
    events.value = []
    return
  }
  historyLoading.value = true
  try {
    const result = await getDailyBriefs({ page: 1, pageSize: 20 })
    historyItems.value = Array.isArray(result?.items) ? result.items : []
    if (!activeBrief.value && historyItems.value[0]?.briefId) {
      await openBrief(historyItems.value[0].briefId)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    historyLoading.value = false
  }
}

async function openHistoryDrawer() {
  showHistoryDrawer.value = true
  await loadHistory()
}

function closeHistoryDrawer() {
  showHistoryDrawer.value = false
}

async function generateBrief() {
  if (!canGenerate.value || loading.value) return
  loading.value = true
  const requestStartedAt = Date.now()
  errorMessage.value = ''
  noticeMessage.value = ''
  diagnostics.value = null
  selectedCategory.value = ''
  try {
    const result = await generateDailyBrief({
      date: filters.date,
      maxItems: Number(filters.maxItems) || 50,
      categories: filters.categories,
      region: filters.region,
      keyword: filters.keyword,
      lookbackHours: Number(filters.lookbackHours) || 24,
    })
    activeBrief.value = result?.brief || null
    setEvents(Array.isArray(result?.events) ? result.events : [])
    noticeMessage.value = result?.brief?.usedFallback
      ? '当前日期无可用材料，已使用最近可用信源生成。'
      : '每日动态简报已生成。'
    await loadHistory()
  } catch (error) {
    const recovered = await recoverGeneratedBrief(requestStartedAt)
    if (recovered) {
      noticeMessage.value = '每日动态简报已生成，但网络响应超时；已自动读取最新结果。'
      return
    }
    errorMessage.value = formatGenerateError(error)
    diagnostics.value = error?.data?.diagnostics || null
  } finally {
    loading.value = false
  }
}

async function recoverGeneratedBrief(requestStartedAt) {
  for (let attempt = 0; attempt < RECOVERY_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(RECOVERY_POLL_INTERVAL_MS)
    try {
      const result = await getDailyBriefs({ page: 1, pageSize: 5, date: filters.date })
      const items = Array.isArray(result?.items) ? result.items : []
      const brief = items.find((item) => isBriefCreatedAfterRequest(item, requestStartedAt))
      if (!brief?.briefId) continue
      await openGeneratedBrief(brief.briefId)
      await loadHistory()
      return true
    } catch {
      // Keep polling briefly; the generate request may have completed while the proxy response failed.
    }
  }
  return false
}

async function openGeneratedBrief(briefId) {
  const result = await getDailyBrief(briefId)
  activeBrief.value = result?.brief || null
  setEvents(Array.isArray(result?.events?.items) ? result.events.items : Array.isArray(result?.events) ? result.events : [])
}

function isBriefCreatedAfterRequest(brief, requestStartedAt) {
  const createdAt = new Date(brief?.createdAt || '').getTime()
  if (!Number.isFinite(createdAt)) return false
  return createdAt >= requestStartedAt - 30_000
}

function formatGenerateError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/Unexpected token ['"]?</i.test(message) || /not valid JSON/i.test(message)) {
    return '生成请求返回了非 JSON 内容，可能是代理超时。请稍后查看历史简报，或减少最大条数后重试。'
  }
  return message
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function openBrief(briefId) {
  if (!briefId || openingBriefId.value) return
  openingBriefId.value = briefId
  errorMessage.value = ''
  noticeMessage.value = ''
  diagnostics.value = null
  selectedCategory.value = ''
  try {
    const result = await getDailyBrief(briefId)
    activeBrief.value = result?.brief || null
    setEvents(Array.isArray(result?.events?.items) ? result.events.items : Array.isArray(result?.events) ? result.events : [])
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    openingBriefId.value = ''
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape' && showHistoryDrawer.value) closeHistoryDrawer()
}

async function importToDraft(event) {
  if (!event?.itemId || props.currentUser?.role === 'viewer') return
  importingItemId.value = event.itemId
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const result = await importDailyEventToDraft(event.itemId)
    markEventImported(event.itemId)
    noticeMessage.value = '已导入拟稿助手。'
    if (result?.eventId) emit('open-draft-event', { eventId: result.eventId })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    importingItemId.value = ''
  }
}

function setEvents(nextEvents) {
  events.value = nextEvents
  expandedEventIds.value = new Set()
}

function normalizeEventForDisplay(event) {
  const sources = Array.isArray(event.sourceInfo) ? event.sourceInfo : []
  const sourceTitle = sources.find((source) => source?.title)?.title || ''
  const candidateTitle = firstText([
    event.displayTitle,
    event.titleZh,
    event.summaryTitle,
    event.eventTitle,
    event.title,
  ])
  const originalTitle = firstText([event.originalTitle, event.sourceTitle, sourceTitle])
  const displayTitle = candidateTitle || originalTitle || '未命名事件'
  const latestPublishedAtValue = Math.max(0, ...sources.map((source) => new Date(source?.publishedAt || '').getTime()).filter(Number.isFinite))
  return {
    ...event,
    displayTitle,
    originalTitle: originalTitle && originalTitle !== displayTitle ? originalTitle : '',
    sourceCount: sources.length,
    imported: isEventImported(event.itemId),
    compactSummary: firstText([event.basicSituation, event.backgroundContext, event.importanceJudgement]).slice(0, 120),
    latestPublishedAtValue,
  }
}

function firstText(values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || ''
}

function splitSummary(summary) {
  return String(summary || '')
    .split(/(?<=[。！？；])\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeThemeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
  if (typeof value === 'string') return value.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 6)
  return []
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function historyCategoryCount(brief) {
  const categories = Array.isArray(brief?.categories) ? brief.categories : []
  if (categories.length) return categories.length
  const stats = brief?.contentJson?.categoryStats
  return Array.isArray(stats) ? stats.length : 0
}

function historyMaterialCount(brief) {
  return brief?.candidateMaterialCount || brief?.contentJson?.generation?.candidateMaterialCount || brief?.contentJson?.generation?.totalMaterials || 0
}

function historyUsesFallback(brief) {
  return Boolean(brief?.usedFallback || brief?.contentJson?.generation?.usedFallback)
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  void loadHistory()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})

watch(() => props.currentUser?.id, () => {
  errorMessage.value = ''
  noticeMessage.value = ''
  showHistoryDrawer.value = false
  void loadHistory()
})
</script>

<template>
  <main class="daily-awareness-page">
    <header class="daily-awareness-header">
      <button type="button" class="daily-back-btn" @click="emit('back')">‹</button>
      <div>
        <div class="daily-eyebrow">DAILY AWARENESS</div>
        <h1>每日动态感知</h1>
        <p>基于现有信源库自动筛选每日重点事件，生成动态简报。</p>
      </div>
      <button type="button" class="daily-history-trigger" @click="openHistoryDrawer">
        历史简报
        <span>{{ historyItems.length }}</span>
      </button>
    </header>

    <section class="daily-layout">
      <aside class="daily-sidebar">
        <section class="daily-panel">
          <div class="daily-panel-head">
            <div class="daily-panel-title">生成设置</div>
            <button v-if="activeBrief" type="button" class="daily-panel-toggle" @click="toggleSettings">
              {{ settingsCollapsed ? '展开设置' : '收起设置' }}
            </button>
          </div>

          <div v-if="settingsCollapsed" class="daily-settings-compact">
            <p><span>当前日期</span><strong>{{ overview.date }}</strong></p>
            <p><span>入选事件</span><strong>{{ overview.selected }}</strong></p>
            <button class="daily-primary-btn compact" type="button" :disabled="!canGenerate || loading" @click="generateBrief">
              {{ loading ? '生成中...' : '重新生成' }}
            </button>
          </div>

          <template v-else>
            <label>
              <span>日期</span>
              <input v-model="filters.date" type="date" />
            </label>
            <label>
              <span>最大条数</span>
              <input v-model.number="filters.maxItems" type="number" min="1" max="50" />
            </label>
            <label>
              <span>回溯小时</span>
              <input v-model.number="filters.lookbackHours" type="number" min="1" max="168" />
            </label>
            <label>
              <span>地区</span>
              <input v-model="filters.region" placeholder="可选，例如：欧洲、美国" />
            </label>
            <label>
              <span>关键词</span>
              <input v-model="filters.keyword" placeholder="可选，按标题和正文过滤" />
            </label>
            <div class="daily-category-picker">
              <span>分类范围</span>
              <button
                v-for="category in categoryOptions"
                :key="category"
                type="button"
                :class="{ active: filters.categories.includes(category) }"
                @click="toggleCategory(category)"
              >
                {{ category }}
              </button>
            </div>
            <button class="daily-primary-btn" type="button" :disabled="!canGenerate || loading" @click="generateBrief">
              {{ loading ? '生成中...' : '生成每日简报' }}
            </button>
            <p v-if="permissionHint" class="daily-helper">{{ permissionHint }}</p>
          </template>
        </section>
      </aside>

      <section class="daily-main">
        <div v-if="errorMessage" class="daily-message error">{{ errorMessage }}</div>
        <div v-if="noticeMessage" class="daily-message success">{{ noticeMessage }}</div>
        <section v-if="diagnostics" class="daily-diagnostics">
          <div class="daily-card-kicker">查询诊断</div>
          <div class="daily-diagnostics-grid">
            <p><span>查询日期</span><strong>{{ diagnostics.targetDate || filters.date }}</strong></p>
            <p><span>回溯小时</span><strong>{{ diagnostics.lookbackHours || filters.lookbackHours }}</strong></p>
            <p><span>数据库表</span><strong>{{ diagnostics.sourceTable || '--' }}</strong></p>
            <p><span>指定窗口材料</span><strong>{{ diagnostics.exactMaterialCount ?? 0 }}</strong></p>
            <p><span>Fallback</span><strong>{{ diagnostics.usedFallback ? '已启用' : '未启用' }}</strong></p>
            <p><span>返回材料</span><strong>{{ diagnostics.returnedMaterialCount ?? 0 }}</strong></p>
          </div>
          <small>查询窗口：{{ diagnostics.queryStart || '--' }} 至 {{ diagnostics.queryEnd || '--' }}。建议扩大回溯范围或检查 PGVector 信源库入库时间。</small>
        </section>

        <section class="daily-overview">
          <article>
            <span>简报日期</span>
            <strong>{{ overview.date }}</strong>
          </article>
          <article>
            <span>候选材料</span>
            <strong>{{ overview.materials }}</strong>
          </article>
          <article>
            <span>聚合事件</span>
            <strong>{{ overview.candidates }}</strong>
          </article>
          <article>
            <span>入选事件</span>
            <strong>{{ overview.selected }}</strong>
          </article>
        </section>

        <section v-if="activeBrief" class="daily-summary-card">
          <div class="daily-summary-head">
            <div class="daily-card-kicker">简报摘要</div>
            <h2>{{ activeBrief.title }}</h2>
          </div>
          <small>生成时间：{{ formatTime(overview.createdAt) }}</small>
          <div class="daily-summary-grid">
            <article>
              <span>今日总体判断</span>
              <p>{{ summaryCards.overall }}</p>
            </article>
            <article>
              <span>重点方向</span>
              <div class="daily-theme-list">
                <b v-for="theme in summaryCards.themes" :key="theme">{{ theme }}</b>
                <b v-if="!summaryCards.themes.length">暂无分类</b>
              </div>
            </article>
            <article>
              <span>风险提示</span>
              <p>{{ summaryCards.risk }}</p>
            </article>
          </div>
          <div v-if="summaryCards.rawSummary" class="daily-summary-raw">
            <p>{{ displayedSummaryText }}</p>
            <button v-if="summaryCards.shouldCollapse" type="button" @click="summaryExpanded = !summaryExpanded">
              {{ summaryExpanded ? '收起摘要' : '展开完整摘要' }}
            </button>
          </div>
        </section>
        <div v-if="overview.usedFallback" class="daily-message warning">
          {{ overview.fallbackReason || '当前日期无可用材料，已使用最近可用信源生成。' }}
        </div>

        <section class="daily-workbench-toolbar">
          <div class="daily-view-toggle" aria-label="事件视图切换">
            <button type="button" :class="{ active: viewMode === 'compact' }" @click="viewMode = 'compact'">紧凑列表</button>
            <button type="button" :class="{ active: viewMode === 'detail' }" @click="viewMode = 'detail'">卡片详情</button>
          </div>
          <label>
            <span>排序</span>
            <select v-model="sortMode">
              <option value="rank">综合排序</option>
              <option value="importance">重要性优先</option>
              <option value="risk">涉我风险优先</option>
              <option value="time">发布时间优先</option>
            </select>
          </label>
          <label>
            <span>导入状态</span>
            <select v-model="importFilter">
              <option value="all">全部</option>
              <option value="imported">只看已导入</option>
              <option value="notImported">只看未导入</option>
            </select>
          </label>
          <label class="daily-risk-check">
            <input v-model="highRiskOnly" type="checkbox" />
            <span>只看高风险</span>
          </label>
        </section>

        <section class="daily-category-bar">
          <button type="button" :class="{ active: !selectedCategory }" @click="selectedCategory = ''">全部</button>
          <button
            v-for="item in categoryStats"
            :key="item.category"
            type="button"
            :class="{ active: selectedCategory === item.category }"
            @click="selectedCategory = item.category"
          >
            {{ item.category }} <span>{{ item.count }}</span>
          </button>
        </section>

        <section class="daily-event-list" :class="{ compact: viewMode === 'compact' }">
          <article
            v-for="event in visibleEvents"
            :key="event.itemId"
            class="daily-event-card"
            :class="{ compact: viewMode === 'compact' }"
          >
            <div class="daily-event-head">
              <span class="daily-rank">#{{ event.rankNo }}</span>
              <div>
                <h3>{{ event.displayTitle }}</h3>
                <small v-if="event.originalTitle" class="daily-original-title">原始标题：{{ event.originalTitle }}</small>
                <div class="daily-event-meta">
                  <span>分类：{{ event.category || '其他' }}</span>
                  <span>重要性 {{ Number(event.importanceScore || 0).toFixed(0) }}</span>
                  <span>涉我风险 {{ Number(event.riskScore || 0).toFixed(0) }}</span>
                  <span>来源 {{ event.sourceCount }}</span>
                </div>
              </div>
              <button
                type="button"
                class="daily-import-btn"
                :disabled="currentUser?.role === 'viewer' || importingItemId === event.itemId || event.imported"
                @click="importToDraft(event)"
              >
                {{ event.imported ? '已导入' : importingItemId === event.itemId ? '导入中...' : '导入拟稿助手' }}
              </button>
            </div>
            <p v-if="viewMode === 'compact'" class="daily-compact-summary">{{ event.compactSummary || '暂无事件摘要。' }}</p>
            <button
              v-if="viewMode === 'compact'"
              type="button"
              class="daily-expand-btn"
              @click="toggleEventDetails(event.itemId)"
            >
              {{ isEventExpanded(event.itemId) ? '收起详情' : '展开详情' }}
            </button>
            <div v-if="viewMode === 'detail' || isEventExpanded(event.itemId)" class="daily-event-grid">
              <section>
                <h4>事件基本情况</h4>
                <p>{{ event.basicSituation || '暂无。' }}</p>
              </section>
              <section>
                <h4>来龙去脉</h4>
                <p>{{ event.backgroundContext || '暂无。' }}</p>
              </section>
              <section>
                <h4>重要性判断</h4>
                <p>{{ event.importanceJudgement || '暂无。' }}</p>
              </section>
              <section>
                <h4>涉我风险</h4>
                <p>{{ event.riskToUs || '暂无。' }}</p>
              </section>
            </div>
            <div v-if="viewMode === 'detail' || isEventExpanded(event.itemId)" class="daily-sources">
              <strong>来源信息</strong>
              <ul>
                <li v-for="(source, index) in event.sourceInfo || []" :key="`${event.itemId}-${index}`">
                  <span>{{ source.publisher || '来源未知' }}</span>
                  <a v-if="source.url" :href="source.url" target="_blank" rel="noreferrer">{{ source.title || source.url }}</a>
                  <em v-else>{{ source.title || '未命名来源' }}</em>
                  <small>{{ source.publishedAt || '' }}</small>
                </li>
              </ul>
            </div>
          </article>

          <div v-if="!loading && !visibleEvents.length" class="daily-empty large">
            <strong>{{ emptyState.title }}</strong>
            <span>{{ emptyState.message }}</span>
            <small v-if="emptyState.suggestion">{{ emptyState.suggestion }}</small>
          </div>
        </section>
      </section>
    </section>

    <div
      v-if="showHistoryDrawer"
      class="daily-history-overlay"
      role="presentation"
      @click="closeHistoryDrawer"
    >
      <aside
        class="daily-history-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-history-drawer-title"
        @click.stop
      >
        <header class="daily-history-drawer-head">
          <div>
            <h2 id="daily-history-drawer-title">历史简报</h2>
            <p>查看已生成的每日动态简报</p>
          </div>
          <button type="button" class="daily-drawer-close" aria-label="关闭历史简报" @click="closeHistoryDrawer">×</button>
        </header>

        <div class="daily-history-drawer-body">
          <div v-if="historyLoading" class="daily-empty drawer-empty">正在读取历史简报...</div>
          <div v-else-if="!historyItems.length" class="daily-empty drawer-empty">
            <strong>暂无历史简报</strong>
            <span>生成每日动态简报后，将在这里显示记录。</span>
          </div>
          <button
            v-for="brief in historyItems"
            v-else
            :key="brief.briefId"
            type="button"
            class="daily-history-card"
            :class="{ active: activeBrief?.briefId === brief.briefId }"
            :disabled="openingBriefId === brief.briefId"
            @click="openBrief(brief.briefId)"
          >
            <div class="daily-history-card-top">
              <strong>{{ brief.title || `${brief.briefDate} 每日动态简报` }}</strong>
              <span v-if="historyUsesFallback(brief)" class="daily-fallback-chip">使用最近信源</span>
            </div>
            <small>{{ brief.selectedCount || 0 }} 条事件 · {{ formatTime(brief.createdAt) }}</small>
            <div class="daily-history-card-meta">
              <span>候选材料：{{ historyMaterialCount(brief) }} 条</span>
              <span>分类：{{ historyCategoryCount(brief) }} 类</span>
            </div>
            <em>{{ openingBriefId === brief.briefId ? '读取中...' : '查看' }}</em>
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
  height: calc(100vh - 76px);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 24px;
  background: #f3f6fb;
  color: #0f172a;
}

.daily-awareness-header {
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 1440px;
  margin: 0 auto 18px;
}

.daily-back-btn {
  width: 38px;
  height: 38px;
  border: 1px solid #dbe4f0;
  border-radius: 10px;
  background: #ffffff;
  color: #0f172a;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
}

.daily-eyebrow {
  color: #2563eb;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.daily-awareness-header h1 {
  margin: 2px 0 4px;
  font-size: 24px;
  letter-spacing: 0;
}

.daily-awareness-header p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.daily-history-trigger {
  margin-left: auto;
  min-height: 38px;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  background: #ffffff;
  color: #1d4ed8;
  padding: 0 13px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.daily-history-trigger span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  margin-left: 8px;
  border-radius: 999px;
  background: #eff6ff;
  color: #1e40af;
  font-size: 11px;
}

.daily-layout {
  display: grid;
  grid-template-columns: minmax(280px, 330px) minmax(0, 1fr);
  gap: 18px;
  max-width: 1440px;
  margin: 0 auto;
  min-height: 0;
  padding-bottom: 32px;
}

.daily-sidebar,
.daily-main {
  display: grid;
  gap: 14px;
  align-content: start;
  min-height: 0;
}

.daily-sidebar {
  position: sticky;
  top: 18px;
  max-height: calc(100vh - 124px);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding-right: 2px;
}

.daily-panel,
.daily-summary-card,
.daily-event-card {
  border: 1px solid #dbe4f0;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.06);
}

.daily-panel {
  padding: 16px;
}

.daily-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.daily-panel-title {
  color: #1e3a8a;
  font-size: 14px;
  font-weight: 800;
}

.daily-panel-toggle {
  border: 1px solid #dbe4f0;
  border-radius: 999px;
  background: #f8fafc;
  color: #1d4ed8;
  padding: 5px 9px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.daily-settings-compact {
  display: grid;
  gap: 10px;
}

.daily-settings-compact p {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
  padding: 10px;
}

.daily-settings-compact span {
  color: #64748b;
  font-size: 12px;
}

.daily-settings-compact strong {
  color: #0f172a;
  font-size: 14px;
}

.daily-panel label {
  display: grid;
  gap: 6px;
  margin-bottom: 10px;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.daily-panel input {
  height: 38px;
  border: 1px solid #cbd5e1;
  border-radius: 9px;
  padding: 0 10px;
  outline: none;
}

.daily-panel input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.daily-category-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 12px 0;
}

.daily-category-picker > span {
  width: 100%;
  color: #334155;
  font-size: 12px;
  font-weight: 800;
}

.daily-category-picker button,
.daily-category-bar button {
  border: 1px solid #dbe4f0;
  border-radius: 999px;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
  cursor: pointer;
}

.daily-category-picker button {
  padding: 6px 9px;
}

.daily-category-picker button.active,
.daily-category-bar button.active {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

.daily-primary-btn,
.daily-import-btn {
  border: 1px solid #2563eb;
  border-radius: 9px;
  background: #2563eb;
  color: #ffffff;
  font-weight: 800;
  cursor: pointer;
}

.daily-primary-btn {
  width: 100%;
  height: 42px;
}

.daily-primary-btn.compact {
  height: 38px;
}

.daily-primary-btn:disabled,
.daily-import-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.daily-helper,
.daily-empty {
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}

.daily-message {
  border-radius: 10px;
  padding: 11px 13px;
  font-size: 13px;
}

.daily-message.error {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}

.daily-message.success {
  border: 1px solid #bbf7d0;
  background: #f0fdf4;
  color: #15803d;
}

.daily-message.warning {
  border: 1px solid #fde68a;
  background: #fffdf2;
  color: #92400e;
  padding: 9px 12px;
}

.daily-diagnostics {
  border: 1px solid #fed7aa;
  border-radius: 12px;
  background: #fff7ed;
  padding: 14px;
  color: #7c2d12;
}

.daily-diagnostics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 10px 0;
}

.daily-diagnostics p {
  display: grid;
  gap: 4px;
  margin: 0;
  border: 1px solid rgba(251, 146, 60, 0.24);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.62);
  padding: 8px;
}

.daily-diagnostics span,
.daily-diagnostics small {
  color: #9a3412;
  font-size: 12px;
}

.daily-diagnostics strong {
  min-width: 0;
  overflow-wrap: anywhere;
  color: #431407;
  font-size: 13px;
}

.daily-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.daily-overview article {
  border: 1px solid #dbe4f0;
  border-radius: 12px;
  background: #ffffff;
  padding: 14px;
}

.daily-overview span,
.daily-card-kicker {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.daily-overview strong {
  display: block;
  margin-top: 7px;
  font-size: 22px;
}

.daily-summary-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px 18px;
  padding: 16px;
}

.daily-summary-head {
  min-width: 0;
}

.daily-summary-card h2 {
  margin: 4px 0 8px;
  font-size: 18px;
}

.daily-summary-card p {
  margin: 0;
  color: #475569;
  line-height: 1.7;
}

.daily-summary-card small {
  flex-shrink: 0;
  color: #64748b;
}

.daily-summary-grid {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1.2fr 0.8fr 1fr;
  gap: 10px;
}

.daily-summary-grid article {
  border: 1px solid #edf2f7;
  border-radius: 10px;
  background: #f8fafc;
  padding: 11px;
}

.daily-summary-grid span {
  display: block;
  margin-bottom: 6px;
  color: #1e3a8a;
  font-size: 12px;
  font-weight: 800;
}

.daily-summary-grid p {
  margin: 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.65;
}

.daily-theme-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.daily-theme-list b {
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  padding: 5px 8px;
  font-size: 12px;
}

.daily-summary-raw {
  grid-column: 1 / -1;
  border-top: 1px solid #edf2f7;
  padding-top: 10px;
}

.daily-summary-raw p {
  margin: 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.65;
}

.daily-summary-raw button {
  margin-top: 8px;
  border: 0;
  background: transparent;
  color: #1d4ed8;
  padding: 0;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.daily-workbench-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  border: 1px solid #dbe4f0;
  border-radius: 12px;
  background: #ffffff;
  padding: 10px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
}

.daily-view-toggle {
  display: inline-flex;
  border: 1px solid #dbe4f0;
  border-radius: 10px;
  background: #f8fafc;
  padding: 3px;
}

.daily-view-toggle button,
.daily-workbench-toolbar select {
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #475569;
  font-size: 12px;
}

.daily-view-toggle button {
  padding: 7px 10px;
  font-weight: 800;
  cursor: pointer;
}

.daily-view-toggle button.active {
  background: #2563eb;
  color: #ffffff;
}

.daily-workbench-toolbar label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}

.daily-workbench-toolbar select {
  min-height: 34px;
  border: 1px solid #dbe4f0;
  background: #ffffff;
  padding: 0 9px;
  outline: none;
}

.daily-risk-check {
  border: 1px solid #dbe4f0;
  border-radius: 999px;
  background: #f8fafc;
  padding: 7px 10px;
}

.daily-category-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.daily-category-bar button {
  padding: 8px 11px;
}

.daily-category-bar span {
  margin-left: 4px;
  color: #64748b;
}

.daily-event-list {
  display: grid;
  gap: 10px;
}

.daily-event-list.compact {
  gap: 8px;
}

.daily-event-card {
  padding: 14px;
}

.daily-event-card.compact {
  padding: 11px 13px;
}

.daily-event-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.daily-rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 32px;
  border-radius: 9px;
  background: #eff6ff;
  color: #1d4ed8;
  font-weight: 900;
}

.daily-event-head h3 {
  margin: 0 0 6px;
  font-size: 16px;
  line-height: 1.45;
}

.daily-event-card.compact .daily-event-head h3 {
  font-size: 14px;
  line-height: 1.38;
}

.daily-original-title {
  display: block;
  margin: -2px 0 6px;
  color: #94a3b8;
  font-size: 11px;
  line-height: 1.4;
}

.daily-event-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.daily-event-meta span {
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  padding: 5px 8px;
  font-size: 12px;
}

.daily-import-btn {
  min-height: 32px;
  padding: 0 10px;
  white-space: nowrap;
  font-size: 12px;
}

.daily-compact-summary {
  margin: 8px 0 0 52px;
  color: #475569;
  font-size: 13px;
  line-height: 1.55;
}

.daily-expand-btn {
  justify-self: start;
  margin: 8px 0 0 52px;
  border: 1px solid #dbe4f0;
  border-radius: 999px;
  background: #ffffff;
  color: #1d4ed8;
  padding: 5px 9px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.daily-event-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.daily-event-grid section {
  border: 1px solid #edf2f7;
  border-radius: 10px;
  background: #f8fafc;
  padding: 12px;
}

.daily-event-grid h4,
.daily-sources strong {
  margin: 0 0 7px;
  color: #1e3a8a;
  font-size: 13px;
}

.daily-event-grid p {
  margin: 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.7;
}

.daily-sources {
  margin-top: 13px;
}

.daily-sources ul {
  display: grid;
  gap: 7px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.daily-sources li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid #edf2f7;
  padding-top: 8px;
  color: #475569;
  font-size: 12px;
}

.daily-sources a {
  color: #1d4ed8;
  text-decoration: none;
}

.daily-sources small {
  color: #94a3b8;
}

.daily-empty.large {
  display: grid;
  gap: 6px;
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  background: #ffffff;
  padding: 42px;
  text-align: center;
}

.daily-empty.large strong {
  color: #0f172a;
  font-size: 16px;
}

.daily-empty.large span,
.daily-empty.large small {
  color: #64748b;
}

.daily-history-overlay {
  position: fixed;
  top: 76px;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 80;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.22);
  backdrop-filter: blur(3px);
}

.daily-history-drawer {
  width: min(440px, calc(100vw - 28px));
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #dbe4f0;
  background: #f8fafc;
  box-shadow: -20px 0 44px rgba(15, 23, 42, 0.16);
}

.daily-history-drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 1px solid #dbe4f0;
  background: #ffffff;
  padding: 18px;
}

.daily-history-drawer-head h2 {
  margin: 0 0 4px;
  font-size: 20px;
  letter-spacing: 0;
}

.daily-history-drawer-head p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.daily-drawer-close {
  width: 34px;
  height: 34px;
  border: 1px solid #dbe4f0;
  border-radius: 9px;
  background: #ffffff;
  color: #334155;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.daily-history-drawer-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 14px;
}

.daily-history-card {
  width: 100%;
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
  padding: 13px;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
}

.daily-history-card.active {
  border-color: #2563eb;
  background: #eff6ff;
  box-shadow: 0 12px 28px rgba(37, 99, 235, 0.13);
}

.daily-history-card:disabled {
  cursor: wait;
  opacity: 0.72;
}

.daily-history-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.daily-history-card strong {
  min-width: 0;
  color: #0f172a;
  font-size: 14px;
  line-height: 1.45;
}

.daily-history-card small {
  color: #64748b;
  font-size: 12px;
}

.daily-history-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.daily-history-card-meta span {
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  padding: 5px 8px;
  font-size: 12px;
}

.daily-history-card em {
  justify-self: end;
  color: #1d4ed8;
  font-size: 12px;
  font-style: normal;
  font-weight: 800;
}

.daily-fallback-chip {
  flex-shrink: 0;
  border: 1px solid #fde68a;
  border-radius: 999px;
  background: #fffbeb;
  color: #92400e;
  padding: 4px 7px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.drawer-empty {
  display: grid;
  gap: 6px;
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  background: #ffffff;
  padding: 28px 18px;
  text-align: center;
}

.drawer-empty strong {
  color: #0f172a;
  font-size: 15px;
}

@media (max-width: 980px) {
  .daily-awareness-page {
    height: calc(100vh - 76px);
    padding: 18px;
  }

  .daily-layout {
    grid-template-columns: 1fr;
  }

  .daily-sidebar {
    position: static;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }

  .daily-overview,
  .daily-summary-grid,
  .daily-event-grid {
    grid-template-columns: 1fr;
  }

  .daily-event-head {
    grid-template-columns: 1fr;
  }

  .daily-compact-summary,
  .daily-expand-btn {
    margin-left: 0;
  }

  .daily-summary-card {
    display: grid;
  }
}

@media (max-width: 640px) {
  .daily-awareness-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .daily-history-trigger {
    width: 100%;
    margin-left: 52px;
  }

  .daily-history-overlay {
    top: 76px;
  }

  .daily-history-drawer {
    width: 100%;
    border-left: 0;
  }
}
</style>
