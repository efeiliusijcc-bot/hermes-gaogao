<script setup>
import { computed } from 'vue'

const props = defineProps({
  health: Object,
  mode: {
    type: String,
    default: 'report',
  },
  jobs: {
    type: Array,
    default: () => [],
  },
  recentJobs: {
    type: Array,
    default: () => [],
  },
  recentLoadingMore: Boolean,
  recentHasMore: {
    type: Boolean,
    default: true,
  },
  recentLoadError: String,
  currentJobId: String,
  qaSessions: {
    type: Array,
    default: () => [],
  },
  reportTotal: {
    type: Number,
    default: 0,
  },
  qaTotal: {
    type: Number,
    default: 0,
  },
  currentQaSessionId: String,
})

const emit = defineEmits(['open-job', 'open-qa-session', 'start-qa', 'start-report', 'refresh-health', 'open-history-list', 'load-more-recent'])

const hasHealth = computed(() => Boolean(props.health))
const healthOk = computed(() => Boolean(props.health?.ok))
const engineStatus = computed(() => {
  return healthOk.value ? '正常' : '--'
})
const engineText = computed(() => {
  if (!hasHealth.value) return '正在连接 AI 引擎'
  return healthOk.value ? '系统运行良好' : props.health?.details?.[0] || '服务连接异常'
})
const reportTotalText = computed(() => Number(props.reportTotal || 0).toLocaleString('zh-CN'))
const qaTotalText = computed(() => Number(props.qaTotal || 0).toLocaleString('zh-CN'))
const recentJobs = computed(() => props.recentJobs.length ? props.recentJobs : props.jobs)
const isQaMode = computed(() => props.mode === 'qa')
const historyTitle = computed(() => isQaMode.value ? '问答历史' : '编报历史')
const historySubtitle = computed(() => isQaMode.value ? 'QA HISTORY' : 'REPORT HISTORY')
const historyActionLabel = computed(() => isQaMode.value ? '查看全部问答' : '查看全部报告')
const sortedQaSessions = computed(() => {
  return [...props.qaSessions].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
})

