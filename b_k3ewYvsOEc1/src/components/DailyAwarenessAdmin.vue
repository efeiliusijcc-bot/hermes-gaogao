<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  getDailyAwarenessAdminConfig,
  getDailyAwarenessAdminInbox,
  getDailyAwarenessAdminRuns,
  getDailyAwarenessAdminStatus,
  getDailyAwarenessHistory,
  regenerateDailyAwareness,
  reprocessDailyAwarenessInbox,
  updateDailyAwarenessAdminConfig,
} from '../lib/api.js'
import {
  buildTodaySummary,
  dailyAwarenessIssueLabel,
  mergeDailyAwarenessHistory,
} from '../lib/dailyAwarenessAdminView.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['open-daily-awareness'])
const unresolvedStatuses = new Set(['RECEIVED', 'PROCESSING', 'RETRY_PENDING', 'DEAD_LETTER'])
const dailyAwarenessCategories = ['涉政', '危安', '涉华', '其他']

const loading = ref(false)
const savingConfig = ref(false)
const regenerating = ref(false)
const reprocessingEventId = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')
const status = ref(null)
const runs = ref([])
const issueRows = ref([])
const historyRows = ref([])
const activeView = ref('today')
const settingsOpen = ref(false)
const regenerationOpen = ref(false)
const advancedSettingsOpen = ref(false)
const expandedIssueId = ref('')
const expandedHistoryDate = ref('')

const configForm = reactive({
  lookbackHours: 24,
  maxArticles: 50,
  categoryScope: [...dailyAwarenessCategories],
  maxRetryCount: 3,
  retryIntervalSeconds: 30,
  summaryMaxChars: 1200,
  version: 1,
  updatedAt: '',
  updatedBy: '',
})

const manualForm = reactive({
  businessDate: today(),
  reason: '',
  confirmOverwrite: false,
})

const historyFilters = reactive({
  from: daysAgo(29),
  to: today(),
  result: '',
})

const permissions = computed(() => Array.isArray(props.currentUser?.permissions) ? props.currentUser.permissions : [])
const canManage = computed(() => permissions.value.includes('system:daily-awareness:manage'))
const todaySummary = computed(() => buildTodaySummary(status.value || {}))
const issueCount = computed(() => issueRows.value.length)
const configSummary = computed(() => `${configForm.categoryScope.join('、')} · 每天 ${configForm.maxArticles} 条`)
const visibleHistoryRows = computed(() => {
  if (!historyFilters.result) return historyRows.value
  return historyRows.value.filter((row) => row.tone === historyFilters.result)
})

onMounted(() => {
  if (canManage.value) void loadAll()
})

async function loadAll() {
  if (loading.value) return
  loading.value = true
  clearMessages()
  try {
    const [statusResult, configResult, runResult, inboxResult, historyResult] = await Promise.all([
      getDailyAwarenessAdminStatus(),
      getDailyAwarenessAdminConfig(),
      getDailyAwarenessAdminRuns({ page: 1, pageSize: 100 }),
      getDailyAwarenessAdminInbox({ page: 1, pageSize: 100 }),
      getDailyAwarenessHistory({ page: 1, pageSize: 100, from: historyFilters.from, to: historyFilters.to }),
    ])
    status.value = statusResult || null
    applyConfig(configResult)
    applyRuns(runResult)
    applyIssues(inboxResult)
    applyHistory(historyResult)
  } catch (error) {
    setError(error, '暂时无法获取动态感知状态，请点击重试。')
  } finally {
    loading.value = false
  }
}

async function loadIssues() {
  if (loading.value) return
  loading.value = true
  clearMessages()
  try {
    applyIssues(await getDailyAwarenessAdminInbox({ page: 1, pageSize: 100 }))
  } catch (error) {
    setError(error, '暂时无法获取异常信息，请点击重试。')
  } finally {
    loading.value = false
  }
}

