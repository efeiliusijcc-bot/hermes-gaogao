export const EVENT_TASK_DEFINITIONS = [
  { id: 'event_time', dimension: '发生时间', title: '核实事件时间' },
  { id: 'participants', dimension: '参与方', title: '识别事件参与方' },
  { id: 'event_causes', dimension: '事件原因', title: '梳理事件原因' },
  { id: 'event_content', dimension: '具体内容', title: '核实事件具体内容' },
  { id: 'event_location', dimension: '发生地点', title: '核实事件地点' },
]

export function hasEventPlanning(value) {
  return Boolean(value?.intentRecognition && value?.eventTaskPlan && Array.isArray(value.eventTaskPlan.tasks))
}

export function normalizeIntentRecognition(value = {}) {
  const detected = ['event_timeline', 'other', 'uncertain'].includes(value?.detected)
    ? value.detected
    : 'uncertain'
  const resolved = ['event_timeline', 'other'].includes(value?.resolved)
    ? value.resolved
    : detected === 'uncertain' ? null : detected
  return {
    detected,
    resolved,
    reason: String(value?.reason || '当前主题的事件意图尚待确认。').trim(),
    source: value?.source === 'model' ? 'model' : 'fallback',
  }
}

export function normalizeEventTaskPlan(value = {}) {
  const source = new Map((Array.isArray(value?.tasks) ? value.tasks : []).map((task) => [task?.id, task]))
  return {
    version: 1,
    tasks: EVENT_TASK_DEFINITIONS.map((definition) => {
      const task = source.get(definition.id) || {}
      return {
        ...definition,
        objective: String(task.objective || '').trim(),
        searchQueries: Array.from(new Set((Array.isArray(task.searchQueries) ? task.searchQueries : [])
          .map((query) => String(query || '').trim())
          .filter(Boolean))).slice(0, 3),
        enabled: task.enabled !== false,
      }
    }),
  }
}

export function eventPlanningError(intentValue, planValue) {
  if (!intentValue && !planValue) return ''
  const intent = normalizeIntentRecognition(intentValue)
  if (intent.detected === 'uncertain' && !intent.resolved) {
    return '请先确认按事件脉络规划，或沿用普通规划。'
  }
  if (intent.resolved === 'event_timeline' && !normalizeEventTaskPlan(planValue).tasks.some((task) => task.enabled)) {
    return '事件脉络规划至少需要保留一个启用任务。'
  }
  if (intent.resolved === 'event_timeline') {
    const invalidTask = normalizeEventTaskPlan(planValue).tasks.find((task) => (
      !task.objective.trim()
      || task.searchQueries.length < 1
      || task.searchQueries.length > 3
      || task.searchQueries.some((query) => query.length > 80)
    ))
    if (invalidTask) return `请补全“${invalidTask.dimension}”的任务描述和 1–3 个检索词。`
  }
  return ''
}

export function eventIntentLabel(intentValue) {
  const intent = normalizeIntentRecognition(intentValue)
  const value = intent.resolved || intent.detected
  if (value === 'event_timeline') return '事件脉络梳理'
  if (value === 'other') return '普通编报规划'
  return '意图待确认'
}

export function attachEventPlanningSteps(plan) {
  if (!plan || !hasEventPlanning(plan)) return plan
  const intent = normalizeIntentRecognition(plan.intentRecognition)
  const existing = (Array.isArray(plan.steps) ? plan.steps : [])
    .filter((step) => !['intent_recognition', 'event_tasks'].includes(step?.type))
  const steps = [
    {
      id: 'intent-recognition',
      type: 'intent_recognition',
      title: '意图识别',
      description: '确认当前主题是否需要按事件脉络进行结构化拆解。',
      allowMultiple: false,
      options: [],
    },
  ]
  if ((intent.resolved || intent.detected) !== 'other') {
    steps.push({
      id: 'event-tasks',
      type: 'event_tasks',
      title: '五维任务',
      description: '确认本次事件脉络调研的五个可执行维度。',
      allowMultiple: true,
      options: [],
    })
  }
  return {
    ...plan,
    intentRecognition: intent,
    eventTaskPlan: normalizeEventTaskPlan(plan.eventTaskPlan),
    steps: [...steps, ...existing],
  }
}
