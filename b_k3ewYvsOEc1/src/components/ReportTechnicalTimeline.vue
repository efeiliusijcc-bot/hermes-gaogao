<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CheckCircle2, ChevronDown, ChevronUp, Circle, CircleAlert, LoaderCircle } from '@lucide/vue'
import { defaultExpandedTimelineKeys, formatTimelineDuration } from '../lib/reportTechnicalTimeline.js'

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
})

const expandedStageKeys = ref(new Set())
const manuallyToggledStageKeys = new Set()
const autoExpandedStageKeys = new Set()
const nowMs = ref(Date.now())
let clockTimer = null

watch(
  () => props.groups.map((group) => `${group.key}:${group.status}`).join('|'),
  () => {
    const preferredKeys = new Set(defaultExpandedTimelineKeys(props.groups))
    const next = new Set(expandedStageKeys.value)
    for (const key of autoExpandedStageKeys) {
      if (!preferredKeys.has(key) && !manuallyToggledStageKeys.has(key)) {
        next.delete(key)
        autoExpandedStageKeys.delete(key)
      }
    }
    for (const key of preferredKeys) {
      if (!manuallyToggledStageKeys.has(key)) {
        next.add(key)
        autoExpandedStageKeys.add(key)
      }
    }
    expandedStageKeys.value = next
  },
  { immediate: true },
)

onMounted(() => {
  clockTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 60_000)
})

onBeforeUnmount(() => {
  if (clockTimer) window.clearInterval(clockTimer)
})

