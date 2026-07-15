const STAGE_PATTERNS = [
  ['deep_collection', /^(DEEP_COLLECTION|DEEP_SOURCE_COLLECTION|DEEP_COLLECTION_DONE|DEEP_COLLECTION_FAILED|DEEP_SOURCE_COLLECTION_DONE|DEEP_SOURCE_COLLECTION_FAILED)$/],
  ['database', /^(PG_RECALL|DATABASE_RECALL|DATABASE)$/],
  ['plan', /^(CONNECTING|TASK_START|AGENT_START|PREPARING|PLANNING|HARNESS_PLAN)$/],
  ['research', /^(RESEARCH_TASK|WAITING_RESEARCH|RESEARCHING|RESEARCH_RUN|RESEARCH_DONE|SEARCHING|EXTRACTING)$/],
  ['consolidate', /^(CONSOLIDATE|ANALYZING|SYNTHESIS_TASK|WAITING_SYNTHESIS|SYNTHESIS)$/],
  ['report', /^(WRITING|VERIFYING|VALIDATE_SAVE|SAVING|COMPLETED)$/],
  ['quality', /^(QUALITY_REVIEW|QUALITY_REVIEW_DONE|QUALITY_REVIEW_FAILED)$/],
]

function normalizeSignal(value) {
  return String(value || '')
    .trim()
    .replace(/[\s:-]+/g, '_')
    .toUpperCase()
}

export function timelineStageKey(log) {
  const signals = [log?.stage, log?.phase]
    .map(normalizeSignal)
    .filter(Boolean)
  for (const signal of signals) {
    for (const [key, pattern] of STAGE_PATTERNS) {
      if (pattern.test(signal)) return key
    }
  }
  return 'other'
}

function normalizedStatus(value) {
  const status = String(value || '').toLowerCase()
  if (status === 'failed' || status === 'error') return 'error'
  if (status === 'running' || status === 'current' || status === 'started') return 'current'
  if (status === 'done' || status === 'completed' || status === 'succeeded') return 'done'
  return 'waiting'
}

function timestampMs(event) {
  const value = event?.occurredAt || event?.time
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function isoAt(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : ''
}

function otherStatus(events, stages = []) {
  if (events.some((event) => normalizedStatus(event.status) === 'error')) return 'error'
  if (stages.length && stages.every((stage) => normalizedStatus(stage.status) === 'done')) return 'done'
  if (events.some((event) => normalizedStatus(event.status) === 'current')) return 'current'
  if (events.length && events.every((event) => normalizedStatus(event.status) === 'done')) return 'done'
  return 'waiting'
}

export function formatTimelineDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return ''
  const seconds = Math.floor(durationMs / 1000)
  if (seconds < 1) return '<1秒'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  if (hours) return minutes ? `${hours}小时 ${minutes}分` : `${hours}小时`
  if (minutes) return remainingSeconds ? `${minutes}分 ${remainingSeconds}秒` : `${minutes}分钟`
  return `${remainingSeconds}秒`
}

export function defaultExpandedTimelineKeys(groups = []) {
  return groups
    .filter((group) => group.status === 'current' || group.status === 'error')
    .map((group) => group.key)
}

function buildGroup(stage, events, nowMs) {
  const sortedEvents = events
    .map((event, index) => ({ event, index, timestamp: timestampMs(event) }))
    .sort((left, right) => {
      if (left.timestamp === null && right.timestamp === null) return left.index - right.index
      if (left.timestamp === null) return 1
      if (right.timestamp === null) return -1
      return left.timestamp - right.timestamp || left.index - right.index
    })
    .map(({ event }) => event)
  const timestamps = sortedEvents.map(timestampMs).filter(Number.isFinite)
  const startedMs = timestamps.length ? timestamps[0] : null
  const lastEventMs = timestamps.length ? timestamps[timestamps.length - 1] : null
  const hasError = sortedEvents.some((event) => normalizedStatus(event.status) === 'error')
  const baseStatus = normalizedStatus(stage.status)
  const status = hasError ? 'error' : baseStatus
  const durationEndMs = status === 'current' && Number.isFinite(startedMs)
    ? Math.max(nowMs, startedMs)
    : lastEventMs
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(durationEndMs)
    ? Math.max(0, durationEndMs - startedMs)
    : null

  return {
    ...stage,
    status,
    events: sortedEvents,
    eventCount: sortedEvents.length,
    startedAt: isoAt(startedMs),
    endedAt: isoAt(lastEventMs),
    durationMs,
    durationLabel: formatTimelineDuration(durationMs),
  }
}

export function buildReportTechnicalTimeline({ stages = [], logs = [], now = new Date().toISOString() } = {}) {
  if (!logs.length) return []
  const nowMs = new Date(now).getTime()
  const grouped = new Map(stages.map((stage) => [stage.key, []]))
  const otherEvents = []

  for (const log of logs) {
    const key = timelineStageKey(log)
    if (grouped.has(key)) grouped.get(key).push(log)
    else otherEvents.push(log)
  }

  const result = stages.map((stage) => buildGroup(stage, grouped.get(stage.key) || [], nowMs))
  if (otherEvents.length) {
    result.push(buildGroup({
      key: 'other',
      title: '其他技术事件',
      desc: '未归入标准编报阶段的系统执行记录',
      status: otherStatus(otherEvents, stages),
    }, otherEvents, nowMs))
  }
  return result
}
