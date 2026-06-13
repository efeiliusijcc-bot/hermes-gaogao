<script setup>
import NexusHeader from './components/NexusHeader.vue'
import ControlPanel from './components/ControlPanel.vue'
import DataCanvas from './components/DataCanvas.vue'
import { useReportJobs } from './composables/useReportJobs.js'
import { computed, ref, watch } from 'vue'

const {
  currentView,
  title,
  reportType,
  countryOrRegion,
  currentPosition,
  scenario,
  targetCity,
  visitTime,
  contextText,
  parameterValues,
  activeParameters,
  outputDepth,
  isGenerating,
  isPlanning,
  reportPlan,
  planStepIndex,
  planSelections,
  planSearchSelections,
  planSourceInput,
  planSupplement,
  databaseSourceEnabled,
  databaseSources,
  databaseSourcesLoading,
  planError,
  generatedHtml,
  phase,
  processLogs,
  loadingStep,
  job,
  recentJobs,
  recentLoadingMore,
  recentHasMore,
  recentLoadError,
  health,
  errorMessage,
  detailLoading,
  detailLoadError,
  filteredJobs,
  openedHistoryJobId,
  listSearch,
  listPage,
  listPageSize,
  listTotal,
  listTotalPages,
  isHistoryMode,
  hasActiveWorkspace,
  activeWorkspaceJobId,
  activeWorkspaceStatus,
  returnableWorkspaceJobId,
  savedNotice,
  executionLogs,
  progressState,
  unreadLogCount,
  isLogDrawerOpen,
  vectorSourceStatus,
  vectorSourceStatusLoading,
  getJobTitle,
  handleGenerate,
  confirmReportPlan,
  cancelReportPlan,
  togglePlanOption,
  addPlanOption,
  togglePlanSearchQuery,
  nextPlanStep,
  prevPlanStep,
  refreshHealth,
  refreshRecentReports,
  loadMoreRecentReports,
  loadJobList,
  updateListSearch,
  updateListPage,
  updateListPageSize,
  monitorJobFromList,
  retryOpenCurrentHistoryReport,
  showGenerator,
  backgroundActiveWorkspace,
  resetForNewReport,
  saveCurrentReportDraft,
  toggleLogDrawer,
} = useReportJobs()

const QA_HISTORY_KEY = 'nexus-qa-history'
const homeMode = ref('report')
const selectedQaSessionId = ref('')
const qaSessions = ref(loadStoredQaSessions())

const selectedQaSession = computed(() => {
  return qaSessions.value.find((session) => session.id === selectedQaSessionId.value) || null
})

const qaTotal = computed(() => {
  return qaSessions.value.reduce((total, session) => total + countQaSessionTurns(session), 0)
})

const hasGeneratingWorkspace = computed(() => {
  return Boolean(activeWorkspaceJobId.value) && (
    phase.value === 'loading' ||
    isGenerating.value ||
    activeWorkspaceStatus.value === 'running' ||
    activeWorkspaceStatus.value === 'queued'
  )
})

const hasReturnableWorkspace = computed(() => {
  return Boolean(returnableWorkspaceJobId.value)
})

const sidebarCurrentJobId = computed(() => {
  return openedHistoryJobId.value || job.value?.jobId || activeWorkspaceJobId.value
})

function loadStoredQaSessions() {
  try {
    const raw = localStorage.getItem(QA_HISTORY_KEY)
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, 30) : []
  } catch {
    return []
  }
}

function persistQaSessions() {
  try {
    localStorage.setItem(QA_HISTORY_KEY, JSON.stringify(qaSessions.value.slice(0, 30)))
  } catch {
    // Local storage is best-effort; the current in-memory session still works.
  }
}

function countQaSessionTurns(session) {
  if (Array.isArray(session?.turns) && session.turns.length) {
    return session.turns.filter((turn) => {
      return String(turn?.question || turn?.answer || '').trim()
    }).length
  }
  return String(session?.question || session?.answer || '').trim() ? 1 : 0
}