function toggleStage(key) {
  const next = new Set(expandedStageKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedStageKeys.value = next
  manuallyToggledStageKeys.add(key)
  autoExpandedStageKeys.delete(key)
}

function statusLabel(status) {
  if (status === 'done') return '已完成'
  if (status === 'current') return '进行中'
  if (status === 'error') return '异常'
  return '未开始'
}

function statusIcon(status) {
  if (status === 'done') return CheckCircle2
  if (status === 'current') return LoaderCircle
  if (status === 'error') return CircleAlert
  return Circle
}

function stageNumber(index) {
  return String(index + 1).padStart(2, '0')
}

function formatClock(value) {
  if (!value) return '时间未记录'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleTimeString('zh-CN', { hour12: false })
}

function timeRange(group) {
  if (!group.startedAt) return '尚无事件'
  const start = formatClock(group.startedAt)
  if (group.status === 'current' && props.taskStatus === 'current') return `${start} - 至今`
  return group.endedAt && group.endedAt !== group.startedAt
    ? `${start} - ${formatClock(group.endedAt)}`
    : start
}

function stageClock(value) {
  return value ? formatClock(value) : '—'
}

function stageEndClock(group) {
  if (group.status === 'current' && props.taskStatus === 'current') return '至今'
  return stageClock(group.endedAt)
}

function durationLabel(group) {
  if (group.status !== 'current' || props.taskStatus !== 'current' || !group.startedAt) {
    return group.durationLabel || ''
  }
  const startedMs = new Date(group.startedAt).getTime()
  return formatTimelineDuration(Math.max(0, nowMs.value - startedMs))
}

function eventStatusLabel(status) {
  const value = String(status || '').toLowerCase()
  if (value === 'failed' || value === 'error') return '异常'
  if (value === 'done' || value === 'completed' || value === 'succeeded') return '已完成'
  return '进行中'
}

function actorLabel(actor) {
  const value = String(actor || '').toLowerCase()
  if (value === 'research-agent') return '调研智能体'
  if (value === 'synthesis-agent') return '撰稿智能体'
  if (value === 'main-agent') return '主智能体'
  return '系统'
}
</script>

<template>
  <div v-if="groups.length" class="technical-timeline">
    <div class="technical-timeline-table-header" aria-hidden="true">
      <span>步骤</span>
      <span>阶段名称</span>
      <span>状态</span>
      <span>开始时间</span>
      <span>结束时间</span>
      <span>耗时</span>
      <span>日志</span>
      <span></span>
    </div>
    <section
      v-for="(group, index) in groups"
      :key="group.key"
      class="technical-timeline-stage"
      :class="`technical-timeline-stage-${group.status}`"
    >
      <button
        class="technical-timeline-stage-header"
        type="button"
        :aria-expanded="expandedStageKeys.has(group.key)"
        @click="toggleStage(group.key)"
      >
        <span class="technical-timeline-stage-index">{{ stageNumber(index) }}</span>
        <span class="technical-timeline-stage-name">
          <strong>{{ group.title }}</strong>
        </span>
        <span class="technical-timeline-stage-status">
          <component :is="statusIcon(group.status)" :size="13" aria-hidden="true" />
          <span>{{ statusLabel(group.status) }}</span>
        </span>
        <time class="technical-timeline-stage-time">{{ stageClock(group.startedAt) }}</time>
        <time class="technical-timeline-stage-time">{{ stageEndClock(group) }}</time>
        <span class="technical-timeline-stage-duration">{{ durationLabel(group) || '—' }}</span>
        <span class="technical-timeline-stage-count">{{ group.eventCount ? `${group.eventCount} 条` : '—' }}</span>
        <span class="technical-timeline-chevron" aria-hidden="true">
          <ChevronUp v-if="expandedStageKeys.has(group.key)" :size="16" />
          <ChevronDown v-else :size="16" />
        </span>
      </button>

      <div v-if="expandedStageKeys.has(group.key)" class="technical-timeline-stage-content">
        <div class="technical-timeline-stage-detail">
          <strong>步骤详情</strong>
          <span>{{ group.desc }}</span>
          <span>{{ timeRange(group) }}</span>
          <span v-if="durationLabel(group)">耗时 {{ durationLabel(group) }}</span>
        </div>
        <div class="technical-timeline-events">
          <article
            v-for="event in group.events"
            :key="event.id"
            class="technical-timeline-event"
            :class="`technical-timeline-event-${event.status}`"
          >
            <div class="technical-timeline-event-rail" aria-hidden="true"></div>
            <div class="technical-timeline-event-body">
              <header>
                <div>
                  <span v-if="event.toolDisplayName" class="technical-timeline-event-tool">
                    {{ event.toolDisplayName }}
                  </span>
                  <span v-if="event.reconstructed" class="technical-timeline-event-reconstructed">状态还原</span>
                  <span class="technical-timeline-event-actor">执行角色：{{ actorLabel(event.actor) }}</span>
                  <strong>{{ event.title }}</strong>
                </div>
                <div class="technical-timeline-event-meta">
                  <time>{{ formatClock(event.occurredAt || event.time) }}</time>
                  <span v-if="event.durationLabel">耗时 {{ event.durationLabel }}</span>
                  <span>{{ eventStatusLabel(event.status) }}</span>
                </div>
              </header>
              <p>{{ event.description }}</p>
              <details v-if="event.raw" class="technical-timeline-event-raw">
                <summary>原始记录</summary>
                <pre>{{ event.raw }}</pre>
              </details>
            </div>
          </article>
          <div v-if="!group.events.length" class="technical-timeline-stage-empty">阶段内暂无技术事件</div>
        </div>
      </div>
    </section>
  </div>
  <div v-else class="source-empty-state">{{ emptyText }}</div>
</template>

<style scoped>
.technical-timeline {
  display: grid;
  overflow: hidden;
  border: 1px solid #dfe6ef;
  border-radius: 8px;
  background: #fff;
}

.technical-timeline-stage {
  border-top: 1px solid #e5eaf0;
}

.technical-timeline-table-header,
.technical-timeline-stage-header {
  display: grid;
  grid-template-columns: 58px minmax(150px, 1.3fr) 90px 92px 92px 84px 64px 24px;
  align-items: center;
  gap: 10px;
}

.technical-timeline-table-header {
  min-height: 34px;
  padding: 0 14px;
  background: #f8fafc;
  color: #475467;
  font-size: 10px;
  font-weight: 700;
}

.technical-timeline-stage-header {
  width: 100%;
  min-height: 44px;
  padding: 0 14px;
  border: 0;
  color: #0f172a;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.technical-timeline-stage-header:hover {
  background: #f8fafc;
}

.technical-timeline-stage-current {
  position: relative;
  box-shadow: inset 0 0 0 1px #2563eb;
}

.technical-timeline-stage-current .technical-timeline-stage-header {
  background: #f8fbff;
}

.technical-timeline-stage-index {
  color: #475467;
  font-family: 'Fira Code', 'Microsoft YaHei', monospace;
  font-size: 10px;
  font-weight: 700;
}

.technical-timeline-stage-current .technical-timeline-stage-index { color: #2563eb; }

.technical-timeline-stage-name {
  min-width: 0;
}

.technical-timeline-stage-name strong {
  display: block;
  overflow: hidden;
  color: #25324a;
  font-size: 11px;
  font-weight: 750;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.technical-timeline-stage-status {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #667085;
  font-size: 10px;
  font-weight: 650;
}

.technical-timeline-stage-status svg { flex: 0 0 auto; }
.technical-timeline-stage-current .technical-timeline-stage-status { color: #2563eb; }
.technical-timeline-stage-current .technical-timeline-stage-status svg { animation: technical-timeline-spin 1.2s linear infinite; }
.technical-timeline-stage-done .technical-timeline-stage-status { color: #15803d; }
.technical-timeline-stage-error .technical-timeline-stage-status { color: #dc2626; }

.technical-timeline-stage-time,
.technical-timeline-stage-duration,
.technical-timeline-stage-count {
  color: #667085;
  font-family: 'Fira Code', 'Microsoft YaHei', monospace;
  font-size: 9px;
  white-space: nowrap;
}

.technical-timeline-chevron {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #667085;
}

.technical-timeline-stage-content {
  border-top: 1px solid #e5eaf0;
  background: #fbfcfe;
}

.technical-timeline-stage-detail {
  display: flex;
  align-items: center;
  gap: 8px 18px;
  min-height: 42px;
  margin: 12px 12px 10px;
  padding: 8px 12px;
  border: 1px solid #e1e7ef;
  border-radius: 6px;
  background: #fff;
  color: #667085;
  font-size: 10px;
}

.technical-timeline-stage-detail strong {
  color: #25324a;
  font-size: 11px;
}

.technical-timeline-stage-detail span:first-of-type {
  min-width: 0;
  flex: 1;
}

@keyframes technical-timeline-spin {
  to { transform: rotate(360deg); }
}

.technical-timeline-events {
  display: grid;
  gap: 8px;
  padding: 0 12px 12px 34px;
}

.technical-timeline-event {
  position: relative;
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: #f8fafc;
}

.technical-timeline-event-rail {
  width: 2px;
  min-height: 100%;
  margin: 0 auto;
  background: #cbd5e1;
}

.technical-timeline-event-error .technical-timeline-event-rail { background: #ef4444; }
.technical-timeline-event-done .technical-timeline-event-rail { background: #22c55e; }
.technical-timeline-event-running .technical-timeline-event-rail { background: #3b82f6; }

.technical-timeline-event-body {
  min-width: 0;
}

.technical-timeline-event-body header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.technical-timeline-event-body header > div:first-child {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 8px;
  min-width: 0;
}

.technical-timeline-event-body strong {
  flex-basis: 100%;
  color: #0f172a;
  font-size: 12px;
  line-height: 1.45;
}

.technical-timeline-event-tool,
.technical-timeline-event-reconstructed,
.technical-timeline-event-actor {
  color: #2563eb;
  font-family: 'Fira Code', 'Microsoft YaHei', monospace;
  font-size: 9px;
  font-weight: 700;
}

.technical-timeline-event-tool {
  padding-left: 8px;
  border-left: 1px solid rgba(148, 163, 184, 0.4);
}

.technical-timeline-event-reconstructed {
  padding: 2px 5px;
  border: 1px solid rgba(100, 116, 139, 0.3);
  border-radius: 4px;
  color: #475569;
  background: #fff;
}

.technical-timeline-event-actor {
  color: #64748b;
}

.technical-timeline-event-meta {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  color: #64748b;
  font-family: 'Fira Code', 'Microsoft YaHei', monospace;
  font-size: 9px;
}

.technical-timeline-event-body > p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 11px;
  line-height: 1.6;
  word-break: break-word;
}

.technical-timeline-event-raw {
  margin-top: 8px;
}

.technical-timeline-event-raw summary {
  width: fit-content;
  padding: 0;
  color: #2563eb;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}

.technical-timeline-event-raw summary::after {
  content: none !important;
}

.technical-timeline-event-raw pre {
  max-height: 180px;
  margin: 8px 0 0;
  overflow: auto;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 6px;
  background: #fff;
  color: #334155;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 10px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.technical-timeline-stage-empty {
  padding: 12px;
  color: #94a3b8;
  font-size: 11px;
  text-align: center;
}

@media (max-width: 760px) {
  .technical-timeline-table-header { display: none; }

  .technical-timeline-stage-header {
    grid-template-columns: 42px minmax(0, 1fr) auto 20px;
    gap: 8px;
    min-height: 52px;
    padding-inline: 12px;
  }

  .technical-timeline-stage-time,
  .technical-timeline-stage-duration,
  .technical-timeline-stage-count { display: none; }

  .technical-timeline-stage-detail { align-items: flex-start; flex-direction: column; gap: 4px; }

  .technical-timeline-events {
    padding-left: 12px;
  }

  .technical-timeline-event-body header {
    display: grid;
  }

  .technical-timeline-event-meta {
    justify-content: space-between;
  }
}

@media (prefers-reduced-motion: reduce) {
  .technical-timeline-stage-current .technical-timeline-stage-status svg { animation: none; }
}
</style>