function jobTitle(item) {
  return item.displayTitle || item.payload?.topic || item.payload?.target_name || item.payload?.target_country || item.jobId
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function statusClass(status) {
  if (status === 'succeeded') return 'bg-neon-green shadow-[0_0_8px_rgba(0,255,136,0.38)]'
  if (status === 'failed' || status === 'cancelled') return 'bg-red-300 shadow-[0_0_8px_rgba(252,90,122,0.35)]'
  if (status === 'waiting_approval') return 'bg-cyber-yellow shadow-[0_0_8px_rgba(252,238,10,0.32)]'
  return 'bg-blue-500 shadow-[0_0_8px_rgba(37,99,235,0.32)]'
}

function isRunningStatus(status) {
  return status === 'running' || status === 'queued'
}

function progressStageKey(item) {
  const currentStage = item?.progressState?.currentStage
  if (currentStage) return currentStage

  const stages = Array.isArray(item?.progressState?.stages) ? item.progressState.stages : []
  return stages.find((stage) => stage?.status === 'running')?.key || null
}

function statusText(status, item = null) {
  if (status === 'succeeded') return '已完成'
  if (status === 'failed' || status === 'cancelled') return '失败'
  if (status === 'waiting_approval') return '等待报告'
  if (status === 'queued') return '处理中'
  const stageLabels = {
    prepare: '任务规划中',
    source: '任务规划中',
    plan: '任务规划中',
    research: '资料采集中',
    consolidate: '素材整合中',
    report: '报告撰写中',
  }
  return stageLabels[progressStageKey(item)] || '处理中'
}

function qaStatusClass(status) {
  if (status === 'done') return 'bg-neon-green shadow-[0_0_8px_rgba(0,255,136,0.38)]'
  if (status === 'failed') return 'bg-red-300 shadow-[0_0_8px_rgba(252,90,122,0.35)]'
  if (status === 'draft') return 'bg-slate-400'
  return 'bg-blue-500 shadow-[0_0_8px_rgba(37,99,235,0.32)]'
}

function qaStatusText(status) {
  if (status === 'done') return '已回答'
  if (status === 'failed') return '失败'
  if (status === 'draft') return '草稿'
  return '生成中'
}

function qaMeta(session) {
  const sources = session.sourcesCount ? `${session.sourcesCount} 条来源 · ` : ''
  return `${qaStatusText(session.status)} · ${sources}${formatTime(session.updatedAt || session.createdAt)}`
}

function handleRecentScroll(event) {
  if (isQaMode.value) return
  const target = event.currentTarget
  if (!target || props.recentLoadingMore || props.recentLoadError || !props.recentHasMore) return
  if (target.scrollTop + target.clientHeight >= target.scrollHeight - 80) {
    emit('load-more-recent')
  }
}

function handleHistoryAction() {
  if (isQaMode.value) emit('start-qa')
  else emit('open-history-list')
}
</script>

<template>
  <aside class="sidebar-shell w-[312px] shrink-0 flex flex-col p-4 gap-3">
    <section class="panel status-card compact-status-card p-4">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="font-mono text-sm neon-text tracking-widest">AI引擎状态</h2>
          <div class="mt-1 font-mono text-[10px] text-[#374151]">ENGINE STATUS</div>
        </div>
        <button type="button" class="sci-btn text-[10px] px-3 py-1.5" @click.stop="emit('refresh-health')">检测</button>
      </div>

      <div class="flex items-center gap-3 mb-3">
        <div
          class="status-orb w-10 h-10 rounded-xl border flex items-center justify-center text-lg"
          :class="healthOk ? 'border-neon-green/45 text-neon-green shadow-[0_0_22px_rgba(0,255,136,0.16)]' : !hasHealth ? 'border-cyber-yellow/35 text-cyber-yellow shadow-[0_0_18px_rgba(252,238,10,0.12)]' : 'border-red-300/45 text-red-300 shadow-[0_0_18px_rgba(252,90,122,0.14)]'"
        >
          ✓
        </div>
        <div class="min-w-0">
          <div class="font-mono text-[22px] leading-none font-bold" :class="healthOk ? 'text-neon-green' : !hasHealth ? 'text-cyber-yellow' : 'text-red-300'">{{ engineStatus }}</div>
          <div class="font-mono text-[10px] text-slate-300/70 mt-1 truncate">{{ engineText }}</div>
        </div>
      </div>

      <div class="space-y-1.5 border-t border-neon-cyan/10 pt-3">
        <div class="soft-field flex items-center justify-between px-3 py-2">
          <span class="font-mono text-xs text-slate-300/65">当前编报总数</span>
          <span class="font-mono text-xs text-neon-green">{{ reportTotalText }}</span>
        </div>
        <div class="soft-field flex items-center justify-between px-3 py-2">
          <span class="font-mono text-xs text-slate-300/65">问答总数</span>
          <span class="font-mono text-xs text-neon-green">{{ qaTotalText }}</span>
        </div>
      </div>
    </section>

    <section class="panel recent-card flex-1 min-h-0 flex flex-col">
      <div class="panel-header recent-header justify-between px-4 py-4">
        <div>
          <span class="font-mono text-sm neon-text tracking-widest">{{ historyTitle }}</span>
          <div class="mt-1 font-mono text-[10px] text-[#374151]">{{ historySubtitle }}</div>
        </div>
        <button class="sci-btn text-[10px] px-2.5 py-1.5" @click="handleHistoryAction">{{ historyActionLabel }}</button>
      </div>

      <div class="recent-list flex-1 overflow-auto p-3" @scroll="handleRecentScroll">
        <div v-if="!isQaMode && recentJobs.length" class="space-y-2">
          <button
            v-for="item in recentJobs"
            :key="item.jobId"
            class="history-item recent-item w-full text-left rounded-xl px-3.5 py-3.5 transition-all"
            :class="{ active: item.jobId === currentJobId }"
            @click="emit('open-job', item)"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class="recent-title font-mono text-xs truncate">{{ jobTitle(item) }}</span>
              <span class="ml-auto text-[#64748b] shrink-0">›</span>
            </div>
            <div class="recent-time font-mono text-[10px] mt-2 flex items-center gap-1.5">
              <span
                v-if="isRunningStatus(item.status)"
                class="report-status-spinner shrink-0"
                aria-label="任务进行中"
              ></span>
              <span v-else class="w-1.5 h-1.5 rounded-full shrink-0" :class="statusClass(item.status)"></span>
              <span class="recent-status-text">{{ statusText(item.status, item) }}</span>
              <span class="recent-time-divider">·</span>
              <span>{{ formatTime(item.updatedAt || item.createdAt) }}</span>
            </div>
          </button>

          <button
            v-if="recentLoadError"
            type="button"
            class="recent-load-state recent-load-retry w-full"
            @click="emit('load-more-recent')"
          >
            加载失败，点击重试
          </button>
          <div v-else-if="recentLoadingMore" class="recent-load-state">加载中...</div>
          <div v-else-if="!recentHasMore" class="recent-load-state">没有更多了</div>
        </div>

        <div v-else-if="isQaMode && sortedQaSessions.length" class="space-y-2">
          <button
            v-for="session in sortedQaSessions"
            :key="session.id"
            class="history-item recent-item w-full text-left rounded-xl px-3.5 py-3.5 transition-all"
            :class="{ active: session.id === currentQaSessionId }"
            @click="emit('open-qa-session', session)"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="qaStatusClass(session.status)"></span>
              <span class="recent-title font-mono text-xs truncate">{{ session.question || '未命名问答' }}</span>
              <span class="ml-auto text-[#64748b] shrink-0">›</span>
            </div>
            <div class="recent-time font-mono text-[10px] mt-2 pl-3.5">{{ qaMeta(session) }}</div>
            <div v-if="session.answer" class="qa-history-summary pl-3.5 mt-1">{{ session.answer }}</div>
          </button>
        </div>

        <div v-else-if="isQaMode" class="h-full flex items-center justify-center text-center">
          <div class="history-empty-state">
            <div class="font-mono text-3xl mb-2" style="color: #94a3b8">QA</div>
            <div class="font-mono text-xs text-slate-400">暂无问答历史</div>
            <p>完成一次知识问答后，会在这里显示最近记录。</p>
            <button type="button" class="sci-btn text-[10px] px-3 py-2 mt-3" @click="emit('start-qa')">开始提问</button>
          </div>
        </div>

        <div v-else class="h-full flex items-center justify-center text-center">
          <div>
            <div class="font-mono text-3xl mb-2" style="color: #94a3b8">REPORT</div>
            <div class="font-mono text-xs text-slate-400">{{ recentLoadingMore ? '加载中...' : '暂无编报历史' }}</div>
            <p class="history-empty-copy">生成报告后，会在这里显示最近编报任务。</p>
            <button type="button" class="sci-btn text-[10px] px-3 py-2 mt-3" @click="emit('start-report')">开始编写 K报</button>
          </div>
        </div>
      </div>
    </section>
  </aside>
</template>
