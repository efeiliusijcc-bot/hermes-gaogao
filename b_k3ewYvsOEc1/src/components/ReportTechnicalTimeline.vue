<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Braces,
  Circle,
  CircleAlert,
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  ScrollText,
} from '@lucide/vue'
import { sanitizeReportExecutionText } from '../lib/reportExecutionLogs.js'
import { formatTimelineDuration } from '../lib/reportTechnicalTimeline.js'

const props = defineProps({
  groups: {
    type: Array,
    default: () => [],
  },
  emptyText: {
    type: String,
    default: '当前任务暂无可展示进度日志。',
  },
  taskStatus: {
    type: String,
    default: 'waiting',
  },
  taskStartedAt: {
    type: String,
    default: '',
  },
  taskEndedAt: {
    type: String,
    default: '',
  },
})

const workspaceViews = [
  { key: 'overview', label: '概览', icon: LayoutDashboard },
  { key: 'chain', label: '调用链', icon: GitBranch },
  { key: 'io', label: '输入输出', icon: Braces },
  { key: 'logs', label: '日志', icon: ScrollText },
]

const activeStageKey = ref('')
const activeView = ref('overview')
const userSelectedStage = ref(false)
const autoOpenedErrorKey = ref('')
const nowMs = ref(Date.now())
let clockTimer = null

watch(
  () => props.groups.map((group) => `${group.key}:${group.status}:${group.eventCount || 0}`).join('|'),
  () => {
    if (!props.groups.length) {
      activeStageKey.value = ''
      userSelectedStage.value = false
      return
    }

    const failedStage = props.groups.find((group) => group.status === 'error')
    if (failedStage && autoOpenedErrorKey.value !== failedStage.key) {
      activeStageKey.value = failedStage.key
      activeView.value = 'logs'
      autoOpenedErrorKey.value = failedStage.key
      userSelectedStage.value = false
      return
    }

    const selectedStillExists = props.groups.some((group) => group.key === activeStageKey.value)
    if (selectedStillExists && userSelectedStage.value) return

    const preferredStage = props.groups.find((group) => group.status === 'current')
      || props.groups.find((group) => group.events?.length)
      || props.groups[0]
    activeStageKey.value = preferredStage.key
  },
  { immediate: true },
)

onMounted(() => {
  clockTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 30_000)
})

onBeforeUnmount(() => {
  if (clockTimer) window.clearInterval(clockTimer)
})

const activeStage = computed(() => (
  props.groups.find((group) => group.key === activeStageKey.value) || props.groups[0] || null
))

const allEvents = computed(() => props.groups.flatMap((group) => group.events || []))
const standardStages = computed(() => props.groups.filter((group) => group.key !== 'other'))
const completedStageCount = computed(() => standardStages.value.filter((group) => group.status === 'done').length)
const allStandardStagesDone = computed(() => (
  standardStages.value.length > 0 && standardStages.value.every((group) => group.status === 'done')
))
const activeStageError = computed(() => (
  activeStage.value?.events?.find((event) => eventStatus(event.status) === 'error') || null
))
const rawLogEvents = computed(() => (
  (activeStage.value?.events || []).filter((event) => !event.reconstructed && String(event.raw || '').trim())
))

const globalTokenUsage = computed(() => collectTokenUsage(allEvents.value))
const activeTokenUsage = computed(() => collectTokenUsage(activeStage.value?.events || []))

const taskDuration = computed(() => {
  const startedMs = Date.parse(props.taskStartedAt || '')
  if (!Number.isFinite(startedMs)) return '--'
  const finished = props.taskStatus === 'done' || props.taskStatus === 'error'
  const endedMs = finished ? Date.parse(props.taskEndedAt || '') : nowMs.value
  if (!Number.isFinite(endedMs) || endedMs < startedMs) return '--'
  return formatTimelineDuration(endedMs - startedMs) || '--'
})

const overviewMetrics = computed(() => [
  { label: '任务状态', value: statusLabel(props.taskStatus), tone: props.taskStatus },
  { label: '运行时长', value: taskDuration.value },
  {
    label: '完成阶段',
    value: standardStages.value.length ? `${completedStageCount.value}/${standardStages.value.length}` : '--',
  },
  { label: '已记录事件', value: allEvents.value.length ? String(allEvents.value.length) : '--' },
  { label: 'Token 用量', value: tokenMetric(globalTokenUsage.value.total) },
  { label: '模型调用数', value: '--' },
  { label: 'Tool 调用数', value: '--' },
])

