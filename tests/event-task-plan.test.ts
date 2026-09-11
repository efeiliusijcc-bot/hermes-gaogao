import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEventTaskPlan,
  eventPlanningValidationError,
  normalizeEventTaskPlan,
  normalizeIntentRecognition,
  normalizeSubmittedEventPlanning,
  submittedEventTaskPlanValidationError,
} from '../server/event-task-plan.js';

const IDS = ['event_time', 'participants', 'event_causes', 'event_content', 'event_location'];

test('builds the five event tasks in the fixed contract order', () => {
  const plan = buildEventTaskPlan('测试事件');
  assert.deepEqual(plan.tasks.map((task) => task.id), IDS);
  assert.ok(plan.tasks.every((task) => task.enabled));
  assert.ok(plan.tasks.every((task) => task.objective.includes('测试事件')));
  assert.ok(plan.tasks.every((task) => task.searchQueries.length >= 1 && task.searchQueries.length <= 3));
});

test('normalizes task fields while refusing client-defined dimensions', () => {
  const plan = normalizeEventTaskPlan({
    tasks: [
      {
        id: 'event_time',
        dimension: '伪造维度',
        title: '伪造标题',
        objective: 'A'.repeat(700),
        searchQueries: [' 查询一 ', '查询一', 'B'.repeat(100), '多余查询'],
        enabled: false,
      },
      { id: 'unknown', objective: '不应保留' },
    ],
  }, '测试事件');
  assert.deepEqual(plan.tasks.map((task) => task.id), IDS);
  assert.equal(plan.tasks[0].dimension, '发生时间');
  assert.equal(plan.tasks[0].title, '核实事件时间');
  assert.equal(plan.tasks[0].objective.length, 500);
  assert.deepEqual(plan.tasks[0].searchQueries.map((item) => item.length), [3, 80, 4]);
  assert.equal(plan.tasks[0].enabled, false);
});

test('requires an explicit decision for uncertain intent', () => {
  const intent = normalizeIntentRecognition({ detected: 'uncertain', reason: '信息不足', source: 'fallback' });
  const plan = buildEventTaskPlan('测试事件');
  assert.match(eventPlanningValidationError(intent, plan), /确认/);
  const confirmed = normalizeSubmittedEventPlanning(
    intent,
    { ...intent, resolved: 'event_timeline' },
    plan,
    '测试事件',
  );
  assert.equal(confirmed.intentRecognition.resolved, 'event_timeline');
});

test('does not accept a model-provided resolution for an uncertain detection', () => {
  const intent = normalizeIntentRecognition({
    detected: 'uncertain',
    resolved: 'event_timeline',
    reason: '模型仍不确定',
    source: 'model',
  }, { source: 'model', allowUncertainResolution: false });
  assert.equal(intent.resolved, null);
  assert.match(eventPlanningValidationError(intent, buildEventTaskPlan('测试事件')), /确认/);
});

test('requires at least one enabled task for event planning', () => {
  const intent = normalizeIntentRecognition({ detected: 'event_timeline', source: 'model' });
  const disabled = { ...buildEventTaskPlan('测试事件'), tasks: buildEventTaskPlan('测试事件').tasks.map((task) => ({ ...task, enabled: false })) };
  assert.throws(
    () => normalizeSubmittedEventPlanning(intent, intent, disabled, '测试事件'),
    /至少需要保留一个/,
  );
});

test('keeps a model-confirmed non-event route on ordinary planning', () => {
  const stored = normalizeIntentRecognition({ detected: 'other', reason: '主题不是具体事件', source: 'model' });
  const submitted = normalizeSubmittedEventPlanning(
    stored,
    { ...stored, resolved: 'event_timeline' },
    buildEventTaskPlan('行业概览'),
    '行业概览',
  );
  assert.equal(submitted.intentRecognition.resolved, 'other');
  assert.ok(submitted.eventTaskPlan.tasks.every((task) => !task.enabled));
});

test('rejects incomplete or blank submitted event tasks instead of silently rebuilding them', () => {
  const plan = buildEventTaskPlan('测试事件');
  assert.match(submittedEventTaskPlanValidationError({ tasks: plan.tasks.slice(0, 4) }), /完整保留/);
  assert.match(submittedEventTaskPlanValidationError({
    ...plan,
    tasks: plan.tasks.map((task) => task.id === 'participants' ? { ...task, searchQueries: [] } : task),
  }), /参与方.*1–3/);
  assert.throws(
    () => normalizeSubmittedEventPlanning(
      { detected: 'event_timeline', resolved: 'event_timeline', source: 'model' },
      { detected: 'event_timeline', resolved: 'event_timeline', source: 'model' },
      { ...plan, tasks: plan.tasks.map((task) => task.id === 'event_time' ? { ...task, objective: ' ' } : task) },
      '测试事件',
    ),
    /发生时间.*任务描述/,
  );
});