async function loadHistory() {
  if (loading.value) return
  loading.value = true
  clearMessages()
  try {
    const [runResult, historyResult] = await Promise.all([
      getDailyAwarenessAdminRuns({ page: 1, pageSize: 100 }),
      getDailyAwarenessHistory({ page: 1, pageSize: 100, from: historyFilters.from, to: historyFilters.to }),
    ])
    applyRuns(runResult)
    applyHistory(historyResult)
  } catch (error) {
    setError(error, '暂时无法获取历史记录，请点击重试。')
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  if (savingConfig.value) return
  if (!configForm.categoryScope.length) {
    errorMessage.value = '请至少选择一个动态类别。'
    return
  }
  savingConfig.value = true
  clearMessages()
  try {
    const result = await updateDailyAwarenessAdminConfig({
      lookbackHours: Number(configForm.lookbackHours),
      maxArticles: Number(configForm.maxArticles),
      categoryScope: [...configForm.categoryScope],
      maxRetryCount: Number(configForm.maxRetryCount),
      retryIntervalSeconds: Number(configForm.retryIntervalSeconds),
      summaryMaxChars: Number(configForm.summaryMaxChars),
      version: Number(configForm.version),
    })
    applyConfig(result)
    settingsOpen.value = false
    noticeMessage.value = '生成设置已保存，将从下一次生成开始生效。'
  } catch (error) {
    setError(error)
  } finally {
    savingConfig.value = false
  }
}

async function submitRegeneration() {
  if (regenerating.value) return
  if (!manualForm.reason.trim()) {
    errorMessage.value = '请填写重新生成原因。'
    return
  }
  if (!manualForm.confirmOverwrite) {
    errorMessage.value = '请确认允许覆盖该日期已有的成功简报。'
    return
  }
  regenerating.value = true
  clearMessages()
  try {
    await regenerateDailyAwareness({
      businessDate: manualForm.businessDate,
      reason: manualForm.reason.trim(),
      confirmOverwrite: manualForm.confirmOverwrite,
    })
    manualForm.reason = ''
    manualForm.confirmOverwrite = false
    regenerationOpen.value = false
    await loadAll()
    noticeMessage.value = '重新生成任务已提交，系统正在处理。'
  } catch (error) {
    setError(error)
  } finally {
    regenerating.value = false
  }
}

async function reprocess(item) {
  if (!item?.eventId || reprocessingEventId.value) return
  reprocessingEventId.value = item.eventId
  clearMessages()
  try {
    await reprocessDailyAwarenessInbox(item.eventId)
    await loadIssues()
    await loadHistory()
    noticeMessage.value = '事件已重新排队，系统正在处理。'
  } catch (error) {
    setError(error)
  } finally {
    reprocessingEventId.value = ''
  }
}

function applyConfig(value) {
  if (!value) return
  configForm.lookbackHours = Number(value.lookbackHours || 24)
  configForm.maxArticles = Math.max(1, Math.min(50, Number(value.maxArticles || 50)))
  configForm.categoryScope = Array.isArray(value.categoryScope) && value.categoryScope.length
    ? value.categoryScope.filter((item) => dailyAwarenessCategories.includes(item))
    : [...dailyAwarenessCategories]
  configForm.maxRetryCount = Number(value.maxRetryCount ?? 3)
  configForm.retryIntervalSeconds = Number(value.retryIntervalSeconds || 30)
  configForm.summaryMaxChars = Number(value.summaryMaxChars || 1200)
  configForm.version = Number(value.version || 1)
  configForm.updatedAt = value.updatedAt || ''
  configForm.updatedBy = value.updatedBy || ''
}

function applyRuns(value) {
  runs.value = Array.isArray(value?.items) ? value.items : []
}

function applyIssues(value) {
  const items = Array.isArray(value?.items) ? value.items : []
  issueRows.value = items
    .filter((item) => unresolvedStatuses.has(String(item.status || '').toUpperCase()))
    .map((item) => ({
      ...item,
      ...dailyAwarenessIssueLabel(item),
      problem: friendlyProblem(item),
    }))
}

function applyHistory(value) {
  const items = Array.isArray(value?.items) ? value.items : []
  const filteredRuns = runs.value.filter((run) => {
    const date = String(run.businessDate || '')
    return date && date >= historyFilters.from && date <= historyFilters.to
  })
  historyRows.value = mergeDailyAwarenessHistory(filteredRuns, items)
}

function friendlyProblem(item) {
  const message = String(item?.errorMessage || item?.lastErrorMessage || '').trim()
  if (/Invalid time value/i.test(message)) return '数据中有异常发布时间'
  if (/Access denied|password/i.test(message)) return '数据库连接暂时失败'
  if (/table.*not.*exist|does not exist/i.test(message)) return '昨日数据尚未准备完成'
  if (/timeout|timed out/i.test(message)) return '生成服务响应超时'
  return message || '系统未能自动完成本次生成'
}

function switchView(view) {
  activeView.value = view
  clearMessages()
}

function handleTodayAction() {
  if (todaySummary.value.action === 'view') {
    emit('open-daily-awareness')
    return
  }
  if (todaySummary.value.action === 'issues') {
    switchView('issues')
    return
  }
  void loadAll()
}

function openRegeneration(businessDate = today()) {
  manualForm.businessDate = businessDate || today()
  manualForm.reason = ''
  manualForm.confirmOverwrite = false
  regenerationOpen.value = true
  clearMessages()
}

function toggleIssue(item) {
  expandedIssueId.value = expandedIssueId.value === item.eventId ? '' : item.eventId
}

function toggleHistory(row) {
  expandedHistoryDate.value = expandedHistoryDate.value === row.businessDate ? '' : row.businessDate
}

function setError(error, fallback = '') {
  const code = String(error?.data?.code || '')
  if (code === 'DAILY_AWARENESS_CONFIG_VERSION_CONFLICT') {
    errorMessage.value = '配置已被其他管理员更新，请刷新后再提交。'
    return
  }
  if (code === 'DAILY_AWARENESS_SUCCESS_ALREADY_EXISTS') {
    errorMessage.value = '该日期已有成功简报，无需再次处理。'
    return
  }
  if (error?.status === 409) {
    errorMessage.value = '同一业务日期正在处理，请稍后再试。'
    return
  }
  errorMessage.value = fallback || (error instanceof Error ? error.message : String(error))
}

function clearMessages() {
  errorMessage.value = ''
  noticeMessage.value = ''
}

function formatTime(value) {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未记录'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function displayDate(value) {
  const text = String(value || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '未记录'
  return text.replace(/-/g, '/')
}

function today() {
  const date = new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function daysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}
</script>

<template>
  <section class="daily-admin">
    <div v-if="!canManage" class="empty-state">当前账号没有动态感知管理权限。</div>
    <template v-else>
      <nav class="admin-tabs" aria-label="动态感知管理页面">
        <button type="button" :class="{ active: activeView === 'today' }" @click="switchView('today')">今日简报</button>
        <button type="button" :class="{ active: activeView === 'issues' }" @click="switchView('issues')">
          异常处理<span v-if="issueCount" class="tab-count">{{ issueCount }}</span>
        </button>
        <button type="button" :class="{ active: activeView === 'history' }" @click="switchView('history')">历史记录</button>
      </nav>

      <div v-if="errorMessage" class="admin-message error" role="alert">{{ errorMessage }}</div>
      <div v-if="noticeMessage" class="admin-message success" role="status">{{ noticeMessage }}</div>

      <section v-if="activeView === 'today'" class="admin-page">
        <header class="page-header">
          <div><h2>今日简报</h2><p>系统每天 06:00 自动使用前一天数据生成简报</p></div>
          <button class="icon-button" type="button" :disabled="loading" title="刷新" aria-label="刷新" @click="loadAll">↻</button>
        </header>

        <section class="today-result" :class="`tone-${todaySummary.tone}`">
          <div class="today-result__copy">
            <span class="status-mark" aria-hidden="true"></span>
            <div><h3>{{ todaySummary.label }}</h3><p>{{ todaySummary.description }}</p></div>
          </div>
          <button class="admin-button primary" type="button" :disabled="loading" @click="handleTodayAction">
            {{ todaySummary.action === 'view' ? '查看简报' : todaySummary.action === 'issues' ? '查看处理办法' : '刷新状态' }}
          </button>
        </section>

        <dl class="today-stats">
          <div><dt>简报日期</dt><dd>{{ displayDate(todaySummary.businessDate) }}</dd></div>
          <div><dt>数据日期</dt><dd>{{ displayDate(todaySummary.sourceBusinessDate) }}</dd></div>
          <div><dt>入选消息</dt><dd>{{ todaySummary.selectedCount ? `${todaySummary.selectedCount} 条` : '尚未生成' }}</dd></div>
          <div><dt>完成时间</dt><dd>{{ formatTime(todaySummary.generatedAt) }}</dd></div>
        </dl>

        <section class="action-row">
          <div><h3>生成设置</h3><p>{{ configSummary }} · 每天 06:00 自动开始</p></div>
          <button class="admin-button" type="button" @click="settingsOpen = true">修改设置</button>
        </section>

        <section class="action-row">
          <div><h3>需要重新生成？</h3><p>仅用于内容不完整或分类设置改变后，操作时需要填写原因。</p></div>
          <button class="admin-button" type="button" @click="openRegeneration(todaySummary.businessDate)">重新生成</button>
        </section>
      </section>

      <section v-else-if="activeView === 'issues'" class="admin-page">
        <header class="page-header">
          <div><h2>需要处理的问题</h2><p>这里只展示尚未解决的问题，系统可自行恢复时无需人工操作</p></div>
          <button class="admin-button" type="button" :disabled="loading" @click="loadIssues">刷新</button>
        </header>

        <div v-if="!loading && !issueRows.length" class="empty-state success-empty">
          <strong>当前一切正常</strong><span>没有需要人工处理的动态感知问题。</span>
        </div>

        <div v-else class="issue-list">
          <article v-for="item in issueRows" :key="item.eventId" class="issue-item">
            <div class="issue-item__main">
              <time>{{ displayDate(item.businessDate) }}</time>
              <div class="issue-copy"><strong>{{ item.problem }}</strong><span>系统已尝试 {{ item.attemptCount || 0 }} 次</span></div>
              <span class="status-chip" :class="`tone-${item.tone}`">{{ item.label }}</span>
              <div class="row-actions">
                <button class="text-button" type="button" @click="toggleIssue(item)">查看技术详情</button>
                <button
                  v-if="item.status === 'DEAD_LETTER'"
                  class="admin-button primary"
                  type="button"
                  :disabled="Boolean(reprocessingEventId)"
                  @click="reprocess(item)"
                >{{ reprocessingEventId === item.eventId ? '提交中...' : '再次生成' }}</button>
              </div>
            </div>
            <dl v-if="expandedIssueId === item.eventId" class="technical-detail">
              <div><dt>事件 ID</dt><dd>{{ item.eventId }}</dd></div>
              <div><dt>错误代码</dt><dd>{{ item.errorCode || '未记录' }}</dd></div>
              <div><dt>最近更新</dt><dd>{{ formatTime(item.updatedAt) }}</dd></div>
              <div><dt>下次尝试</dt><dd>{{ formatTime(item.nextAttemptAt) }}</dd></div>
              <div class="detail-wide"><dt>原始信息</dt><dd>{{ item.errorMessage || '未记录' }}</dd></div>
            </dl>
          </article>
        </div>
      </section>

      <section v-else class="admin-page">
        <header class="page-header">
          <div><h2>历史生成记录</h2><p>每天只显示一条最终结果，重复尝试收进详情</p></div>
        </header>

        <form class="history-filters" @submit.prevent="loadHistory">
          <label><span>开始日期</span><input v-model="historyFilters.from" type="date" required /></label>
          <label><span>结束日期</span><input v-model="historyFilters.to" type="date" required /></label>
          <label><span>结果</span><select v-model="historyFilters.result"><option value="">全部结果</option><option value="success">生成成功</option><option value="danger">未生成</option><option value="neutral">暂无数据</option><option value="info">正在生成</option></select></label>
          <button class="admin-button" type="submit" :disabled="loading">查询</button>
        </form>

        <div v-if="!loading && !visibleHistoryRows.length" class="empty-state">所选日期内没有生成记录。</div>
        <div v-else class="history-table-wrap">
          <table class="history-table">
            <thead><tr><th>简报日期</th><th>最终结果</th><th>数据来源</th><th>入选消息</th><th>完成时间</th><th>操作</th></tr></thead>
            <tbody>
              <template v-for="row in visibleHistoryRows" :key="row.businessDate">
                <tr>
                  <td>{{ displayDate(row.businessDate) }}</td>
                  <td><span class="status-chip" :class="`tone-${row.tone}`">{{ row.resultLabel }}</span></td>
                  <td>{{ row.sourceBusinessDate ? `使用 ${displayDate(row.sourceBusinessDate)} 数据` : '未记录数据来源' }}</td>
                  <td>{{ row.selectedCount ? `${row.selectedCount} 条` : '未生成' }}</td>
                  <td>{{ formatTime(row.completedAt) }}</td>
                  <td class="row-actions">
                    <button v-if="row.action === 'view'" class="text-button" type="button" @click="emit('open-daily-awareness')">查看简报</button>
                    <button v-else-if="row.action === 'regenerate'" class="text-button" type="button" @click="openRegeneration(row.businessDate)">重新生成</button>
                    <button class="text-button" type="button" @click="toggleHistory(row)">展开技术详情</button>
                  </td>
                </tr>
                <tr v-if="expandedHistoryDate === row.businessDate" class="history-detail-row">
                  <td colspan="6">
                    <div class="run-list">
                      <div v-for="run in row.runs" :key="run.id">
                        <strong>{{ run.id }}</strong><span>{{ run.status }} · {{ run.triggerType }} · {{ formatTime(run.startedAt || run.createdAt) }}</span><small>{{ run.sourceTable || '未记录来源表' }}{{ run.errorCode ? ` · ${run.errorCode}` : '' }}</small>
                      </div>
                      <span v-if="!row.runs.length">没有更多运行详情。</span>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>

      <Teleport to="body">
        <div v-if="settingsOpen" class="admin-dialog-backdrop" @click.self="settingsOpen = false" @keydown.esc="settingsOpen = false">
          <section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="daily-settings-title">
            <header><div><h2 id="daily-settings-title">生成设置</h2><p>保存后从下一次生成开始生效</p></div><button class="icon-button" type="button" aria-label="关闭" @click="settingsOpen = false">×</button></header>
            <form @submit.prevent="saveConfig">
              <fieldset class="category-scope">
                <legend>选择动态类别</legend>
                <label v-for="category in dailyAwarenessCategories" :key="category"><input v-model="configForm.categoryScope" type="checkbox" :value="category" /><span>{{ category }}</span></label>
              </fieldset>
              <label class="form-field"><span>每天入选</span><input v-model.number="configForm.maxArticles" type="number" min="1" max="50" required /><small>最多 50 条</small></label>
              <label class="form-field"><span>自动生成时间</span><input value="每天 06:00" type="text" disabled /></label>
              <button class="advanced-toggle" type="button" @click="advancedSettingsOpen = !advancedSettingsOpen">{{ advancedSettingsOpen ? '收起高级设置' : '高级设置' }}</button>
              <div v-if="advancedSettingsOpen" class="advanced-grid">
                <label class="form-field"><span>数据回溯小时</span><input v-model.number="configForm.lookbackHours" type="number" min="1" max="168" required /></label>
                <label class="form-field"><span>失败后重试次数</span><input v-model.number="configForm.maxRetryCount" type="number" min="0" max="10" required /></label>
                <label class="form-field"><span>重试间隔（秒）</span><input v-model.number="configForm.retryIntervalSeconds" type="number" min="1" max="3600" required /></label>
                <label class="form-field"><span>摘要长度上限</span><input v-model.number="configForm.summaryMaxChars" type="number" min="100" max="10000" required /></label>
              </div>
              <footer><button class="admin-button" type="button" @click="settingsOpen = false">取消</button><button class="admin-button primary" type="submit" :disabled="savingConfig">{{ savingConfig ? '保存中...' : '保存设置' }}</button></footer>
            </form>
          </section>
        </div>

        <div v-if="regenerationOpen" class="admin-dialog-backdrop" @click.self="regenerationOpen = false" @keydown.esc="regenerationOpen = false">
          <section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="daily-regenerate-title">
            <header><div><h2 id="daily-regenerate-title">重新生成简报</h2><p>该操作可能覆盖已有成功简报</p></div><button class="icon-button" type="button" aria-label="关闭" @click="regenerationOpen = false">×</button></header>
            <form @submit.prevent="submitRegeneration">
              <label class="form-field"><span>简报日期</span><input v-model="manualForm.businessDate" type="date" required /></label>
              <label class="form-field"><span>操作原因</span><textarea v-model="manualForm.reason" rows="4" maxlength="500" required /></label>
              <label class="confirm-check"><input v-model="manualForm.confirmOverwrite" type="checkbox" /><span>我确认允许覆盖该日期已有的成功简报</span></label>
              <footer><button class="admin-button" type="button" @click="regenerationOpen = false">取消</button><button class="admin-button danger" type="submit" :disabled="regenerating">{{ regenerating ? '提交中...' : '确认重新生成' }}</button></footer>
            </form>
          </section>
        </div>
      </Teleport>
    </template>
  </section>
</template>

<style scoped>
.daily-admin { color: #172033; }
.admin-tabs { display: flex; gap: 20px; margin-bottom: 18px; border-bottom: 1px solid #dfe4eb; }
.admin-tabs button { position: relative; min-height: 42px; padding: 0 2px; border: 0; border-bottom: 2px solid transparent; color: #667085; background: transparent; font-weight: 700; cursor: pointer; }
.admin-tabs button.active { border-bottom-color: #0f6b4b; color: #0f6b4b; }
.tab-count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; margin-left: 6px; border-radius: 9px; color: #fff; background: #b42318; font-size: 11px; }
.admin-page { display: grid; gap: 14px; }
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.page-header h2, .action-row h3, .today-result h3 { margin: 0; letter-spacing: 0; }
.page-header h2 { font-size: 18px; }
.page-header p, .action-row p, .today-result p { margin: 4px 0 0; color: #667085; font-size: 12px; }
.icon-button { display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 1px solid #ccd4df; border-radius: 5px; color: #344054; background: #fff; font-size: 20px; cursor: pointer; }
.today-result { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 92px; padding: 18px; border: 1px solid #dce3ea; border-left-width: 4px; background: #fff; box-sizing: border-box; }
.today-result__copy { display: flex; align-items: center; gap: 12px; }
.status-mark { width: 12px; height: 12px; border-radius: 50%; background: currentColor; }
.today-result h3 { font-size: 18px; }
.today-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; border: 1px solid #dce3ea; background: #fff; }
.today-stats div { min-height: 72px; padding: 13px; border-right: 1px solid #e4e7ec; box-sizing: border-box; }
.today-stats div:last-child { border-right: 0; }
.today-stats dt { color: #667085; font-size: 11px; }
.today-stats dd { margin: 8px 0 0; font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
.action-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 16px; border: 1px solid #dce3ea; background: #fff; }
.action-row h3 { font-size: 14px; }
.admin-button { min-height: 36px; padding: 0 12px; border: 1px solid #ccd4df; border-radius: 5px; color: #344054; background: #fff; font-weight: 700; cursor: pointer; white-space: nowrap; }
.admin-button.primary { border-color: #0f6b4b; color: #fff; background: #0f6b4b; }
.admin-button.danger { border-color: #b42318; color: #fff; background: #b42318; }
.admin-button:disabled, .icon-button:disabled { cursor: not-allowed; opacity: .55; }
.admin-message { margin: 10px 0; padding: 10px 12px; border-radius: 5px; font-size: 13px; }
.admin-message.error { color: #991b1b; background: #fee2e2; }
.admin-message.success { color: #166534; background: #dcfce7; }
.empty-state { display: grid; place-items: center; gap: 5px; min-height: 160px; padding: 24px; border: 1px dashed #ccd4df; color: #667085; text-align: center; background: #fff; box-sizing: border-box; }
.success-empty strong { color: #157347; font-size: 16px; }
.issue-list { display: grid; gap: 10px; }
.issue-item { border: 1px solid #dce3ea; background: #fff; }
.issue-item__main { display: grid; grid-template-columns: 110px minmax(220px, 1fr) 120px auto; align-items: center; gap: 14px; padding: 14px; }
.issue-item time { color: #475467; font-weight: 700; }
.issue-copy { display: grid; gap: 4px; }
.issue-copy span { color: #667085; font-size: 12px; }
.status-chip { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 8px; border-radius: 4px; font-size: 12px; font-weight: 800; }
.tone-success { color: #157347; border-color: #86c9a9; background: #ecfdf3; }
.tone-info { color: #175cd3; border-color: #b2ccff; background: #eff8ff; }
.tone-warning { color: #a15c00; border-color: #f0c36a; background: #fff8e5; }
.tone-danger { color: #b42318; border-color: #f3a7a2; background: #fff1f0; }
.tone-neutral { color: #475467; border-color: #d0d5dd; background: #f7f9fb; }
.row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.text-button { padding: 4px 0; border: 0; color: #0f6b4b; background: transparent; font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
.technical-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin: 0; padding: 14px; border-top: 1px solid #e4e7ec; background: #f8fafc; }
.technical-detail div { display: grid; grid-template-columns: 90px minmax(0, 1fr); font-size: 12px; }
.technical-detail dt { color: #667085; }
.technical-detail dd { margin: 0; overflow-wrap: anywhere; }
.technical-detail .detail-wide { grid-column: 1 / -1; }
.history-filters { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 8px; padding: 12px; border: 1px solid #dce3ea; background: #fff; }
.history-filters label, .form-field { display: grid; gap: 5px; }
.history-filters label span, .form-field span { color: #667085; font-size: 11px; }
.history-filters input, .history-filters select, .form-field input, .form-field textarea { min-height: 36px; padding: 7px 9px; border: 1px solid #ccd4df; border-radius: 5px; color: #172033; background: #fff; box-sizing: border-box; font: inherit; }
.history-table-wrap { width: 100%; overflow-x: auto; border: 1px solid #dce3ea; background: #fff; }
.history-table { width: 100%; min-width: 780px; border-collapse: collapse; font-size: 12px; }
.history-table th, .history-table td { padding: 11px 12px; border-bottom: 1px solid #e4e7ec; text-align: left; vertical-align: middle; }
.history-table th { color: #667085; background: #f7f9fb; }
.history-detail-row td { padding: 0; background: #f8fafc; }
.run-list { display: grid; gap: 8px; padding: 12px; }
.run-list div { display: grid; grid-template-columns: minmax(180px, .8fr) minmax(220px, 1fr) minmax(180px, 1fr); gap: 12px; }
.run-list strong, .run-list span, .run-list small { overflow-wrap: anywhere; }
.run-list small { color: #667085; }
.category-scope { display: flex; flex-wrap: wrap; gap: 10px 18px; margin: 0; padding: 12px; border: 1px solid #ccd4df; }
.category-scope legend { padding: 0 4px; color: #667085; font-size: 12px; }
.category-scope label { display: flex; align-items: center; gap: 6px; }
.category-scope input, .confirm-check input { width: 18px; height: 18px; }
.advanced-toggle { width: fit-content; padding: 6px 0; border: 0; color: #0f6b4b; background: transparent; font-weight: 800; cursor: pointer; }
.advanced-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; border: 1px solid #e4e7ec; background: #f8fafc; }
.confirm-check { display: flex; align-items: flex-start; gap: 8px; padding: 10px; border: 1px solid #f0c36a; color: #7a4d00; background: #fff9e8; font-size: 12px; }
.admin-dialog-backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 20px; background: rgb(15 23 42 / 45%); }
.admin-dialog { width: min(560px, 100%); max-height: calc(100vh - 40px); overflow-y: auto; border-radius: 7px; background: #fff; box-shadow: 0 18px 50px rgb(15 23 42 / 20%); }
.admin-dialog > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px; border-bottom: 1px solid #e4e7ec; }
.admin-dialog h2 { margin: 0; font-size: 18px; }
.admin-dialog header p { margin: 4px 0 0; color: #667085; font-size: 12px; }
.admin-dialog form { display: grid; gap: 14px; padding: 18px 20px 20px; }
.admin-dialog footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
.form-field small { color: #667085; font-size: 11px; }

@media (max-width: 860px) {
  .today-stats { grid-template-columns: 1fr 1fr; }
  .today-stats div:nth-child(2) { border-right: 0; }
  .today-stats div:nth-child(-n + 2) { border-bottom: 1px solid #e4e7ec; }
  .issue-item__main { grid-template-columns: 100px minmax(0, 1fr); }
  .issue-item__main .status-chip, .issue-item__main .row-actions { justify-self: start; }
  .run-list div { grid-template-columns: 1fr; gap: 3px; }
}

@media (max-width: 620px) {
  .admin-tabs { gap: 14px; overflow-x: auto; }
  .page-header, .today-result, .action-row { align-items: flex-start; flex-direction: column; }
  .today-result .admin-button, .action-row .admin-button { width: 100%; }
  .today-stats { grid-template-columns: 1fr; }
  .today-stats div { border-right: 0; border-bottom: 1px solid #e4e7ec; }
  .today-stats div:last-child { border-bottom: 0; }
  .issue-item__main { grid-template-columns: 1fr; }
  .row-actions { justify-content: flex-start; flex-wrap: wrap; }
  .technical-detail, .advanced-grid { grid-template-columns: 1fr; }
  .technical-detail .detail-wide { grid-column: auto; }
  .history-filters { align-items: stretch; flex-direction: column; }
  .history-filters .admin-button { width: 100%; }
}
</style>