function selectStage(key) {
  activeStageKey.value = key
  userSelectedStage.value = true
}

function statusLabel(status) {
  if (status === 'done') return '已完成'
  if (status === 'recovered') return '已恢复'
  if (status === 'current') return '进行中'
  if (status === 'error') return '异常'
  return '未开始'
}

function statusIcon(status) {
  if (status === 'current') return LoaderCircle
  if (status === 'error') return CircleAlert
  return Circle
}

function stageNumber(index) {
  return String(index + 1).padStart(2, '0')
}

function stageIndexLabel(group, index) {
  return group?.key === 'other' ? '辅助' : stageNumber(index)
}

function stageHeadingLabel(group) {
  if (group?.key === 'other') return '辅助分组'
  const index = standardStages.value.findIndex((item) => item.key === group?.key)
  return index >= 0 ? `阶段 ${stageNumber(index)}` : '阶段 --'
}

function stageTitleLabel(group) {
  return group?.key === 'other' ? '辅助事件' : group?.title || '--'
}

function stageMetaLabel(group) {
  const detail = `${durationLabel(group)} · ${group?.eventCount || 0} 条记录`
  if (group?.status === 'done' && allStandardStagesDone.value) return detail
  return `${statusLabel(group?.status)} · ${detail}`
}

function formatClock(value) {
  if (!value) return '--'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '--'
  return parsed.toLocaleTimeString('zh-CN', { hour12: false })
}

function formatDateTime(value) {
  if (!value) return '--'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '--'
  return parsed.toLocaleString('zh-CN', { hour12: false })
}

function durationLabel(group) {
  if (!group) return '--'
  if (group.status !== 'current' || props.taskStatus !== 'current' || !group.startedAt) {
    return group.durationLabel || '--'
  }
  const startedMs = Date.parse(group.startedAt)
  if (!Number.isFinite(startedMs)) return '--'
  return formatTimelineDuration(Math.max(0, nowMs.value - startedMs)) || '--'
}

function eventStatus(status) {
  const value = String(status || '').toLowerCase()
  if (value === 'failed' || value === 'error') return 'error'
  if (value === 'recovered') return 'recovered'
  if (value === 'done' || value === 'completed' || value === 'succeeded') return 'done'
  return 'current'
}

function eventStatusLabel(status) {
  return statusLabel(eventStatus(status))
}

function actorLabel(actor) {
  const value = String(actor || '').toLowerCase()
  if (value === 'research-agent') return '调研智能体'
  if (value === 'synthesis-agent') return '撰稿智能体'
  if (value === 'main-agent') return '主智能体'
  return '系统'
}

function eventName(event) {
  return event.toolDisplayName || event.toolName || event.title || event.label || '执行事件'
}

function numericUsage(usage, keys) {
  for (const key of keys) {
    const value = Number(usage?.[key])
    if (Number.isFinite(value) && value >= 0) return value
  }
  return null
}

