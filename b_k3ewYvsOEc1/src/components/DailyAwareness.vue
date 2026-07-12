<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  downloadDailyBrief,
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
const exportingWord = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const diagnostics = ref(null)
const selectedCategory = ref('')
const activeBrief = ref(null)
const events = ref([])
const historyItems = ref([])
const showHistoryDrawer = ref(false)
const settingsCollapsed = ref(false)
const expandedEventIds = ref(new Set())
const importedEventIds = ref(new Set())

const RECOVERY_POLL_ATTEMPTS = 6
const RECOVERY_POLL_INTERVAL_MS = 1500

const isLoggedIn = computed(() => Boolean(props.currentUser))
const userModules = computed(() => Array.isArray(props.currentUser?.modules) ? props.currentUser.modules : [])
const canGenerate = computed(() => isLoggedIn.value && userModules.value.includes('daily'))
const canImportToDraft = computed(() => isLoggedIn.value && userModules.value.includes('daily') && userModules.value.includes('draft'))
const permissionHint = computed(() => {
  if (!isLoggedIn.value) return '请先登录后查看或生成每日简报。'
  if (!canGenerate.value) return '当前账号暂无每日动态感知权限，请联系管理员分配权限。'
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
  return [...items].sort((a, b) => Number(a.rank || a.rankNo || 0) - Number(b.rank || b.rankNo || 0))
})
const overview = computed(() => {
  const content = activeBrief.value?.contentJson || {}
  const generation = content.generation || {}
  return {
    date: activeBrief.value?.briefDate || filters.date,
    materials: activeBrief.value?.candidateMaterialCount || generation.candidateMaterialCount || generation.totalMaterials || 0,
    candidates: activeBrief.value?.candidateEventCount || generation.candidateEventCount || activeBrief.value?.totalCandidates || generation.totalCandidates || 0,
    selected: activeBrief.value?.selectedNewsCount || activeBrief.value?.selectedEventCount || activeBrief.value?.selectedCount || generation.selectedNewsCount || generation.selectedEventCount || events.value.length,
    categoryCount: categoryStats.value.length,
    createdAt: activeBrief.value?.createdAt || '',
    usedFallback: Boolean(activeBrief.value?.usedFallback || generation.usedFallback),
    fallbackReason: activeBrief.value?.fallbackReason || generation.fallbackReason || '',
    diagnostics: generation.diagnostics || null,
  }
})
const enrichedEvents = computed(() => events.value.map((event) => normalizeEventForDisplay(event)))
const reportTitle = computed(() => activeBrief.value?.title || `${overview.value.date} 每日动态简报`)
const reportSummary = computed(() => activeBrief.value?.summary || fallbackSummary())
const reportMarkdown = computed(() => {
  return activeBrief.value?.reportMarkdown
    || activeBrief.value?.contentJson?.reportMarkdown
    || buildFallbackReportMarkdown()
})
const primaryCategories = computed(() => categoryStats.value.slice(0, 5).map((item) => item.category).join('、') || '多个领域')
const reportStats = computed(() => [
  { label: '候选新闻', value: overview.value.materials },
  { label: '入选新闻', value: overview.value.selected },
  { label: '分类数量', value: overview.value.categoryCount },
  { label: '生成时间', value: formatTime(overview.value.createdAt) },
])
const categoryDistribution = computed(() => {
  const distribution = activeBrief.value?.categoryDistribution || activeBrief.value?.contentJson?.categoryDistribution
  if (distribution && typeof distribution === 'object' && !Array.isArray(distribution)) {
    return Object.entries(distribution).map(([category, count]) => ({ category, count: Number(count || 0) }))
  }
  return categoryStats.value
})
const reportSections = computed(() => {
  const sections = new Map()
  for (const event of enrichedEvents.value) {
    const category = event.category || '其他'
    if (!sections.has(category)) sections.set(category, [])
    sections.get(category).push(event)
  }
  const preferredOrder = categoryStats.value.map((item) => item.category)
  return [...sections.entries()]
    .map(([category, items]) => ({ category, items: [...items].sort((a, b) => Number(a.rank || a.rankNo || 0) - Number(b.rank || b.rankNo || 0)) }))
    .sort((a, b) => {
      const left = preferredOrder.indexOf(a.category)
      const right = preferredOrder.indexOf(b.category)
      return (left < 0 ? 999 : left) - (right < 0 ? 999 : right)
    })
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
      title: '当前筛选下暂无新闻',
      message: '可切换分类查看其他入选新闻。',
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
  if (!event?.itemId || !canImportToDraft.value) return
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

async function copyReport() {
  const text = reportMarkdown.value
  if (!text) return
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await navigator.clipboard.writeText(text)
    noticeMessage.value = '每日动态简报已复制。'
  } catch {
    errorMessage.value = '复制失败，请检查浏览器剪贴板权限。'
  }
}

async function exportWord() {
  if (!activeBrief.value?.briefId || exportingWord.value) return
  exportingWord.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const result = await downloadDailyBrief(activeBrief.value.briefId, 'docx')
    const filename = result.filename || `${overview.value.date}-每日动态简报.docx`
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
    errorMessage.value = error instanceof Error ? error.message || '导出 Word 失败，请稍后重试。' : '导出 Word 失败，请稍后重试。'
  } finally {
    exportingWord.value = false
  }
}

