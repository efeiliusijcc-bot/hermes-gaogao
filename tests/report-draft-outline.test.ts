import assert from 'node:assert/strict';
import {
  isDraftAssistantReportJob,
  normalizeReportDraftOutline,
} from '../b_k3ewYvsOEc1/src/lib/reportDraftOutline.js';

assert.equal(isDraftAssistantReportJob({ outlineId: 'outline-1', planId: 'plan-1' }), true);
assert.equal(isDraftAssistantReportJob({ planId: 'plan-1' }), false);

const outline = normalizeReportDraftOutline({
  outlineId: 'outline-1',
  versionNo: 3,
  editType: 'manual',
  outline: {
    reportTitle: '测试报告',
    reportTheme: '测试主题',
    coreArgument: '核心判断',
    outlineItems: [
      {
        title: '一、基本情况',
        summary: '说明事件背景。',
        children: [{ title: '（一）事件经过', summary: '梳理时间线。' }],
      },
    ],
    writingFocus: ['重点一'],
    sourceRequirements: [{ title: '权威来源', summary: '优先使用官方材料' }],
    uncertaintiesToVerify: ['待核事项'],
  },
});

assert.equal(outline.available, true);
assert.equal(outline.reportTitle, '测试报告');
assert.equal(outline.versionNo, 3);
assert.deepEqual(outline.outlineItems[0].children, [{ title: '（一）事件经过', summary: '梳理时间线。' }]);
assert.deepEqual(outline.sourceRequirements, ['权威来源：优先使用官方材料']);

console.log('report draft outline tests passed');
