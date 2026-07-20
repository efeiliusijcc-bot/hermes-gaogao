import assert from 'node:assert/strict';
import {
  buildPlanningContextPayload,
  parseStructuredPlanningContext,
} from '../b_k3ewYvsOEc1/src/lib/reportPlanningContext.js';

const context = {
  kind: 'structured_report_context',
  topic: '测试主题',
  selectedSearchQueries: ['测试检索词'],
  selectedSources: [{ id: 'public_news', label: '公开新闻报道' }],
  selectedModules: [{ stepId: 'basic', sectionTitle: '基本情况', selectedDirections: [{ id: 'facts', label: '关键事实' }] }],
};

const payload = buildPlanningContextPayload({
  topic: '测试主题',
  knownContext: JSON.stringify(context),
});

assert.deepEqual(payload.planningContext, context);
assert.deepEqual(parseStructuredPlanningContext(payload.planningContext), context);
assert.deepEqual(parseStructuredPlanningContext(JSON.stringify(context)), context);
assert.deepEqual(parseStructuredPlanningContext(JSON.stringify(JSON.stringify(context))), context);

console.log('report planning context tests passed');