function collectTokenUsage(events) {
  let input = 0
  let output = 0
  let total = 0
  let hasInput = false
  let hasOutput = false
  let hasTotal = false

  for (const event of events) {
    const usage = event?.usage
    if (!usage || typeof usage !== 'object') continue
    const inputValue = numericUsage(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'])
    const outputValue = numericUsage(usage, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens'])
    const totalValue = numericUsage(usage, ['total_tokens', 'totalTokens'])
    if (inputValue !== null) {
      input += inputValue
      hasInput = true
    }
    if (outputValue !== null) {
      output += outputValue
      hasOutput = true
    }
    if (totalValue !== null) {
      total += totalValue
      hasTotal = true
    }
  }

  return {
    input: hasInput ? input : null,
    output: hasOutput ? output : null,
    total: hasTotal ? total : hasInput || hasOutput ? input + output : null,
  }
}

function tokenMetric(value) {
  return Number.isFinite(value) ? Number(value).toLocaleString('zh-CN') : '--'
}

function payloadValue(event, keys) {
  for (const key of keys) {
    const value = event?.[key]
    if (value === undefined || value === null || value === '') continue
    let text = ''
    if (typeof value === 'string') text = value
    else {
      try {
        text = JSON.stringify(value, null, 2)
      } catch {
        text = String(value)
      }
    }
    return sanitizeReportExecutionText(text) || '--'
  }
  return '--'
}

function eventInput(event) {
  return payloadValue(event, ['input', 'toolInput', 'request', 'arguments', 'command'])
}

function eventOutput(event) {
  return payloadValue(event, ['output', 'result', 'response', 'detail'])
}
</script>

<template>
  <div v-if="groups.length" class="report-technical-workspace">
    <section class="runtime-overview" aria-labelledby="runtime-overview-title">
      <header class="runtime-overview-header">
        <strong id="runtime-overview-title">运行概览</strong>
      </header>
      <dl class="runtime-overview-metrics">
        <div
          v-for="metric in overviewMetrics"
          :key="metric.label"
          class="runtime-overview-metric"
          :class="metric.tone ? `runtime-overview-metric-${metric.tone}` : ''"
        >
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.value }}</dd>
        </div>
      </dl>
    </section>

    <div class="technical-master-detail">
      <aside class="technical-stage-nav" aria-label="执行阶段">
        <div class="technical-stage-nav-title">
          <strong>执行阶段</strong>
          <span>{{ standardStages.length }} 阶段{{ groups.length > standardStages.length ? ' + 辅助' : '' }}</span>
        </div>
        <div class="technical-stage-nav-list">
          <button
            v-for="(group, index) in groups"
            :key="group.key"
            class="technical-stage-nav-item"
            :class="[
              `technical-stage-nav-item-${group.status}`,
              { active: activeStage?.key === group.key },
            ]"
            type="button"
            :aria-current="activeStage?.key === group.key ? 'step' : undefined"
            @click="selectStage(group.key)"
          >
            <span class="technical-stage-nav-index">{{ stageIndexLabel(group, index) }}</span>
            <span class="technical-stage-nav-copy">
              <strong>{{ group.title }}</strong>
              <small>{{ stageMetaLabel(group) }}</small>
            </span>
            <component v-if="group.status !== 'done'" :is="statusIcon(group.status)" :size="16" aria-hidden="true" />
          </button>
        </div>
      </aside>

      <section v-if="activeStage" class="technical-stage-workbench">
        <header class="technical-stage-workbench-header">
          <div>
            <span>
              {{ stageHeadingLabel(activeStage) }}
              <b v-if="activeStage.status === 'done'"> · 已完成</b>
            </span>
            <strong>{{ stageTitleLabel(activeStage) }}</strong>
          </div>
          <span v-if="activeStage.status !== 'done'" class="technical-status" :class="`technical-status-${activeStage.status}`">
            <component :is="statusIcon(activeStage.status)" :size="14" aria-hidden="true" />
            {{ statusLabel(activeStage.status) }}
          </span>
        </header>

        <div v-if="activeStage.status === 'error'" class="technical-stage-alert" role="alert">
          <CircleAlert :size="18" aria-hidden="true" />
          <div>
            <strong>{{ activeStageError?.title || '阶段执行异常' }}</strong>
            <p>{{ activeStageError?.description || activeStage.desc || '该阶段出现异常，详细原因请查看日志。' }}</p>
          </div>
        </div>

        <nav class="technical-workbench-tabs" aria-label="阶段技术视图">
          <button
            v-for="view in workspaceViews"
            :key="view.key"
            type="button"
            :class="{ active: activeView === view.key }"
            :aria-selected="activeView === view.key"
            @click="activeView = view.key"
          >
            <component :is="view.icon" :size="15" aria-hidden="true" />
            {{ view.label }}
          </button>
        </nav>

        <div class="technical-workbench-view">
          <section v-if="activeView === 'overview'" class="technical-stage-overview">
            <p class="technical-stage-description">{{ activeStage.desc || '--' }}</p>
            <dl class="technical-stage-facts">
              <div>
                <dt>开始时间</dt>
                <dd>{{ formatDateTime(activeStage.startedAt) }}</dd>
              </div>
              <div>
                <dt>结束时间</dt>
                <dd>{{ activeStage.status === 'current' && taskStatus === 'current' ? '至今' : formatDateTime(activeStage.endedAt) }}</dd>
              </div>
              <div>
                <dt>阶段耗时</dt>
                <dd>{{ durationLabel(activeStage) }}</dd>
              </div>
              <div>
                <dt>已记录事件</dt>
                <dd>{{ activeStage.eventCount || '--' }}</dd>
              </div>
            </dl>
            <div class="technical-usage-section">
              <strong>资源调用</strong>
              <dl>
                <div><dt>输入 Token</dt><dd>{{ tokenMetric(activeTokenUsage.input) }}</dd></div>
                <div><dt>输出 Token</dt><dd>{{ tokenMetric(activeTokenUsage.output) }}</dd></div>
                <div><dt>总 Token</dt><dd>{{ tokenMetric(activeTokenUsage.total) }}</dd></div>
                <div><dt>模型调用数</dt><dd>--</dd></div>
                <div><dt>Tool 调用数</dt><dd>--</dd></div>
              </dl>
            </div>
          </section>

          <section v-else-if="activeView === 'chain'" class="technical-call-chain" aria-label="阶段调用链">
            <ol v-if="activeStage.events?.length">
              <li v-for="event in activeStage.events" :key="event.id" :class="`is-${eventStatus(event.status)}`">
                <span class="technical-call-chain-node" aria-hidden="true"></span>
                <div class="technical-call-chain-main">
                  <div>
                    <strong>{{ actorLabel(event.actor) }}</strong>
                    <span aria-hidden="true">→</span>
                    <b>{{ eventName(event) }}</b>
                    <span v-if="event.reconstructed" class="technical-reconstructed-tag">状态还原</span>
                  </div>
                  <small>{{ event.title || event.label || '执行事件' }}</small>
                </div>
                <div class="technical-call-chain-meta">
                  <time>{{ formatClock(event.occurredAt || event.time) }}</time>
                  <span>{{ event.durationLabel || '--' }}</span>
                  <b>{{ eventStatusLabel(event.status) }}</b>
                </div>
              </li>
            </ol>
            <div v-else class="technical-empty-view">该阶段暂无已保存的调用事件</div>
          </section>

          <section v-else-if="activeView === 'io'" class="technical-io-view" aria-label="阶段输入输出">
            <div v-if="activeStage.events?.length" class="technical-io-list">
              <article v-for="event in activeStage.events" :key="event.id">
                <header>
                  <strong>{{ eventName(event) }}</strong>
                  <time>{{ formatClock(event.occurredAt || event.time) }}</time>
                </header>
                <div class="technical-io-grid">
                  <section>
                    <span>输入记录</span>
                    <pre>{{ eventInput(event) }}</pre>
                  </section>
                  <section>
                    <span>输出记录</span>
                    <pre>{{ eventOutput(event) }}</pre>
                  </section>
                </div>
              </article>
            </div>
            <div v-else class="technical-empty-view">该阶段暂无已保存的输入输出记录</div>
          </section>

          <section v-else class="technical-log-viewer" aria-label="阶段原始技术日志">
            <header class="technical-log-viewer-toolbar">
              <span>原始执行日志</span>
              <b>{{ rawLogEvents.length ? `${rawLogEvents.length} 条` : '--' }}</b>
            </header>
            <div v-if="rawLogEvents.length" class="technical-log-viewer-body">
              <div class="technical-log-columns" aria-hidden="true">
                <span>序号</span>
                <span>时间</span>
                <span>事件与正文</span>
                <span>状态</span>
              </div>
              <article
                v-for="(event, index) in rawLogEvents"
                :key="event.id"
                :class="`is-${eventStatus(event.status)}`"
              >
                <span class="technical-log-index">{{ String(index + 1).padStart(3, '0') }}</span>
                <time class="technical-log-time">{{ formatClock(event.occurredAt || event.time) }}</time>
                <div class="technical-log-content">
                  <b>{{ eventName(event) }}</b>
                  <pre>{{ event.raw }}</pre>
                </div>
                <em class="technical-log-status">{{ eventStatusLabel(event.status) }}</em>
              </article>
            </div>
            <div v-else class="technical-log-empty">该阶段暂无已保存的原始技术日志</div>
          </section>
        </div>
      </section>
    </div>
  </div>
  <div v-else class="source-empty-state">{{ emptyText }}</div>
