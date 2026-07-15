<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
    <section
      v-for="group in groups"
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
        <span class="technical-timeline-stage-marker" aria-hidden="true"></span>
        <span class="technical-timeline-stage-copy">
          <strong>{{ group.title }}</strong>
          <span>{{ group.desc }}</span>
        </span>
        <span class="technical-timeline-stage-metrics">
          <span>{{ group.eventCount }} 条事件</span>
          <span>{{ timeRange(group) }}</span>
          <span v-if="durationLabel(group)">耗时 {{ durationLabel(group) }}</span>
        </span>
        <span class="technical-timeline-stage-status">{{ statusLabel(group.status) }}</span>
        <span class="technical-timeline-chevron" aria-hidden="true">
          {{ expandedStageKeys.has(group.key) ? '⌃' : '⌄' }}
        </span>
      </button>

      <div v-if="expandedStageKeys.has(group.key)" class="technical-timeline-events">
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
    </section>
  </div>
  <div v-else class="source-empty-state">{{ emptyText }}</div>
</template>

<style scoped>
.technical-timeline {
  display: grid;
  gap: 8px;
}

.technical-timeline-stage {
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.technical-timeline-stage-header {
  display: grid;
  grid-template-columns: 10px minmax(180px, 1fr) minmax(220px, auto) auto 18px;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 10px 12px;
  border: 0;
  color: #0f172a;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.technical-timeline-stage-header:hover {
  background: #f8fafc;
}

.technical-timeline-stage-marker {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
  box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.12);
}

.technical-timeline-stage-current .technical-timeline-stage-marker {
  background: #2563eb;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
}

.technical-timeline-stage-done .technical-timeline-stage-marker {
  background: #16a34a;
  box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.1);
}

.technical-timeline-stage-error .technical-timeline-stage-marker {
  background: #dc2626;
  box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.1);
}

.technical-timeline-stage-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.technical-timeline-stage-copy strong {
  font-size: 13px;
  line-height: 1.35;
}

.technical-timeline-stage-copy span {
  color: #64748b;
  font-size: 11px;
  line-height: 1.45;
}

.technical-timeline-stage-metrics {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px 12px;
  color: #64748b;
  font-family: 'Fira Code', 'Microsoft YaHei', monospace;
  font-size: 10px;
}

.technical-timeline-stage-status {
  min-width: 44px;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  text-align: right;
}

.technical-timeline-stage-current .technical-timeline-stage-status { color: #2563eb; }
.technical-timeline-stage-done .technical-timeline-stage-status { color: #15803d; }
.technical-timeline-stage-error .technical-timeline-stage-status { color: #dc2626; }

.technical-timeline-chevron {
  color: #64748b;
  font-size: 16px;
  text-align: center;
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
  .technical-timeline-stage-header {
    grid-template-columns: 10px minmax(0, 1fr) auto 18px;
    gap: 8px;
  }

  .technical-timeline-stage-metrics {
    grid-column: 2 / -1;
    justify-content: flex-start;
  }

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
</style>
