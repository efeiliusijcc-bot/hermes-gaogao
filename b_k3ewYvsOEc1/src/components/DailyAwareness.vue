<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
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
const selectedCategory = ref('')
const activeBrief = ref(null)
const events = ref([])
const historyItems = ref([])

const canGenerate = computed(() => props.currentUser && props.currentUser.role !== 'viewer')
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
  if (!selectedCategory.value) return events.value
  return events.value.filter((event) => event.category === selectedCategory.value)
})
const overview = computed(() => {
  const content = activeBrief.value?.contentJson || {}
  const generation = content.generation || {}
  return {
    date: activeBrief.value?.briefDate || filters.date,
    candidates: activeBrief.value?.totalCandidates || generation.totalCandidates || 0,
    selected: activeBrief.value?.selectedCount || events.value.length,
    categoryCount: categoryStats.value.length,
    createdAt: activeBrief.value?.createdAt || '',
  }
})

function toggleCategory(category) {
  if (filters.categories.includes(category)) {
    filters.categories = filters.categories.filter((item) => item !== category)
  } else {
    filters.categories = [...filters.categories, category]
  }
}

async function loadHistory() {
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

async function generateBrief() {
  if (!canGenerate.value || loading.value) return
  loading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
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
    events.value = Array.isArray(result?.events) ? result.events : []
    noticeMessage.value = '每日动态简报已生成。'
    await loadHistory()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

async function openBrief(briefId) {
  if (!briefId || openingBriefId.value) return
  openingBriefId.value = briefId
  errorMessage.value = ''
  noticeMessage.value = ''
  selectedCategory.value = ''
  try {
    const result = await getDailyBrief(briefId)
    activeBrief.value = result?.brief || null
    events.value = Array.isArray(result?.events?.items) ? result.events.items : Array.isArray(result?.events) ? result.events : []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    openingBriefId.value = ''
  }
}

async function importToDraft(event) {
  if (!event?.itemId || props.currentUser?.role === 'viewer') return
  importingItemId.value = event.itemId
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const result = await importDailyEventToDraft(event.itemId)
    noticeMessage.value = '已导入拟稿助手。'
    if (result?.eventId) emit('open-draft-event', { eventId: result.eventId })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    importingItemId.value = ''
  }
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => {
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
    </header>

    <section class="daily-layout">
      <aside class="daily-sidebar">
        <section class="daily-panel">
          <div class="daily-panel-title">生成设置</div>
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
          <p v-if="!canGenerate" class="daily-helper">viewer 账号仅可查看简报，不能生成每日简报。</p>
        </section>

        <section class="daily-panel daily-history">
          <div class="daily-panel-title">历史简报</div>
          <div v-if="historyLoading" class="daily-empty">正在读取历史简报...</div>
          <button
            v-for="brief in historyItems"
            v-else
            :key="brief.briefId"
            type="button"
            class="daily-history-item"
            :class="{ active: activeBrief?.briefId === brief.briefId }"
            @click="openBrief(brief.briefId)"
          >
            <strong>{{ brief.title || brief.briefDate }}</strong>
            <small>{{ brief.selectedCount }} 条事件 · {{ formatTime(brief.createdAt) }}</small>
          </button>
          <div v-if="!historyLoading && !historyItems.length" class="daily-empty">暂无历史简报。</div>
        </section>
      </aside>

      <section class="daily-main">
        <div v-if="errorMessage" class="daily-message error">{{ errorMessage }}</div>
        <div v-if="noticeMessage" class="daily-message success">{{ noticeMessage }}</div>

        <section class="daily-overview">
          <article>
            <span>简报日期</span>
            <strong>{{ overview.date }}</strong>
          </article>
          <article>
            <span>候选事件</span>
            <strong>{{ overview.candidates }}</strong>
          </article>
          <article>
            <span>入选事件</span>
            <strong>{{ overview.selected }}</strong>
          </article>
          <article>
            <span>分类数量</span>
            <strong>{{ overview.categoryCount }}</strong>
          </article>
        </section>

        <section v-if="activeBrief" class="daily-summary-card">
          <div>
            <div class="daily-card-kicker">简报摘要</div>
            <h2>{{ activeBrief.title }}</h2>
            <p>{{ activeBrief.summary || '暂无摘要。' }}</p>
          </div>
          <small>生成时间：{{ formatTime(overview.createdAt) }}</small>
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

        <section class="daily-event-list">
          <article v-for="event in visibleEvents" :key="event.itemId" class="daily-event-card">
            <div class="daily-event-head">
              <span class="daily-rank">#{{ event.rankNo }}</span>
              <div>
                <h3>{{ event.eventTitle }}</h3>
                <div class="daily-event-meta">
                  <span>{{ event.category || '其他' }}</span>
                  <span>重要性 {{ Number(event.importanceScore || 0).toFixed(0) }}</span>
                  <span>涉我风险 {{ Number(event.riskScore || 0).toFixed(0) }}</span>
                </div>
              </div>
              <button
                type="button"
                class="daily-import-btn"
                :disabled="currentUser?.role === 'viewer' || importingItemId === event.itemId"
                @click="importToDraft(event)"
              >
                {{ importingItemId === event.itemId ? '导入中...' : '导入拟稿助手' }}
              </button>
            </div>
            <div class="daily-event-grid">
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
            <div class="daily-sources">
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
            暂无事件。请选择日期并生成每日简报。
          </div>
        </section>
      </section>
    </section>
  </main>
</template>

<style scoped>
.daily-awareness-page {
  min-height: calc(100vh - 76px);
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

.daily-layout {
  display: grid;
  grid-template-columns: minmax(280px, 330px) minmax(0, 1fr);
  gap: 18px;
  max-width: 1440px;
  margin: 0 auto;
}

.daily-sidebar,
.daily-main {
  display: grid;
  gap: 14px;
  align-content: start;
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

.daily-panel-title {
  margin-bottom: 12px;
  color: #1e3a8a;
  font-size: 14px;
  font-weight: 800;
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

.daily-history {
  max-height: 420px;
  overflow: auto;
}

.daily-history-item {
  width: 100%;
  display: grid;
  gap: 5px;
  margin-bottom: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  padding: 10px;
  text-align: left;
  cursor: pointer;
}

.daily-history-item.active {
  border-color: #2563eb;
  background: #eff6ff;
}

.daily-history-item strong {
  font-size: 13px;
  line-height: 1.45;
}

.daily-history-item small {
  color: #64748b;
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
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
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
  gap: 14px;
}

.daily-event-card {
  padding: 16px;
}

.daily-event-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
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
  margin: 0 0 8px;
  font-size: 17px;
  line-height: 1.45;
}

.daily-event-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.daily-event-meta span {
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  padding: 5px 8px;
  font-size: 12px;
}

.daily-import-btn {
  min-height: 34px;
  padding: 0 12px;
  white-space: nowrap;
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
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  background: #ffffff;
  padding: 42px;
  text-align: center;
}

@media (max-width: 980px) {
  .daily-layout {
    grid-template-columns: 1fr;
  }

  .daily-overview,
  .daily-event-grid {
    grid-template-columns: 1fr;
  }

  .daily-event-head {
    grid-template-columns: 1fr;
  }

  .daily-summary-card {
    display: grid;
  }
}
</style>