function setEvents(nextEvents) {
  events.value = nextEvents
  expandedEventIds.value = new Set()
}

function normalizeEventForDisplay(event) {
  const sources = Array.isArray(event.sourceInfo) ? event.sourceInfo : []
  const sourceTitle = sources.find((source) => sanitizeSourceText(source?.title))?.title || ''
  const primary = primarySource(event)
  const candidateTitle = firstText([
    event.title,
    event.displayTitle,
    event.titleZh,
    event.summaryTitle,
    event.eventTitle,
  ])
  const originalTitle = firstText([event.originalTitle, event.sourceTitle, sourceTitle])
  const displayTitle = candidateTitle || originalTitle || '未命名新闻'
  const latestPublishedAtValue = Math.max(0, ...sources.map((source) => new Date(source?.publishedAt || '').getTime()).filter(Number.isFinite))
  return {
    ...event,
    displayTitle,
    originalTitle: originalTitle && originalTitle !== displayTitle ? originalTitle : '',
    sourceCount: event.sourceCount || sources.length,
    publisher: sanitizeSourceText(event.publisher) || sanitizeSourceText(primary.publisher) || '',
    publishedAt: event.publishedAt || primary.publishedAt || '',
    sourceUrl: event.sourceUrl || primary.url || '',
    imported: isEventImported(event.itemId),
    compactSummary: firstText([event.briefContent, event.basicSituation, event.backgroundContext, event.importanceJudgement]).slice(0, 220),
    latestPublishedAtValue,
  }
}

function firstText(values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || ''
}

function sanitizeSourceText(value) {
  const text = String(value || '')
    .replace(/\u0000/g, '')
    .replace(/^[?\uFFFD�\s()[\]（）【】·•\-_:：|｜/\\]+(?=[\p{L}\p{N}\u4e00-\u9fff])/u, '')
    .replace(/(?<=[\p{L}\p{N}\u4e00-\u9fff])[?\uFFFD�\s()[\]（）【】·•\-_:：|｜/\\.。]+$/u, '')
    .trim()
  return /^[?\uFFFD�\s()[\]（）【】·•\-_:：|｜/\\.。]+$/u.test(text) ? '' : text
}

function primarySource(event) {
  const sources = Array.isArray(event?.sourceInfo) ? event.sourceInfo : []
  return sources[0] || {}
}

function sourceUrl(event) {
  return event?.sourceUrl || primarySource(event).url || ''
}

function sourcePublisher(event) {
  return sanitizeSourceText(event?.publisher) || sanitizeSourceText(primarySource(event).publisher) || '来源未知'
}

