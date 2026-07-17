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
const sourceComposer = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftSourceComposer.vue', import.meta.url),
  'utf8',
);
const analysisSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftAnalysisView.vue', import.meta.url),
  'utf8',
);
const historySource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftHistorySidebar.vue', import.meta.url),
  'utf8',
);
const outlineEditorSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue', import.meta.url),
  'utf8',
);
const outlineViewSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftOutlineView.vue', import.meta.url),
  'utf8',
);
const importStateSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftImportState.vue', import.meta.url),
  'utf8',
);
const outlineDockStart = outlineEditorSource.indexOf('<section\n      class="draft-ai-revision"');
const outlineDockEnd = outlineEditorSource.indexOf('</section>', outlineDockStart);
const outlineDockSource = outlineEditorSource.slice(outlineDockStart, outlineDockEnd);
const confirmStageStart = assistantSource.indexOf("stage === 'confirm'");
const confirmStageEnd = assistantSource.indexOf('<DraftImportState', confirmStageStart);
const confirmStageSource = assistantSource.slice(confirmStageStart, confirmStageEnd);

assert.match(sourceComposer, /<AutoResizeTextarea/);
assert.match(sourceComposer, /开始编报/);
assert.doesNotMatch(sourceComposer, /事件分类|地区选择|信息完整度|最近草稿|独立链接/);
assert.match(analysisSource, /事件概括/);
assert.match(analysisSource, /核心主体/);
assert.match(analysisSource, /时间与地点/);
assert.match(analysisSource, /关键事实/);
assert.match(analysisSource, /涉我风险/);
assert.match(historySource, /role="dialog"/);
assert.match(historySource, /搜索历史编报/);
assert.match(historySource, /新建编报/);
assert.doesNotMatch(historySource, /删除/);
assert.doesNotMatch(historySource, /history-sidebar-tabs|最近编辑|全部事件/);
assert.match(outlineEditorSource, /update:modelValue/);
assert.match(outlineEditorSource, /已自动保存/);
assert.match(outlineEditorSource, /保存中/);
assert.match(outlineEditorSource, /保存失败/);
assert.match(outlineEditorSource, /未保存/);
assert.match(outlineEditorSource, /AI 修改/);
assert.match(outlineEditorSource, /const revisionFocused = ref\(false\)/);
assert.match(outlineEditorSource, /const dockExpanded = computed/);
assert.match(outlineEditorSource, /:class="\{ expanded: dockExpanded \}"/);
assert.match(outlineEditorSource, /@focus="revisionFocused = true"/);
assert.match(outlineEditorSource, /@blur="revisionFocused = false"/);
assert.match(outlineEditorSource, /position:\s*fixed/);
assert.match(outlineEditorSource, /padding-bottom:\s*220px/);
assert.ok(outlineDockStart >= 0 && outlineDockEnd > outlineDockStart);
assert.match(outlineDockSource, /class="draft-dock-back"/);
assert.match(outlineDockSource, /class="draft-ai-revision-main"/);
assert.match(outlineDockSource, /class="draft-dock-confirm"/);
assert.ok(outlineDockSource.indexOf('draft-dock-back') < outlineDockSource.indexOf('draft-ai-revision-main'));
assert.ok(outlineDockSource.indexOf('draft-ai-revision-main') < outlineDockSource.indexOf('draft-dock-confirm'));
assert.equal((outlineEditorSource.match(/返回事件分析/g) || []).length, 1);
assert.equal((outlineEditorSource.match(/下一步：确认提纲/g) || []).length, 1);
assert.doesNotMatch(outlineEditorSource, /draft-editor-footer/);
assert.match(outlineEditorSource, /grid-template-areas:\s*"back ai confirm"/);
assert.match(outlineEditorSource, /"ai-title ai-input ai-input"\s*"back revise confirm"/);
assert.doesNotMatch(outlineEditorSource, /transition:\s*min-height/);
assert.match(outlineEditorSource, /<AutoResizeTextarea/);
assert.doesNotMatch(outlineEditorSource, /V\d|版本记录|恢复旧版本|版本比较/);
assert.doesNotMatch(outlineViewSource, /emit\('edit'\)|编辑提纲|更多提纲操作/);
assert.match(outlineViewSource, /overflow-wrap:\s*anywhere/);
assert.match(importStateSource, /正在创建深度编报任务/);
assert.match(importStateSource, /重新尝试/);
assert.doesNotMatch(importStateSource, /导入配置|数据库信源|回溯天数/);

assert.match(assistantSource, /<DraftSourceComposer/);
assert.match(assistantSource, /<DraftAnalysisView/);
assert.match(assistantSource, /<DraftOutlineEditor/);
assert.match(assistantSource, /<DraftOutlineView/);
assert.match(assistantSource, /<DraftImportState/);
assert.match(assistantSource, /<DraftHistorySidebar/);
assert.ok(confirmStageStart >= 0 && confirmStageEnd > confirmStageStart);
assert.match(confirmStageSource, /<footer class="draft-confirm-actions">/);
assert.ok(confirmStageSource.indexOf('返回修改') < confirmStageSource.indexOf('确认并创建深度编报'));
assert.equal((confirmStageSource.match(/返回修改/g) || []).length, 1);
assert.equal((confirmStageSource.match(/确认并创建深度编报/g) || []).length, 1);
assert.match(assistantSource, /\.draft-confirm-actions\s*\{[^}]*position:\s*fixed/);
assert.match(assistantSource, /width:\s*min\(920px,\s*calc\(100vw - 56px\)\)/);
assert.match(assistantSource, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
assert.match(assistantSource, /\.draft-confirmation\s*\{[^}]*padding:\s*24px 0 160px/);
assert.doesNotMatch(assistantSource, /返回工作台/);
assert.doesNotMatch(assistantSource, /canShowHistory/);
assert.doesNotMatch(assistantSource, /handleBack/);
assert.match(assistantSource, /aria-label="查看历史编报"/);
assert.equal((assistantSource.match(/<History/g) || []).length, 1);
assert.match(assistantSource, /<span class="draft-bar-spacer"/);
assert.doesNotMatch(assistantSource, /<DraftStepNavigation/);
assert.doesNotMatch(assistantSource, /<DraftContextPanel/);
assert.doesNotMatch(assistantSource, /<EventSourcePanel/);
assert.doesNotMatch(assistantSource, /<EventPreviewPanel/);
assert.doesNotMatch(assistantSource, /<StrategyTabs/);

assert.doesNotMatch(assistantSource, /getDraftEventOutlines|getDraftOutline|outlineVersions|versionLabel/);
assert.match(assistantSource, /buildDraftAnalyzePayload\(sourceInput\.value\)/);
assert.match(assistantSource, /buildDraftAnalysisSections/);
assert.match(assistantSource, /restoredDraftStage/);
assert.match(assistantSource, /createDraftAutosave/);
assert.match(assistantSource, /await autosave\.flush\(\)/);
assert.match(assistantSource, /await importDraftOutline/);
assert.match(assistantSource, /await createReportJob/);
assert.match(assistantSource, /emit\('report-job-created'/);
assert.doesNotMatch(assistantSource, /导入配置|确认当前提纲版本|保存为新版本|V\$\{|V\d/);

assert.doesNotMatch(assistantSource, /setTimeout\([^)]*manualUpdateDraftOutline/);

console.log('frontend draft workbench tests passed');