function setHomeMode(mode) {
  if (mode === 'qa') backgroundActiveWorkspace()
  homeMode.value = mode === 'qa' ? 'qa' : 'report'
  if (homeMode.value === 'report') selectedQaSessionId.value = ''
}

function upsertQaSession(session) {
  if (!session?.id) return
  const { select, ...sessionData } = session
  const current = qaSessions.value.find((item) => item.id === session.id)
  const next = {
    ...current,
    ...sessionData,
    updatedAt: sessionData.updatedAt || new Date().toISOString(),
  }
  qaSessions.value = [
    next,
    ...qaSessions.value.filter((item) => item.id !== session.id),
  ].slice(0, 30)
  if (select !== false) selectedQaSessionId.value = session.id
}

function openQaSession(session) {
  if (!session?.id) return
  backgroundActiveWorkspace()
  homeMode.value = 'qa'
  selectedQaSessionId.value = session.id
}

function openReportJob(item) {
  homeMode.value = 'report'
  selectedQaSessionId.value = ''
  monitorJobFromList(item)
}

function startQaFromSidebar() {
  backgroundActiveWorkspace()
  homeMode.value = 'qa'
  selectedQaSessionId.value = ''
}

function clearSelectedQaSession() {
  selectedQaSessionId.value = ''
}

function startReportFromSidebar() {
  homeMode.value = 'report'
  selectedQaSessionId.value = ''
}

function openReportHistoryList() {
  homeMode.value = 'report'
  selectedQaSessionId.value = ''
  loadJobList(true)
}

function resetForNewReportFromCanvas() {
  homeMode.value = 'report'
  selectedQaSessionId.value = ''
  resetForNewReport()
}

function returnHome() {
  homeMode.value = 'report'
  selectedQaSessionId.value = ''
  resetForNewReport()
}

watch(qaSessions, persistQaSessions, { deep: true })

function jobStatusType(status) {
  if (status === 'succeeded') return 'success'
  if (status === 'failed' || status === 'cancelled' || status === 'waiting_approval') return 'failed'
  return 'running'
}

function jobStatusLabel(status) {
  const type = jobStatusType(status)
  if (type === 'success') return '成功'
  if (type === 'failed') return '失败'
  return '生成中'
}

function jobStatusClass(status) {
  const type = jobStatusType(status)
  if (type === 'success') return 'text-neon-green'
  if (type === 'failed') return 'text-red-300'
  return 'text-cyber-yellow'
}

function jobActionLabel(status) {
  const type = jobStatusType(status)
  if (type === 'success') return '查看报告'
  if (type === 'failed') return '查看错误'
  return '查看状态'
}
</script>

