import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachEventPlanningSteps,
  eventPlanningError,
  hasEventPlanning,
  normalizeEventTaskPlan,
} from './eventTaskPlan.js'

const plan = {
  intentRecognition: { detected: 'uncertain', resolved: null, reason: '需要确认', source: 'fallback' },
  eventTaskPlan: {
    version: 1,
    tasks: [
      { id: 'event_time', objective: '核实时间', searchQueries: ['事件 时间'], enabled: true },
      { id: 'participants', objective: '核实主体', searchQueries: ['事件 主体'], enabled: true },
      { id: 'event_causes', objective: '核实原因', searchQueries: ['事件 原因'], enabled: true },
      { id: 'event_content', objective: '核实内容', searchQueries: ['事件 内容'], enabled: true },
      { id: 'event_location', objective: '核实地点', searchQueries: ['事件 地点'], enabled: true },
    ],
  },
  steps: [{ id: 'source', type: 'source_scope', options: [] }],
}

test('adds intent and five-dimensional task steps before existing planning steps', () => {
  const normalized = attachEventPlanningSteps(plan)
  assert.deepEqual(normalized.steps.map((step) => step.type), ['intent_recognition', 'event_tasks', 'source_scope'])
  assert.match(eventPlanningError(normalized.intentRecognition, normalized.eventTaskPlan), /确认/)
})

test('removes the five-dimensional step for the ordinary route and restores it for the event route', () => {
  const ordinary = attachEventPlanningSteps({
    ...plan,
    intentRecognition: { ...plan.intentRecognition, resolved: 'other' },
  })
  assert.deepEqual(ordinary.steps.map((step) => step.type), ['intent_recognition', 'source_scope'])

  const event = attachEventPlanningSteps({
    ...ordinary,
    intentRecognition: { ...ordinary.intentRecognition, resolved: 'event_timeline' },
  })
  assert.deepEqual(event.steps.map((step) => step.type), ['intent_recognition', 'event_tasks', 'source_scope'])
})

test('preserves the fixed five task identities and historical absence', () => {
  assert.equal(hasEventPlanning({}), false)
  assert.deepEqual(
    normalizeEventTaskPlan(plan.eventTaskPlan).tasks.map((task) => task.id),
    ['event_time', 'participants', 'event_causes', 'event_content', 'event_location'],
  )
  assert.equal(eventPlanningError(null, null), '')
})

test('requires descriptions and search queries for the event route', () => {
  const eventIntent = { ...plan.intentRecognition, resolved: 'event_timeline' }
  const missingQueryPlan = {
    ...plan.eventTaskPlan,
    tasks: plan.eventTaskPlan.tasks.map((task) => task.id === 'event_location'
      ? { ...task, searchQueries: [] }
      : task),
  }
  assert.match(eventPlanningError(eventIntent, missingQueryPlan), /发生地点/)
})