function sourceTime(event) {
  return event?.publishedAt || primarySource(event).publishedAt || ''
}

function sourceTitle(source) {
  return sanitizeSourceText(source?.title) || source?.url || '未命名来源'
}

function newsBrief(event) {
  return event?.briefContent || event?.basicSituation || event?.compactSummary || '暂无简要内容。'
}

function fallbackSummary() {
  if (!activeBrief.value && !events.value.length) return ''
  const selected = overview.value.selected || events.value.length
  return `今日共从 ${overview.value.materials} 条候选新闻中筛选出 ${selected} 条重点新闻，主要集中在${primaryCategories.value}。`
}

function buildFallbackReportMarkdown() {
  if (!activeBrief.value && !events.value.length) return ''
  const lines = [
    `# ${reportTitle.value}`,
    '',
    '## 一、今日概览',
    '',
    reportSummary.value || fallbackSummary(),
    '',
    '## 二、分类分布',
    '',
  ]
  if (categoryStats.value.length) {
    for (const item of categoryStats.value) lines.push(`- ${item.category}：${item.count} 条`)
  } else {
    lines.push('- 暂无分类统计')
  }
  lines.push('', '## 三、重点新闻列表', '')
  for (const item of enrichedEvents.value) {
    lines.push(`${item.rank || item.rankNo || 0}. ${item.displayTitle}`)
    lines.push(`   简要内容：${newsBrief(item)}`)
    lines.push('')
    lines.push(`   来源：${sourcePublisher(item)}，发布时间：${sourceTime(item) || '时间未知'}`)
    lines.push('')
  }
  lines.push(
    '## 四、可进一步研判方向',
    '',
    '- 可围绕高频分类中的重点新闻形成专题编报；',
    '- 可选择单条新闻导入拟稿助手开展深度分析；',
    '- 正式编报前建议复核关键时间、主体表态和来源链接。',
  )
  return lines.join('\n')
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
        <p>基于现有信源库筛选每日重点新闻，生成动态简报报告。</p>
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
            <p><span>入选新闻</span><strong>{{ overview.selected }}</strong></p>
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
          <article v-for="item in reportStats" :key="item.label">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </article>
        </section>

        <section v-if="activeBrief" class="daily-summary-card">
          <div class="daily-summary-head">
            <div class="daily-card-kicker">每日动态简报</div>
            <h2>{{ reportTitle }}</h2>
            <p>{{ reportSummary || '暂无概览。' }}</p>
          </div>
          <div class="daily-summary-actions">
            <button type="button" class="daily-secondary-btn" @click="copyReport">复制报告</button>
            <button type="button" class="daily-primary-inline-btn" :disabled="exportingWord" @click="exportWord">
              {{ exportingWord ? '导出中...' : '导出 Word' }}
            </button>
          </div>
          <div class="daily-distribution">
            <span v-for="item in categoryDistribution" :key="item.category">
              {{ item.category }} <strong>{{ item.count }}</strong>
            </span>
          </div>
        </section>
        <div v-if="overview.usedFallback" class="daily-message warning">
          {{ overview.fallbackReason || '当前日期无可用材料，已使用最近可用信源生成。' }}
        </div>

        <section v-if="activeBrief" class="daily-report-card daily-readable-report">
          <div class="daily-report-head">
            <div>
              <div class="daily-card-kicker">DAILY BRIEF REPORT</div>
              <h3>每日动态简报正文</h3>
            </div>
            <button type="button" class="daily-secondary-btn" @click="copyReport">复制报告</button>
          </div>
          <article class="daily-report-document">
            <h1>{{ reportTitle }}</h1>
            <section>
              <h2>一、今日概览</h2>
              <p>{{ reportSummary || fallbackSummary() }}</p>
            </section>
            <section>
              <h2>二、分类分布</h2>
              <ul class="daily-report-distribution-list">
                <li v-for="item in categoryDistribution" :key="`report-${item.category}`">
                  <span>{{ item.category }}</span>
                  <strong>{{ item.count }} 条</strong>
                </li>
              </ul>
            </section>
            <section>
              <h2>三、重点新闻列表</h2>
              <div v-for="section in reportSections" :key="section.category" class="daily-report-section">
                <h3>{{ section.category }}</h3>
                <ol>
                  <li v-for="event in section.items" :key="`report-news-${event.itemId}`">
                    <strong>{{ event.displayTitle }}</strong>
                    <p>简要内容：{{ newsBrief(event) }}</p>
                    <small>来源：{{ sourcePublisher(event) }}，发布时间：{{ formatTime(sourceTime(event)) }}</small>
                  </li>
                </ol>
              </div>
            </section>
            <section>
              <h2>四、可进一步研判方向</h2>
              <ul>
                <li>可围绕高频分类中的重点新闻形成专题编报。</li>
                <li>可选择单条新闻导入拟稿助手开展深度分析。</li>
                <li>正式编报前建议复核关键时间、主体表态和来源链接。</li>
              </ul>
            </section>
          </article>
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

        <section class="daily-news-list">
          <article
            v-for="event in visibleEvents"
            :key="event.itemId"
            class="daily-news-card"
          >
            <div class="daily-news-head">
              <span class="daily-rank">#{{ event.rank || event.rankNo }}</span>
              <div>
                <h3>{{ event.displayTitle }}</h3>
                <small v-if="event.originalTitle" class="daily-original-title">原始标题：{{ event.originalTitle }}</small>
                <div class="daily-event-meta">
                  <span>分类：{{ event.category || '其他' }}</span>
                  <span>重要性 {{ Number(event.importanceScore || 0).toFixed(0) }}</span>
                  <span>来源：{{ sourcePublisher(event) }}</span>
                  <span>{{ formatTime(sourceTime(event)) }}</span>
                </div>
              </div>
            </div>
            <p class="daily-news-brief">{{ newsBrief(event) }}</p>
            <div class="daily-news-actions">
              <button
                type="button"
                class="daily-import-btn"
                :disabled="!canImportToDraft || importingItemId === event.itemId || event.imported"
                @click="importToDraft(event)"
              >
                {{ event.imported ? '已导入' : importingItemId === event.itemId ? '导入中...' : '导入拟稿助手' }}
              </button>
              <a v-if="sourceUrl(event)" class="daily-source-link" :href="sourceUrl(event)" target="_blank" rel="noreferrer">查看来源</a>
              <button type="button" class="daily-expand-btn" @click="toggleEventDetails(event.itemId)">
                {{ isEventExpanded(event.itemId) ? '收起详情' : '展开详情' }}
              </button>
            </div>
            <div v-if="isEventExpanded(event.itemId)" class="daily-event-grid">
              <section>
                <h4>原始摘要</h4>
                <p>{{ event.basicSituation || event.briefContent || '暂无。' }}</p>
              </section>
              <section>
                <h4>补充背景</h4>
                <p>{{ event.backgroundContext || '暂无。' }}</p>
              </section>
              <section>
                <h4>重要性判断</h4>
                <p>{{ event.importanceJudgement || '暂无。' }}</p>
              </section>
              <section>
                <h4>可选风险提示</h4>
                <p>{{ event.riskToUs || '暂无。' }}</p>
              </section>
            </div>
            <div v-if="isEventExpanded(event.itemId)" class="daily-sources">
              <strong>相关来源</strong>
              <ul>
                <li v-for="(source, index) in event.sourceInfo || []" :key="`${event.itemId}-${index}`">
                  <span>{{ sanitizeSourceText(source.publisher) || '来源未知' }}</span>
                  <a v-if="source.url" :href="source.url" target="_blank" rel="noreferrer">{{ sourceTitle(source) }}</a>
                  <em v-else>{{ sourceTitle(source) }}</em>
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
            <small>{{ brief.selectedNewsCount || brief.selectedCount || 0 }} 条新闻 · {{ formatTime(brief.createdAt) }}</small>
            <div class="daily-history-card-meta">
              <span>候选材料：{{ historyMaterialCount(brief) }} 条</span>
              <span>入选新闻：{{ brief.selectedNewsCount || brief.selectedCount || 0 }} 条</span>
              <span>主要分类：{{ historyCategoryCount(brief) }} 类</span>
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
.daily-report-card,
.daily-news-card {
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
.daily-import-btn,
.daily-primary-inline-btn,
.daily-secondary-btn {
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
.daily-import-btn:disabled,
.daily-primary-inline-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.daily-primary-inline-btn {
  min-height: 34px;
  padding: 0 12px;
  font-size: 12px;
  cursor: pointer;
}

.daily-secondary-btn {
  align-self: start;
  border-color: #dbe4f0;
  background: #ffffff;
  color: #1d4ed8;
  padding: 8px 11px;
  font-size: 12px;
  cursor: pointer;
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

.daily-summary-actions {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
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

.daily-distribution {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid #edf2f7;
  padding-top: 12px;
}

.daily-distribution span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #dbe4f0;
  border-radius: 999px;
  background: #f8fafc;
  color: #475569;
  padding: 6px 9px;
  font-size: 12px;
}

.daily-distribution strong {
  color: #1d4ed8;
}

.daily-report-card {
  padding: 16px;
}

.daily-readable-report {
  display: grid;
  gap: 16px;
}

.daily-report-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.daily-report-head h3 {
  margin: 4px 0 0;
  font-size: 16px;
}

.daily-report-document {
  display: grid;
  gap: 18px;
  border: 1px solid #edf2f7;
  border-radius: 12px;
  background: #ffffff;
  padding: 22px;
}

.daily-report-document h1 {
  margin: 0;
  color: #0f172a;
  font-size: 22px;
  line-height: 1.45;
}

.daily-report-document h2 {
  margin: 0 0 10px;
  color: #1e3a8a;
  font-size: 17px;
  line-height: 1.45;
}

.daily-report-document h3 {
  margin: 4px 0 10px;
  color: #0f172a;
  font-size: 15px;
}

.daily-report-document p {
  margin: 0;
  color: #334155;
  font-size: 14px;
  line-height: 1.85;
}

.daily-report-document ul,
.daily-report-document ol {
  margin: 0;
  padding-left: 22px;
}

.daily-report-document li {
  color: #334155;
  line-height: 1.75;
}

.daily-report-distribution-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 18px;
  list-style: none;
  padding-left: 0 !important;
}

.daily-report-distribution-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #edf2f7;
  padding-bottom: 7px;
}

.daily-report-distribution-list strong {
  color: #1d4ed8;
  white-space: nowrap;
}

.daily-report-section {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.daily-report-section li {
  margin-bottom: 14px;
}

.daily-report-section strong {
  color: #0f172a;
}

.daily-report-section small {
  display: block;
  margin-top: 5px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
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

.daily-news-list {
  display: grid;
  gap: 10px;
}

.daily-news-card {
  padding: 14px;
}

.daily-news-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: flex-start;
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

.daily-news-head h3 {
  margin: 0 0 6px;
  font-size: 16px;
  line-height: 1.45;
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

.daily-news-brief {
  margin: 8px 0 0 52px;
  color: #475569;
  font-size: 13px;
  line-height: 1.55;
}

.daily-news-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0 0 52px;
}

.daily-source-link {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  border: 1px solid #dbe4f0;
  border-radius: 9px;
  background: #ffffff;
  color: #1d4ed8;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
}

.daily-expand-btn {
  justify-self: start;
  border: 1px solid #dbe4f0;
  border-radius: 9px;
  background: #ffffff;
  color: #1d4ed8;
  min-height: 32px;
  padding: 0 10px;
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

  .daily-news-head {
    grid-template-columns: 1fr;
  }

  .daily-news-brief,
  .daily-news-actions {
    margin-left: 0;
  }

  .daily-summary-card {
    display: grid;
  }

  .daily-report-distribution-list {
    grid-template-columns: 1fr;
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