</template>

<style scoped>
.report-technical-workspace {
  min-width: 0;
  overflow: clip;
  border: 1px solid #dfe6ef;
  border-radius: 6px;
  background: #fff;
  color: #1f2937;
}

.runtime-overview {
  border-bottom: 1px solid #e5eaf0;
  background: #fff;
}

.runtime-overview-header {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 18px;
  border-bottom: 1px solid #eef2f6;
}

.runtime-overview-header strong {
  color: #172033;
  font-size: 14px;
  font-weight: 750;
}

.runtime-overview-metrics {
  display: grid;
  grid-template-columns: repeat(7, minmax(104px, 1fr));
  margin: 0;
  overflow-x: auto;
}

.runtime-overview-metric {
  min-width: 104px;
  padding: 13px 16px 14px;
  border-right: 1px solid #eef2f6;
}

.runtime-overview-metric:last-child { border-right: 0; }

.runtime-overview-metric dt,
.technical-stage-facts dt,
.technical-usage-section dt {
  color: #7a8599;
  font-size: 12px;
  font-weight: 650;
}

.runtime-overview-metric dd {
  margin: 5px 0 0;
  color: #172033;
  font-family: 'Fira Code', 'Microsoft YaHei', monospace;
  font-size: 14px;
  font-weight: 750;
  white-space: nowrap;
}

