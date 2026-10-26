import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const component = (name) => readFileSync(new URL(`../components/${name}.vue`, import.meta.url), 'utf8')
const manual = component('UserManual')
const canvas = component('DataCanvas')
const draft = component('DraftAssistant')
const daily = component('DailyAwareness')

test('manual identifies the UI revision it was checked against', () => {
  assert.match(manual, /datetime="2026-10-26"/)
  assert.match(manual, /流程示意，非实际页面截图/)
})

test('report planning documents resume, account boundaries and uncertain submission', () => {
  for (const label of ['生成编报规划', '确认并开始编写', '稍后继续', '继续规划', '放弃规划', '提交结果待核实']) {
    assert.ok(canvas.includes(label), `Missing UI action: ${label}`)
    assert.ok(manual.includes(label), `Missing manual action: ${label}`)
  }
  assert.match(manual, /每个账号、每个标签页/)
  assert.match(manual, /关闭标签页/)
  assert.match(manual, /当前仅临时保存，刷新可能丢失/)
  assert.match(manual, /不会自动再次提交/)
})

test('draft confirmation matches the direct job creation workflow', () => {
  assert.match(draft, /确认并创建深度编报/)
  assert.match(draft, /await importDraftOutline[\s\S]*?await createReportJob/)
  assert.match(manual, /确认并创建深度编报/)
  assert.match(manual, /直接创建深度编报任务，不再进入.*规划弹窗/)
  assert.doesNotMatch(manual, /把拟稿材料和提纲带入编报规划|之后仍需确认信源和研究方向|拖动阅读/)
})

test('daily import is prefill-only, and category filters do not scope export', () => {
  assert.match(draft, /prefillOnly/)
  assert.match(manual, /只填入.*输入框，不会自动分析或生成报告/)
  assert.match(component('DraftSourceComposer'), /aria-label="开始拟稿"/)
  assert.match(manual, /开始拟稿/)
  assert.match(daily, /downloadDailyAwarenessByDate\(activeBrief.value.businessDate, 'docx'\)/)
  assert.match(manual, /分类筛选只影响卡片列表/)
  assert.match(manual, /复制和 Word 导出.*整期简报/)
  for (const label of ['标准版', '部分摘要版', '简要版']) assert.ok(manual.includes(label))
})

test('background draft analysis has its own recovery and retry instructions', () => {
  assert.match(component('DraftAnalysisNotice'), /拟稿分析已完成/)
  assert.match(manual, /拟稿分析已完成/)
  assert.match(manual, /同一账号同时只能有一条进行中的事件分析/)
  assert.match(manual, /重试分析/)
  assert.match(manual, /不要把“连接中断”当作任务已失败/)
})

test('report editing and technical records are described within their actual UI limits', () => {
  assert.match(canvas, /const REPORT_EDIT_ENABLED = false/)
  assert.match(manual, /当前页面不提供正文在线编辑/)
  assert.doesNotMatch(manual, /阅读、编辑并导出最终报告|成稿和信源已保存，可继续编辑/)
  assert.match(manual, /输入输出.*日志/)
  assert.match(manual, /Tavily Search.*Web Fetch/)
  assert.match(manual, /不代表后台全部调用都成功/)
})

test('QA import instructions use the current explicit import actions', () => {
  for (const label of ['加入背景选择', '一键导入当前回答', '导入到编报背景']) {
    assert.ok(canvas.includes(label))
    assert.ok(manual.includes(label))
  }
  assert.match(manual, /继续原规划.*放弃并新建/)
})
