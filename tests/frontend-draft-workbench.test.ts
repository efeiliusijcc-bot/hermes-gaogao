import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  draftContextSections,
  deriveDraftStepStates,
  deriveMaterialCoverage,
  eventInputSummary,
  parseEventLinks,
} from '../b_k3ewYvsOEc1/src/lib/draftWorkbench.js';

const parsedLinks = parseEventLinks('https://a.example\ninvalid\nftp://files.example');
assert.deepEqual(parsedLinks.valid, ['https://a.example/']);
assert.deepEqual(parsedLinks.invalid, ['invalid', 'ftp://files.example']);

const titleOnly = eventInputSummary({
  title: '测试事件',
  materials: '',
  linksText: '',
  category: '',
  region: '',
});
assert.equal(titleOnly.canAnalyze, true);
assert.equal(titleOnly.completion, 20);
assert.deepEqual(titleOnly.filled, ['事件标题']);
assert.deepEqual(titleOnly.missing, ['补充材料', '相关链接', '类别', '地区']);

const completeInput = eventInputSummary({
  title: '测试事件',
  materials: '背景材料',
  linksText: 'https://a.example',
  category: '国际',
  region: '欧洲',
});
assert.equal(completeInput.completion, 100);
assert.equal(completeInput.links.valid.length, 1);

const inputSteps = deriveDraftStepStates({ currentStep: 'input' });
assert.equal(inputSteps[0].status, 'current');
assert.equal(inputSteps[1].status, 'not_started');

const analysisSteps = deriveDraftStepStates({ currentStep: 'analysis', isAnalyzing: true });
assert.equal(analysisSteps[0].status, 'completed');
assert.equal(analysisSteps[1].status, 'processing');

const failedOutlineSteps = deriveDraftStepStates({
  currentStep: 'analysis',
  draftStatus: 'failed',
});
assert.equal(failedOutlineSteps[2].status, 'failed');

const dirtyConfirmSteps = deriveDraftStepStates({
  currentStep: 'confirm',
  hasEditChanges: true,
});
assert.equal(dirtyConfirmSteps[3].status, 'needs_attention');

const importingSteps = deriveDraftStepStates({
  currentStep: 'import',
  isImportingOutline: true,
});
assert.equal(importingSteps[4].status, 'processing');

const completedSteps = deriveDraftStepStates({
  currentStep: 'import',
  createdReportJob: { jobId: 'job-1' },
});
assert.equal(completedSteps[4].status, 'completed');

assert.deepEqual(draftContextSections('input'), ['guidance', 'completion', 'recent']);
assert.deepEqual(draftContextSections('analysis'), ['reanalyze', 'materials', 'generate']);
assert.deepEqual(draftContextSections('outline'), ['revision', 'versions', 'preview']);
assert.deepEqual(draftContextSections('confirm'), ['revision', 'versions', 'next']);
assert.deepEqual(draftContextSections('import'), ['instructions', 'coverage', 'import']);

assert.equal(deriveMaterialCoverage({ materials: '', validLinks: [] }).label, '待补充');
assert.equal(deriveMaterialCoverage({ materials: '背景', validLinks: [] }).label, '基础资料');
assert.equal(deriveMaterialCoverage({
  materials: '背景',
  validLinks: ['https://a.example/', 'https://b.example/'],
}).label, '资料较完整');
assert.equal(deriveMaterialCoverage({ importedPlan: { planId: 'p1' } }).label, '已形成导入计划');
assert.equal(deriveMaterialCoverage({}).collectedSourceCountLabel, '未提供');
assert.equal(deriveMaterialCoverage({ collectedSources: [{ id: 1 }, { id: 2 }] }).collectedSourceCountLabel, '2');

const assistantSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftAssistant.vue', import.meta.url),
  'utf8',
);
assert.doesNotMatch(assistantSource, /setTimeout\([^)]*manualUpdateDraftOutline/);
assert.match(assistantSource, /import DraftContextPanel from/);
assert.match(assistantSource, /import DraftStepNavigation from/);
assert.match(assistantSource, /import EventPreviewPanel from/);
assert.match(assistantSource, /<DraftContextPanel/);
assert.match(assistantSource, /<DraftStepNavigation/);
assert.match(assistantSource, /<EventPreviewPanel/);
assert.match(assistantSource, /grid-template-columns:\s*64px minmax\(720px, 1fr\)/);
assert.doesNotMatch(assistantSource, /draft-strategy-grid/);
assert.doesNotMatch(assistantSource, /expandedStrategyCards|sourceTypeTags|strategyVisibleItems|toggleStrategyCard/);
assert.doesNotMatch(assistantSource, /class="draft-toolbar"/);
assert.doesNotMatch(assistantSource, /按事件输入、事件分析、拟稿提纲、版本确认、导入编报推进拟稿流程/);

const navigationSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftStepNavigation.vue', import.meta.url),
  'utf8',
);
assert.match(navigationSource, /aria-current/);
assert.match(navigationSource, /step\.statusLabel/);
assert.match(navigationSource, /role="list"/);
assert.match(navigationSource, /needs_attention/);

const sourcePanelSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/EventSourcePanel.vue', import.meta.url),
  'utf8',
);
const previewPanelSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/EventPreviewPanel.vue', import.meta.url),
  'utf8',
);
assert.match(sourcePanelSource, /事件信息完整度/);
assert.match(sourcePanelSource, /maxlength="60"/);
assert.match(sourcePanelSource, /有效链接/);
assert.match(previewPanelSource, /事件输入预览/);
assert.match(previewPanelSource, /系统将执行/);
assert.match(previewPanelSource, /开始事件分析/);
assert.match(previewPanelSource, /当前资料较少/);

const strategySource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/StrategyTabs.vue', import.meta.url),
  'utf8',
);
const outlineViewSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftOutlineView.vue', import.meta.url),
  'utf8',
);
assert.match(strategySource, /editable/);
assert.match(strategySource, /role="tabpanel"/);
assert.doesNotMatch(outlineViewSource, /text-overflow:\s*ellipsis/);
assert.match(outlineViewSource, /overflow-wrap:\s*anywhere/);
assert.match(outlineViewSource, /aria-label="更多提纲操作"/);
assert.match(assistantSource, /aria-label="更多目录操作"/);
assert.match(assistantSource, /duplicateOutlineItem/);

const contextSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftContextPanel.vue', import.meta.url),
  'utf8',
);
assert.match(contextSource, /currentStep === 'input'/);
assert.match(contextSource, /currentStep === 'analysis'/);
assert.match(contextSource, /currentStep === 'outline'/);
assert.match(contextSource, /currentStep === 'confirm'/);
assert.match(contextSource, /currentStep === 'import'/);
assert.match(contextSource, /已采集资料数量/);
assert.match(contextSource, /collectedSourceCountLabel/);
assert.match(contextSource, /当前步骤暂不需要版本操作/);

const editorToolbarSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftEditorToolbar.vue', import.meta.url),
  'utf8',
);
assert.match(editorToolbarSource, /position:\s*sticky/);
assert.match(editorToolbarSource, /min-height:\s*68px/);

console.log('frontend draft workbench tests passed');