.runtime-overview-metric-done dd { color: #475569; }
.runtime-overview-metric-current dd { color: #2563eb; }
.runtime-overview-metric-error dd { color: #dc2626; }

.technical-master-detail {
  display: grid;
  grid-template-columns: minmax(196px, 208px) minmax(0, 1fr);
  min-width: 0;
  min-height: 480px;
}

.technical-stage-nav {
  min-width: 0;
  border-right: 1px solid #e5eaf0;
  background: #fbfcfe;
}

.technical-stage-nav-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 46px;
  padding: 0 14px;
  border-bottom: 1px solid #e5eaf0;
}

.technical-stage-nav-title strong {
  color: #475467;
  font-size: 14px;
  font-weight: 750;
}

.technical-stage-nav-title span {
  color: #667085;
  font-size: 12px;
  text-align: right;
}

.technical-stage-nav-list {
  display: grid;
  padding: 6px 0;
}

.technical-stage-nav-item {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 62px;
  padding: 9px 12px;
  border: 0;
  border-left: 3px solid transparent;
  border-radius: 0;
  background: transparent;
  color: #667085;
  text-align: left;
  cursor: pointer;
}

.technical-stage-nav-item:hover { background: #f4f7fb; }
.technical-stage-nav-item.active {
  border-left-color: #2563eb;
  background: #edf4ff;
  color: #2563eb;
}
.technical-stage-nav-item-error.active {
  border-left-color: #dc2626;
  background: #fff1f2;
  color: #dc2626;
}
.technical-stage-nav-item-done { grid-template-columns: 34px minmax(0, 1fr); }
.technical-stage-nav-item:focus-visible,
.technical-workbench-tabs button:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 1px;
}

.technical-stage-nav-index {
  font-family: 'Fira Code', monospace;
  font-size: 12px;
  font-weight: 700;
}

.technical-stage-nav-copy { min-width: 0; }
.technical-stage-nav-copy strong,
.technical-stage-nav-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.technical-stage-nav-copy strong {
  color: #344054;
  font-size: 14px;
  font-weight: 750;
}
.technical-stage-nav-copy small {
  margin-top: 4px;
  color: #8993a4;
  font-size: 12px;
}
.technical-stage-nav-item.active .technical-stage-nav-copy strong { color: currentColor; }
.technical-stage-nav-item-current > svg { animation: technical-spin 1.2s linear infinite; }
.technical-stage-nav-item-error > svg { color: #dc2626; }

.technical-stage-workbench {
  min-width: 0;
  background: #fff;
}

.technical-stage-workbench-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 68px;
  padding: 11px 20px;
  border-bottom: 1px solid #e5eaf0;
}

.technical-stage-workbench-header > div span,
.technical-stage-workbench-header > div strong { display: block; }
.technical-stage-workbench-header > div span {
  color: #7a8599;
  font-size: 12px;
  font-weight: 700;
}
.technical-stage-workbench-header > div span b {
  color: #475569;
  font-weight: 700;
}
.technical-stage-workbench-header > div strong {
  margin-top: 4px;
  color: #172033;
  font-size: 16px;
  font-weight: 750;
}

.technical-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #667085;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.technical-status-done { color: #475569; }
.technical-status-current { color: #2563eb; }
.technical-status-current svg { animation: technical-spin 1.2s linear infinite; }
.technical-status-error { color: #dc2626; }

.technical-stage-alert {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 10px;
  margin: 14px 20px 0;
  padding: 12px 14px;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: #fff7f7;
  color: #b42318;
}
.technical-stage-alert strong { font-size: 14px; }
.technical-stage-alert p {
  margin: 3px 0 0;
  color: #7f1d1d;
  font-size: 13px;
  line-height: 1.65;
}

.technical-workbench-tabs {
  display: flex;
  align-items: center;
  gap: 24px;
  min-height: 48px;
  padding: 0 20px;
  border-bottom: 1px solid #e5eaf0;
}
.technical-workbench-tabs button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #667085;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.technical-workbench-tabs button::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: transparent;
  content: '';
}
.technical-workbench-tabs button.active { color: #2563eb; }
.technical-workbench-tabs button.active::after { background: #2563eb; }

.technical-workbench-view { min-width: 0; }

.technical-stage-overview { padding: 20px; }
.technical-stage-description {
  margin: 0;
  padding-bottom: 16px;
  border-bottom: 1px solid #eef2f6;
  color: #5d687b;
  font-size: 14px;
  line-height: 1.7;
}
.technical-stage-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  border-bottom: 1px solid #eef2f6;
}
.technical-stage-facts > div {
  min-width: 0;
  padding: 17px 14px 17px 0;
}
.technical-stage-facts dd,
.technical-usage-section dd {
  margin: 6px 0 0;
  overflow: hidden;
  color: #27364f;
  font-family: 'Fira Code', 'Microsoft YaHei', monospace;
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.technical-usage-section { padding-top: 17px; }
.technical-usage-section > strong {
  color: #344054;
  font-size: 14px;
  font-weight: 750;
}
.technical-usage-section > dl {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin: 12px 0 0;
}
.technical-usage-section > dl > div {
  min-width: 0;
  padding-left: 10px;
  border-left: 2px solid #dbe7f8;
}

.technical-call-chain { padding: 8px 20px 16px; }
.technical-call-chain ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.technical-call-chain li {
  position: relative;
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  gap: 12px;
  min-height: 66px;
  padding: 13px 0;
  border-bottom: 1px solid #eef2f6;
}
.technical-call-chain li:last-child { border-bottom: 0; }
.technical-call-chain-node {
  width: 7px;
  height: 7px;
  margin-top: 7px;
  border-radius: 50%;
  background: #2563eb;
}
.technical-call-chain li.is-done .technical-call-chain-node {
  background: #94a3b8;
}
.technical-call-chain li.is-recovered .technical-call-chain-node {
  background: #64748b;
}
.technical-call-chain li.is-error .technical-call-chain-node {
  background: #dc2626;
}
.technical-call-chain-main { min-width: 0; }
.technical-call-chain-main > div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 8px;
  color: #7a8599;
  font-size: 14px;
}
.technical-call-chain-main strong { color: #344054; font-weight: 750; }
.technical-call-chain-main b { color: #2563eb; font-weight: 750; }
.technical-call-chain-main small {
  display: block;
  margin-top: 5px;
  overflow: hidden;
  color: #667085;
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: normal;
}
.technical-reconstructed-tag {
  padding: 2px 5px;
  border: 1px solid #d0d5dd;
  border-radius: 4px;
  color: #667085;
  background: #fff;
  font-size: 12px;
}
.technical-call-chain-meta {
  display: grid;
  grid-template-columns: 72px 72px 50px;
  gap: 10px;
  color: #7a8599;
  font-family: 'Fira Code', 'Microsoft YaHei', monospace;
  font-size: 12px;
  text-align: right;
}
.technical-call-chain-meta b { color: #475467; font-weight: 700; }
.technical-call-chain li.is-recovered .technical-call-chain-meta b { color: #475569; }
.technical-call-chain li.is-error .technical-call-chain-meta b { color: #dc2626; }

.technical-io-list > article { border-bottom: 1px solid #e5eaf0; }
.technical-io-list > article:last-child { border-bottom: 0; }
.technical-io-list > article > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 0 20px;
  background: #f8fafc;
}
.technical-io-list > article > header strong {
  overflow: hidden;
  color: #344054;
  font-size: 14px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.technical-io-list > article > header time {
  color: #7a8599;
  font-family: 'Fira Code', monospace;
  font-size: 12px;
}
.technical-io-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.technical-io-grid section {
  min-width: 0;
  padding: 14px 20px 18px;
}
.technical-io-grid section + section { border-left: 1px solid #e5eaf0; }
.technical-io-grid span {
  color: #667085;
  font-size: 12px;
  font-weight: 750;
}
.technical-io-grid pre {
  min-height: 54px;
  margin: 8px 0 0;
  overflow: auto;
  color: #344054;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.technical-log-viewer {
  min-width: 0;
  min-height: 340px;
  background: #fff;
  color: #374151;
}
.technical-log-viewer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid #e5eaf0;
  background: #fff;
  font-size: 14px;
}
.technical-log-viewer-toolbar span { color: #25324a; font-weight: 750; }
.technical-log-viewer-toolbar b { color: #667085; font-size: 12px; font-weight: 650; }
.technical-log-viewer-body { min-width: 0; }
.technical-log-columns,
.technical-log-viewer-body article {
  display: grid;
  grid-template-columns: 50px 82px minmax(0, 1fr) 58px;
  gap: 14px;
  align-items: start;
  min-width: 0;
  padding: 0 16px;
}
.technical-log-columns {
  align-items: center;
  min-height: 38px;
  border-bottom: 1px solid #e5eaf0;
  background: #f6f8fb;
  color: #667085;
  font-size: 12px;
  font-weight: 700;
}
.technical-log-viewer-body article {
  padding-top: 13px;
  padding-bottom: 14px;
  border-bottom: 1px solid #e8edf3;
}
.technical-log-viewer-body article:last-child { border-bottom: 0; }
.technical-log-index,
.technical-log-time {
  color: #7a8599;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 22px;
  white-space: nowrap;
}
.technical-log-content {
  min-width: 0;
}
.technical-log-content b {
  display: block;
  color: #1d4ed8;
  font-size: 14px;
  font-weight: 700;
  line-height: 22px;
  overflow-wrap: anywhere;
}
.technical-log-status {
  color: #2563eb;
  font-size: 12px;
  font-style: normal;
  line-height: 22px;
  text-align: right;
  white-space: nowrap;
}
.technical-log-viewer-body article.is-done .technical-log-status,
.technical-log-viewer-body article.is-recovered .technical-log-status { color: #475569; }
.technical-log-viewer-body article.is-error .technical-log-status { color: #dc2626; }
.technical-log-content pre {
  margin: 3px 0 0;
  max-width: 100%;
  overflow: visible;
  color: #374151;
  font-family: Inter, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', Arial, sans-serif;
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.technical-log-empty {
  display: grid;
  min-height: 300px;
  place-items: center;
  color: #64748b;
  font-size: 14px;
}

.technical-empty-view {
  display: grid;
  min-height: 300px;
  place-items: center;
  color: #98a2b3;
  font-size: 14px;
}

@keyframes technical-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .runtime-overview-metrics { grid-template-columns: repeat(7, minmax(110px, 1fr)); }
  .technical-master-detail { grid-template-columns: 196px minmax(0, 1fr); }
  .technical-stage-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .technical-usage-section > dl { grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: 18px; }
  .technical-call-chain li { grid-template-columns: 12px minmax(0, 1fr); }
  .technical-call-chain-meta {
    grid-column: 2;
    grid-template-columns: repeat(3, auto);
    justify-content: start;
    text-align: left;
  }
}

@media (max-width: 680px) {
  .technical-master-detail { display: block; min-height: 0; }
  .technical-stage-nav { border-right: 0; border-bottom: 1px solid #e5eaf0; }
  .technical-stage-nav-list {
    display: flex;
    gap: 6px;
    overflow-x: auto;
  }
  .technical-stage-nav-item { flex: 0 0 208px; }
  .technical-stage-workbench-header { min-height: 58px; padding-inline: 14px; }
  .technical-workbench-tabs { gap: 18px; overflow-x: auto; padding-inline: 14px; }
  .technical-stage-overview { padding: 14px; }
  .technical-stage-facts { grid-template-columns: 1fr; }
  .technical-stage-facts > div { padding-block: 12px; }
  .technical-usage-section > dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .technical-io-grid { grid-template-columns: 1fr; }
  .technical-io-grid section + section { border-top: 1px solid #e5eaf0; border-left: 0; }
  .technical-log-columns,
  .technical-log-viewer-body article {
    grid-template-columns: 42px 72px minmax(0, 1fr);
    gap: 10px;
    padding-inline: 12px;
  }
  .technical-log-columns span:last-child,
  .technical-log-status { display: none; }
}
</style>
