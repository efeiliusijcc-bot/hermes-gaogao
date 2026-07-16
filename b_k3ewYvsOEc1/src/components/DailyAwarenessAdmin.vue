<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  getDailyAwarenessAdminConfig,
  getDailyAwarenessAdminInbox,
  getDailyAwarenessAdminRuns,
  getDailyAwarenessAdminStatus,
  regenerateDailyAwareness,
  reprocessDailyAwarenessInbox,
  updateDailyAwarenessAdminConfig,
} from '../lib/api.js'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

const loading = ref(false)
const savingConfig = ref(false)
const regenerating = ref(false)
const reprocessingEventId = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')
const status = ref(null)
const runs = ref([])
const runsTotal = ref(0)
const inboxItems = ref([])
const inboxTotal = ref(0)
const activeView = ref('overview')

const configForm = reactive({
  lookbackHours: 24,
  maxArticles: 50,
  categoryScopeText: '',
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

const runFilters = reactive({
  businessDate: '',
  status: '',
  triggerType: '',
})

const inboxStatus = ref('DEAD_LETTER')
const permissions = computed(() => Array.isArray(props.currentUser?.permissions) ? props.currentUser.permissions : [])
const canManage = computed(() => permissions.value.includes('system:daily-awareness:manage'))
const statusItems = computed(() => [
  { label: '业务日期', value: statusField('business_date', 'businessDate') || '--' },
  { label: '数据状态', value: statusField('data_status', 'dataStatus') || 'WAITING' },
  { label: '生成状态', value: statusField('generation_status', 'generationStatus') || 'WAITING' },
  { label: '质量状态', value: statusField('quality_status', 'qualityStatus') || '--' },
])

onMounted(() => {
  if (canManage.value) void loadAll()
})

async function loadAll() {
  loading.value = true
  clearMessages()
  try {
    const [statusResult, configResult, runResult, inboxResult] = await Promise.all([
      getDailyAwarenessAdminStatus(),
      getDailyAwarenessAdminConfig(),
      getDailyAwarenessAdminRuns({ page: 1, pageSize: 30 }),
      getDailyAwarenessAdminInbox({ page: 1, pageSize: 30, status: inboxStatus.value }),
    ])
    status.value = statusResult || null
    applyConfig(configResult)
    applyRuns(runResult)
    applyInbox(inboxResult)
  } catch (error) {
    setError(error)
  } finally {
    loading.value = false
  }
}

async function loadRuns() {
  loading.value = true
  clearMessages()
  try {
    applyRuns(await getDailyAwarenessAdminRuns({ page: 1, pageSize: 50, ...runFilters }))
  } catch (error) {
    setError(error)
  } finally {
    loading.value = false
  }
}

async function loadInbox() {
  loading.value = true
  clearMessages()
  try {
    applyInbox(await getDailyAwarenessAdminInbox({ page: 1, pageSize: 50, status: inboxStatus.value }))
  } catch (error) {
    setError(error)
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  if (savingConfig.value) return
  savingConfig.value = true
  clearMessages()
  try {
    const result = await updateDailyAwarenessAdminConfig({
      lookbackHours: Number(configForm.lookbackHours),
      maxArticles: Number(configForm.maxArticles),
      categoryScope: configForm.categoryScopeText.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
      maxRetryCount: Number(configForm.maxRetryCount),
      retryIntervalSeconds: Number(configForm.retryIntervalSeconds),
      summaryMaxChars: Number(configForm.summaryMaxChars),
      version: Number(configForm.version),
    })
    applyConfig(result)
    noticeMessage.value = `配置已保存，当前版本 v${configForm.version}。`
  } catch (error) {
    setError(error)
  } finally {
    savingConfig.value = false
  }
}

async function submitRegeneration() {
  if (regenerating.value) return
  if (!manualForm.reason.trim()) {
    errorMessage.value = '请填写补生成原因。'
    return
  }
  if (!manualForm.confirmOverwrite) {
    errorMessage.value = '请明确确认允许覆盖该业务日期已有的全局简报。'
    return
  }
  regenerating.value = true
  clearMessages()
  try {
    const result = await regenerateDailyAwareness({
      businessDate: manualForm.businessDate,
      reason: manualForm.reason.trim(),
      confirmOverwrite: manualForm.confirmOverwrite,
    })
    const runId = result?.runId || '--'
    manualForm.reason = ''
    manualForm.confirmOverwrite = false
    await loadRuns()
    noticeMessage.value = `补生成任务已进入队列：${runId}`
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
    await Promise.all([loadInbox(), loadRuns()])
    noticeMessage.value = `事件 ${item.eventId} 已转为待重试。`
  } catch (error) {
    setError(error)
  } finally {
    reprocessingEventId.value = ''
  }
}

function applyConfig(value) {
  if (!value) return
  configForm.lookbackHours = Number(value.lookbackHours || 24)
  configForm.maxArticles = Number(value.maxArticles || 50)
  configForm.categoryScopeText = Array.isArray(value.categoryScope) ? value.categoryScope.join('，') : ''
  configForm.maxRetryCount = Number(value.maxRetryCount ?? 3)
  configForm.retryIntervalSeconds = Number(value.retryIntervalSeconds || 30)
  configForm.summaryMaxChars = Number(value.summaryMaxChars || 1200)
  configForm.version = Number(value.version || 1)
  configForm.updatedAt = value.updatedAt || ''
  configForm.updatedBy = value.updatedBy || ''
}

function applyRuns(value) {
  runs.value = Array.isArray(value?.items) ? value.items : []
  runsTotal.value = Number(value?.total || 0)
}

function applyInbox(value) {
  inboxItems.value = Array.isArray(value?.items) ? value.items : []
  inboxTotal.value = Number(value?.total || 0)
}

function statusField(snakeKey, camelKey) {
  return status.value?.[snakeKey] ?? status.value?.[camelKey] ?? ''
}

function switchView(view) {
  activeView.value = view
  clearMessages()
  if (view === 'runs') void loadRuns()
  if (view === 'inbox') void loadInbox()
}

function setError(error) {
  const code = String(error?.data?.code || '')
  if (code === 'DAILY_AWARENESS_CONFIG_VERSION_CONFLICT') {
    errorMessage.value = '配置已被其他管理员更新，请刷新后再提交。'
    return
  }
  if (error?.status === 409) {
    errorMessage.value = '同一业务日期已有任务执行中，请稍后再试。'
    return
  }
  errorMessage.value = error instanceof Error ? error.message : String(error)
}

function clearMessages() {
  errorMessage.value = ''
  noticeMessage.value = ''
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('zh-CN', { hour12: false })
}

function today() {
  const date = new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}
</script>

<template>
  <section class="daily-admin">
    <div v-if="!canManage" class="admin-empty">当前账号没有动态感知管理权限。</div>
    <template v-else>
      <nav class="admin-tabs" aria-label="动态感知管理视图">
        <button type="button" :class="{ active: activeView === 'overview' }" @click="switchView('overview')">运行状态与配置</button>
        <button type="button" :class="{ active: activeView === 'runs' }" @click="switchView('runs')">运行记录</button>
        <button type="button" :class="{ active: activeView === 'inbox' }" @click="switchView('inbox')">死信 Inbox</button>
      </nav>

      <div v-if="errorMessage" class="admin-message error">{{ errorMessage }}</div>
      <div v-if="noticeMessage" class="admin-message success">{{ noticeMessage }}</div>

      <template v-if="activeView === 'overview'">
        <section class="admin-section">
          <header class="section-header">
            <div><span>STATUS</span><h2>运行状态</h2></div>
            <button class="admin-button" type="button" :disabled="loading" @click="loadAll">{{ loading ? '刷新中...' : '刷新' }}</button>
          </header>
          <div class="status-grid">
            <div v-for="item in statusItems" :key="item.label"><span>{{ item.label }}</span><strong>{{ item.value }}</strong></div>
          </div>
          <dl class="status-detail">
            <div><dt>最近运行</dt><dd>{{ statusField('last_run_id', 'lastRunId') || '--' }}</dd></div>
            <div><dt>当前简报</dt><dd>{{ statusField('current_brief_id', 'currentBriefId') || '--' }}</dd></div>
            <div><dt>最近错误</dt><dd>{{ statusField('last_error_message', 'lastErrorMessage') || '--' }}</dd></div>
          </dl>
        </section>

        <section class="admin-section">
          <header class="section-header">
            <div><span>CONFIG v{{ configForm.version }}</span><h2>版本化配置</h2></div>
            <small>更新于 {{ formatTime(configForm.updatedAt) }}</small>
          </header>
          <form class="config-form" @submit.prevent="saveConfig">
            <label><span>回溯小时</span><input v-model.number="configForm.lookbackHours" type="number" min="1" max="168" required /></label>
            <label><span>最大文章数</span><input v-model.number="configForm.maxArticles" type="number" min="1" max="3000" required /></label>
            <label><span>模型重试次数</span><input v-model.number="configForm.maxRetryCount" type="number" min="0" max="10" required /></label>
            <label><span>重试间隔（秒）</span><input v-model.number="configForm.retryIntervalSeconds" type="number" min="1" max="3600" required /></label>
            <label><span>摘要长度上限</span><input v-model.number="configForm.summaryMaxChars" type="number" min="100" max="10000" required /></label>
            <label class="wide"><span>分类范围（逗号分隔）</span><input v-model="configForm.categoryScopeText" type="text" /></label>
            <div class="form-actions"><button class="admin-button primary" type="submit" :disabled="savingConfig">{{ savingConfig ? '保存中...' : '保存配置' }}</button></div>
          </form>
        </section>

        <section class="admin-section">
          <header class="section-header"><div><span>MANUAL</span><h2>手动补生成</h2></div></header>
          <form class="manual-form" @submit.prevent="submitRegeneration">
            <label><span>业务日期</span><input v-model="manualForm.businessDate" type="date" required /></label>
            <label class="wide"><span>操作原因</span><textarea v-model="manualForm.reason" rows="3" maxlength="500" required></textarea></label>
            <label class="overwrite-check">
              <input v-model="manualForm.confirmOverwrite" type="checkbox" />
              <span>我确认允许覆盖该业务日期已有的成功全局简报</span>
            </label>
            <div class="form-actions"><button class="admin-button danger" type="submit" :disabled="regenerating">{{ regenerating ? '提交中...' : '提交补生成' }}</button></div>
          </form>
        </section>
      </template>

      <section v-else-if="activeView === 'runs'" class="admin-section">
        <header class="section-header"><div><span>RUNS</span><h2>运行记录</h2></div><strong>{{ runsTotal }} 条</strong></header>
        <form class="filter-bar" @submit.prevent="loadRuns">
          <input v-model="runFilters.businessDate" type="date" aria-label="按业务日期筛选" />
          <select v-model="runFilters.status" aria-label="按运行状态筛选"><option value="">全部状态</option><option value="SUCCESS">SUCCESS</option><option value="FAILED">FAILED</option><option value="NO_DATA">NO_DATA</option><option value="GENERATING">GENERATING</option></select>
          <select v-model="runFilters.triggerType" aria-label="按触发方式筛选"><option value="">全部触发方式</option><option value="EVENT">EVENT</option><option value="INBOX_REPROCESS">INBOX_REPROCESS</option><option value="MANUAL">MANUAL</option></select>
          <button class="admin-button" type="submit" :disabled="loading">查询</button>
        </form>
        <div class="table-wrap">
          <table><thead><tr><th>业务日期</th><th>触发方式</th><th>状态</th><th>尝试</th><th>质量</th><th>材料</th><th>开始时间</th><th>错误</th></tr></thead>
          <tbody><tr v-for="run in runs" :key="run.id"><td>{{ run.businessDate }}</td><td>{{ run.triggerType }}</td><td><span class="status-chip">{{ run.status }}</span></td><td>{{ run.attemptNo }}</td><td>{{ run.qualityStatus || '--' }}</td><td>{{ run.sourceCount }}</td><td>{{ formatTime(run.startedAt || run.createdAt) }}</td><td class="error-cell">{{ run.errorMessage || '--' }}</td></tr></tbody></table>
          <div v-if="!loading && !runs.length" class="admin-empty">暂无运行记录。</div>
        </div>
      </section>

      <section v-else class="admin-section">
        <header class="section-header"><div><span>INBOX</span><h2>死信与事件重处理</h2></div><strong>{{ inboxTotal }} 条</strong></header>
        <form class="filter-bar" @submit.prevent="loadInbox">
          <select v-model="inboxStatus" aria-label="按 Inbox 状态筛选"><option value="DEAD_LETTER">死信</option><option value="RETRY_PENDING">待重试</option><option value="PROCESSING">处理中</option><option value="PROCESSED">已处理</option><option value="">全部状态</option></select>
          <button class="admin-button" type="submit" :disabled="loading">查询</button>
        </form>
        <div class="table-wrap">
          <table><thead><tr><th>事件</th><th>业务日期</th><th>批次</th><th>状态</th><th>尝试</th><th>更新时间</th><th>错误</th><th>操作</th></tr></thead>
          <tbody><tr v-for="item in inboxItems" :key="item.eventId"><td class="id-cell">{{ item.eventId }}</td><td>{{ item.businessDate }}</td><td>{{ item.batchId }}</td><td><span class="status-chip">{{ item.status }}</span></td><td>{{ item.attemptCount }}</td><td>{{ formatTime(item.updatedAt) }}</td><td class="error-cell">{{ item.errorMessage || '--' }}</td><td><button v-if="item.status === 'DEAD_LETTER'" class="admin-button" type="button" :disabled="Boolean(reprocessingEventId)" @click="reprocess(item)">{{ reprocessingEventId === item.eventId ? '处理中...' : '重新处理' }}</button><span v-else>--</span></td></tr></tbody></table>
          <div v-if="!loading && !inboxItems.length" class="admin-empty">当前筛选下没有 Inbox 事件。</div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.daily-admin { color: #172033; }
.admin-tabs { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid #dfe4eb; }
.admin-tabs button { min-height: 40px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; color: #667085; background: transparent; font-weight: 700; cursor: pointer; }
.admin-tabs button.active { border-bottom-color: #0f6b4b; color: #0f6b4b; }
.admin-section { margin-top: 14px; padding: 20px; border: 1px solid #dfe4eb; border-radius: 7px; background: #fff; }
.section-header { display: flex; justify-content: space-between; align-items: center; gap: 18px; margin-bottom: 16px; }
.section-header span { color: #0f6b4b; font-size: 11px; font-weight: 800; }
.section-header h2 { margin: 3px 0 0; font-size: 18px; letter-spacing: 0; }
.section-header small { color: #667085; }
.status-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid #e1e6ed; }
.status-grid > div { min-height: 70px; padding: 12px; display: flex; flex-direction: column; justify-content: center; gap: 7px; border-right: 1px solid #e1e6ed; }
.status-grid > div:last-child { border-right: 0; }
.status-grid span, .config-form label > span, .manual-form label > span { color: #667085; font-size: 12px; }
.status-grid strong { overflow-wrap: anywhere; }
.status-detail { margin: 14px 0 0; display: grid; gap: 8px; }
.status-detail div { display: grid; grid-template-columns: 100px minmax(0, 1fr); font-size: 13px; }
.status-detail dt { color: #667085; }
.status-detail dd { margin: 0; overflow-wrap: anywhere; }
.config-form, .manual-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.config-form label, .manual-form label { display: flex; flex-direction: column; gap: 6px; }
.config-form input, .manual-form input, .manual-form textarea, .filter-bar input, .filter-bar select { min-height: 38px; padding: 8px 10px; border: 1px solid #ccd4df; border-radius: 5px; color: #172033; background: #fff; box-sizing: border-box; font: inherit; }
.manual-form textarea { min-height: 82px; resize: vertical; }
.config-form .wide, .manual-form .wide { grid-column: span 2; }
.overwrite-check { grid-column: 1 / -1; flex-direction: row !important; align-items: center; padding: 10px; border: 1px solid #f0c36a; background: #fff9e8; }
.overwrite-check input { width: 18px; min-height: 18px; }
.overwrite-check span { color: #7a4d00 !important; }
.form-actions { display: flex; justify-content: flex-end; align-items: flex-end; }
.admin-button { min-height: 36px; padding: 0 12px; border: 1px solid #ccd4df; border-radius: 5px; color: #344054; background: #fff; font-weight: 700; cursor: pointer; }
.admin-button.primary { border-color: #0f6b4b; color: #fff; background: #0f6b4b; }
.admin-button.danger { border-color: #b42318; color: #fff; background: #b42318; }
.admin-button:disabled { cursor: not-allowed; opacity: 0.55; }
.admin-message { margin: 10px 0; padding: 10px 12px; border-radius: 5px; font-size: 13px; }
.admin-message.error { color: #991b1b; background: #fee2e2; }
.admin-message.success { color: #166534; background: #dcfce7; }
.filter-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.table-wrap { width: 100%; overflow-x: auto; }
table { width: 100%; min-width: 900px; border-collapse: collapse; font-size: 12px; }
th, td { padding: 10px; border-bottom: 1px solid #e4e7ec; text-align: left; vertical-align: top; }
th { color: #667085; background: #f7f9fb; font-weight: 700; }
.status-chip { display: inline-block; padding: 3px 6px; border-radius: 4px; color: #175cd3; background: #eff8ff; font-weight: 700; }
.id-cell { max-width: 220px; overflow-wrap: anywhere; }
.error-cell { max-width: 260px; color: #667085; overflow-wrap: anywhere; }
.admin-empty { padding: 36px 20px; color: #667085; text-align: center; }
@media (max-width: 820px) {
  .status-grid { grid-template-columns: 1fr 1fr; }
  .status-grid > div:nth-child(2) { border-right: 0; }
  .status-grid > div:nth-child(-n + 2) { border-bottom: 1px solid #e1e6ed; }
  .config-form, .manual-form { grid-template-columns: 1fr; }
  .config-form .wide, .manual-form .wide { grid-column: auto; }
  .form-actions { justify-content: flex-start; }
}
</style>