<template>
  <div class="app-shell min-h-screen grid-bg relative">
    <div class="crt-overlay"></div>
    <div class="crt-scanline"></div>

    <NexusHeader @return-home="returnHome" />

    <div v-if="currentView === 'generator'" class="app-body">
      <ControlPanel
        :health="health"
        :mode="homeMode"
        :jobs="filteredJobs"
        :recentJobs="recentJobs"
        :qaSessions="qaSessions"
        :reportTotal="listTotal"
        :qaTotal="qaTotal"
        :recentLoadingMore="recentLoadingMore"
        :recentHasMore="recentHasMore"
        :recentLoadError="recentLoadError"
        :currentJobId="sidebarCurrentJobId"
        :currentQaSessionId="selectedQaSessionId"
        @open-job="openReportJob"
        @open-qa-session="openQaSession"
        @start-qa="startQaFromSidebar"
        @start-report="startReportFromSidebar"
        @refresh-health="refreshHealth"
        @open-history-list="openReportHistoryList"
        @load-more-recent="loadMoreRecentReports"
      />

      <DataCanvas
        v-model:title="title"
        v-model:reportType="reportType"
        v-model:contextText="contextText"
        v-model:parameterValues="parameterValues"
        v-model:activeParameters="activeParameters"
        :homeMode="homeMode"
        :selectedQaSession="selectedQaSession"
        :qaSessions="qaSessions"
        :phase="phase"
        :loadingStep="loadingStep"
        :processLogs="processLogs"
        :generatedHtml="generatedHtml"
        :reportType="reportType"
        :job="job"
        :jobList="filteredJobs"
        :health="health"
        :errorMessage="errorMessage"
        :detailLoading="detailLoading"
        :detailLoadError="detailLoadError"
        :isHistoryMode="isHistoryMode"
        :isGenerating="isGenerating"
        :isPlanning="isPlanning"
        :reportPlan="reportPlan"
        :planStepIndex="planStepIndex"
        :planSelections="planSelections"
        :planSearchSelections="planSearchSelections"
        v-model:planSourceInput="planSourceInput"
        v-model:planSupplement="planSupplement"
        v-model:databaseSourceEnabled="databaseSourceEnabled"
        :planError="planError"
        :executionLogs="executionLogs"
        :progress-state="progressState"
        :databaseSources="databaseSources"
        :databaseSourcesLoading="databaseSourcesLoading"
        :vectorSourceStatus="vectorSourceStatus"
        :vectorSourceStatusLoading="vectorSourceStatusLoading"
        :unreadLogCount="unreadLogCount"
        :isLogDrawerOpen="isLogDrawerOpen"
        :hasReturnableWorkspace="hasReturnableWorkspace"
        @generate="handleGenerate"
        @confirm-plan="confirmReportPlan"
        @cancel-plan="cancelReportPlan"
        @toggle-plan-option="togglePlanOption"
        @add-plan-option="addPlanOption"
        @toggle-plan-search-query="togglePlanSearchQuery"
        @next-plan-step="nextPlanStep"
        @prev-plan-step="prevPlanStep"
        @update:homeMode="setHomeMode"
        @qa-session-upsert="upsertQaSession"
        @qa-session-clear-selection="clearSelectedQaSession"
        @list="loadJobList"
        @new-report="resetForNewReportFromCanvas"
        @retry-history-report="retryOpenCurrentHistoryReport"
        @show-active-workspace="showGenerator"
        @toggle-log-drawer="toggleLogDrawer"
      />
    </div>

    <main v-else class="archive-main">
      <div class="archive-content">
      <div class="archive-header flex items-center justify-between mb-6">
        <div>
          <div class="neon-text font-mono text-xl font-bold tracking-widest">报告档案库</div>
          <div class="font-mono text-[10px] text-[#374151] mt-1">真实后端任务列表 / 点击查看已生成报告</div>
        </div>
        <div class="archive-actions flex gap-2">
          <button
            v-if="hasActiveWorkspace"
            class="sci-btn text-[10px] px-3 py-2"
            :class="hasGeneratingWorkspace ? 'border-neon-green text-neon-green shadow-[0_0_18px_rgba(0,255,159,0.18)]' : ''"
            @click="showGenerator"
          >
            {{ hasGeneratingWorkspace ? '返回生成编报' : '返回当前编报' }}
          </button>
          <button class="sci-btn text-[10px] px-3 py-2" @click="resetForNewReport">新建编报</button>
          <button class="sci-btn text-[10px] px-3 py-2" @click="loadJobList(false)">刷新列表</button>
        </div>
      </div>

      <div class="panel p-4 mb-6 archive-filter-panel">
        <div class="archive-search-only">
          <div class="relative flex-1">
            <input
              :value="listSearch"
              class="sci-input w-full px-4 py-3 pr-10 font-mono text-sm focus:outline-none"
              placeholder="搜索标题 / 任务编号 / 上下文关键词"
              @input="updateListSearch($event.target.value)"
            />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-slate-400">SEARCH</span>
          </div>
        </div>
      </div>

      <div class="panel overflow-hidden archive-table-panel">
        <div class="archive-table-head grid grid-cols-12 gap-4 px-4 py-3 border-b border-border-glow bg-neon-cyan/5">
          <div class="col-span-2 font-mono text-[10px] text-[#374151] font-bold tracking-widest" style="font-size: 13px">任务编号</div>
          <div class="col-span-4 font-mono text-[10px] text-[#374151] font-bold tracking-widest" style="font-size: 13px">主题</div>
          <div class="col-span-2 font-mono text-[10px] text-[#374151] font-bold tracking-widest" style="font-size: 13px">状态</div>
          <div class="col-span-2 font-mono text-[10px] text-[#374151] font-bold tracking-widest" style="font-size: 13px">更新时间</div>
          <div class="col-span-1 font-mono text-[10px] text-[#374151] font-bold tracking-widest" style="font-size: 13px">文件</div>
          <div class="col-span-1 font-mono text-[10px] text-[#374151] font-bold tracking-widest" style="font-size: 13px">操作</div>
        </div>

        <div v-if="filteredJobs.length">
          <div
            v-for="item in filteredJobs"
            :key="item.jobId"
            class="archive-row grid grid-cols-12 gap-4 px-4 py-4 border-b border-neon-cyan/10 hover:bg-neon-cyan/5 transition-colors"
          >
            <div class="col-span-2 font-mono text-xs text-[#1f2937]" style="font-size: 14px; font-weight: 500; line-height: 1.7">{{ item.jobId.slice(0, 8) }}</div>
            <div class="col-span-4 font-mono text-xs text-[#111827] font-semibold truncate" style="font-size: 14px; font-weight: 500; line-height: 1.7">{{ getJobTitle(item) }}</div>
            <div class="col-span-2 font-mono text-xs" :class="jobStatusClass(item.status)">
              {{ jobStatusLabel(item.status) }}
            </div>
            <div class="col-span-2 font-mono text-xs text-[#374151]" style="font-size: 14px; font-weight: 500; line-height: 1.7">{{ item.updatedAt || item.createdAt }}</div>
            <div class="col-span-1 font-mono text-xs text-[#374151] truncate" style="font-size: 14px; font-weight: 500; line-height: 1.7">{{ item.resultPath ? '已生成' : '未生成' }}</div>
            <div class="col-span-1">
              <button
                class="font-mono text-[10px] hover:text-neon-green disabled:opacity-30"
                style="color: #0369a1; font-weight: 700"
                @click="monitorJobFromList(item)"
              >
                {{ jobActionLabel(item.status) }}
              </button>
            </div>
          </div>
        </div>

        <div v-else class="py-16 text-center">
          <div class="font-mono text-4xl mb-4" style="color: #94a3b8">{{ listSearch ? 'NO MATCH' : 'NO DATA' }}</div>
          <div class="font-mono text-sm text-slate-400">
            {{ listSearch ? '未找到匹配编报' : '暂无报告任务' }}
          </div>
        </div>
      </div>

      <div class="panel mt-4 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div class="font-mono text-[10px] text-[#374151]">
          第 {{ listPage }} / {{ listTotalPages }} 页 · 共 {{ listTotal }} 条
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <select
            class="sci-input px-3 py-2 font-mono text-[10px] focus:outline-none"
            :value="listPageSize"
            @change="updateListPageSize($event.target.value)"
          >
            <option value="10">10 条/页</option>
            <option value="20">20 条/页</option>
            <option value="50">50 条/页</option>
            <option value="100">100 条/页</option>
          </select>
          <button class="sci-btn text-[10px] px-3 py-2" :disabled="listPage <= 1" @click="updateListPage(listPage - 1)">上一页</button>
          <button class="sci-btn text-[10px] px-3 py-2" :disabled="listPage >= listTotalPages" @click="updateListPage(listPage + 1)">下一页</button>
        </div>
      </div>
      </div>
    </main>
  </div>
</template>
