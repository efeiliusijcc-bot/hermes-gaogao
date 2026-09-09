import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dataCanvasSource = readFileSync(new URL('../components/DataCanvas.vue', import.meta.url), 'utf8')
const controlPanelSource = readFileSync(new URL('../components/ControlPanel.vue', import.meta.url), 'utf8')
const flowSource = readFileSync(new URL('../components/ReportProgressStageFlow.vue', import.meta.url), 'utf8')
const timelineSource = readFileSync(new URL('../components/ReportTechnicalTimeline.vue', import.meta.url), 'utf8')
const mainStyles = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8')

test('the same horizontal stage flow is used for live and completed reports', () => {
  const usages = dataCanvasSource.match(/<ReportProgressStageFlow :stages="progressStageFlow" \/>/g) || []
  assert.equal(usages.length, 2)
  assert.doesNotMatch(dataCanvasSource, /class="task-stage-card"/)
  assert.doesNotMatch(flowSource, /report-progress-stage-connector|ChevronRight/)
  assert.match(flowSource, /report-progress-stage-current/)
  assert.match(flowSource, /overflow-x: auto/)
})

test('completed report progress opens technical details and uses readable stage typography', () => {
  assert.match(dataCanvasSource, /<details class="source-technical-details result-technical-details" open>/)
  assert.match(flowSource, /const allStagesDone = computed/)
  assert.match(flowSource, /report-progress-flow-list-all-done/)
  assert.match(flowSource, /v-if="!allStagesDone \|\| stage\.status !== 'done'"/)
  assert.match(flowSource, /report-progress-flow-list-all-done \.report-progress-stage \{[\s\S]*?min-height: 56px/)
  assert.match(flowSource, /\.report-progress-stage-title strong[\s\S]*?font-size: 14px/)
  assert.match(flowSource, /\.report-progress-stage-status[\s\S]*?font-size: 12px/)
})

test('completed report status is neutral without repeated success marks', () => {
  assert.doesNotMatch(flowSource, /CheckCircle2|#16a34a|#15803d/)
  assert.match(flowSource, /stage\.status !== 'done'/)
  assert.match(flowSource, /\.report-progress-stage-title > span \{[\s\S]*?color: #7a8599;/)
  assert.match(flowSource, /\.report-progress-stage-current \.report-progress-stage-title > span \{ color: #2563eb; \}/)

  assert.match(timelineSource, /const allStandardStagesDone = computed/)
  assert.match(timelineSource, /function stageMetaLabel\(group\)/)
  assert.match(timelineSource, /v-if="group\.status !== 'done'"/)
  assert.match(timelineSource, /v-if="activeStage\.status !== 'done'" class="technical-status"/)
  assert.match(timelineSource, /runtime-overview-metric-done dd \{ color: #475569; \}/)
  assert.match(timelineSource, /is-done \.technical-call-chain-node \{\s*background: #94a3b8;/)
  assert.match(timelineSource, /article\.is-done \.technical-log-status,[\s\S]*?color: #475569;/)
  assert.doesNotMatch(timelineSource, /#16a34a|#15803d|#0f766e/)

  assert.match(controlPanelSource, /v-else[\s\S]*?:class="statusClass\(item\.status\)"/)
  assert.match(controlPanelSource, /status === 'succeeded'\) return 'bg-neon-green/)
  assert.match(controlPanelSource, /healthOk \? 'bg-neon-green/)
})

test('technical details use a runtime overview and master-detail workspace', () => {
  assert.match(timelineSource, /class="runtime-overview"/)
  assert.match(timelineSource, /class="technical-master-detail"/)
  assert.match(timelineSource, /class="technical-stage-nav"/)
  assert.match(timelineSource, /class="technical-stage-workbench"/)
  assert.match(timelineSource, /任务状态/)
  assert.match(timelineSource, /运行时长/)
  assert.match(timelineSource, /props\.groups\.filter\(\(group\) => group\.key !== 'other'\)/)
  assert.match(timelineSource, /group\?\.key === 'other' \? '辅助'/)
  assert.match(timelineSource, /group\?\.key === 'other'\) return '辅助分组'/)
  assert.match(timelineSource, /group\?\.key === 'other' \? '辅助事件'/)
  assert.match(timelineSource, /standardStages\.length \}\} 阶段/)
  assert.match(timelineSource, /模型调用数[\s\S]*?value: '--'/)
  assert.match(timelineSource, /Tool 调用数[\s\S]*?value: '--'/)
  assert.doesNotMatch(timelineSource, /technical-timeline-table-header/)
})

test('technical workbench provides overview, call chain, input-output, and isolated log views', () => {
  assert.match(timelineSource, /key: 'overview', label: '概览'/)
  assert.match(timelineSource, /key: 'chain', label: '调用链'/)
  assert.match(timelineSource, /key: 'io', label: '输入输出'/)
  assert.match(timelineSource, /key: 'logs', label: '日志'/)
  assert.match(timelineSource, /class="technical-log-viewer"/)
  assert.match(timelineSource, /<span>序号<\/span>[\s\S]*?<span>时间<\/span>[\s\S]*?<span>事件与正文<\/span>[\s\S]*?<span>状态<\/span>/)
  assert.match(timelineSource, /<pre>\{\{ event\.raw \}\}<\/pre>/)
  assert.doesNotMatch(timelineSource, /<summary>原始记录<\/summary>/)
  assert.doesNotMatch(timelineSource, /#101722|#17202d/)
  assert.match(timelineSource, /\.technical-log-content pre[\s\S]*?font-size: 14px;[\s\S]*?line-height: 22px;/)
  assert.match(timelineSource, /grid-template-columns: minmax\(196px, 208px\) minmax\(0, 1fr\)/)
  assert.match(dataCanvasSource, /class="log-new-items-button"/)
})

test('report header follows the reference tab, actions, and metadata hierarchy', () => {
  const stickyPanel = dataCanvasSource.match(/<div class="result-sticky-panel"[\s\S]*?<section v-if="activeResultTab/)?.[0] || ''

  assert.doesNotMatch(stickyPanel, /class="result-identity-row"/)
  assert.match(stickyPanel, /class="result-toolbar"[\s\S]*?class="result-tabs"[\s\S]*?class="result-actions"[\s\S]*?class="result-info-bar"/)
  assert.match(stickyPanel, /v-for="item in resultInfoItems"/)
  assert.match(dataCanvasSource, /class="result-tab-panel task-progress-result-panel"/)
  assert.match(controlPanelSource, /class="recent-history-stack"/)
  assert.match(mainStyles, /\.sidebar-shell \{[\s\S]*?width: clamp\(240px, 18vw, 320px\) !important;/)
  assert.match(mainStyles, /\.recent-history-stack \.history-item[\s\S]*?border-radius: 16px !important;/)
  assert.match(mainStyles, /\.result-toolbar \{[\s\S]*?flex-wrap: wrap;[\s\S]*?gap: 18px;/)
  assert.match(mainStyles, /\.result-tabs \{[\s\S]*?border-radius: 14px;[\s\S]*?box-shadow: 0 12px 28px/)
  assert.match(mainStyles, /\.result-action-btn \{[\s\S]*?min-height: 42px;[\s\S]*?border-radius: 12px;/)
  assert.match(mainStyles, /\.task-progress-result-panel \{\s*max-width: none;/)
  assert.match(mainStyles, /\.result-sticky-panel \{[\s\S]*?position: sticky;[\s\S]*?top: -28px;[\s\S]*?z-index: 30;/)
  assert.match(mainStyles, /\.result-technical-details \.source-technical-log \{[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/)
})

test('failed stages are selected automatically and open the log view', () => {
  assert.match(timelineSource, /const failedStage = props\.groups\.find\(\(group\) => group\.status === 'error'\)/)
  assert.match(timelineSource, /activeStageKey\.value = failedStage\.key[\s\S]*?activeView\.value = 'logs'/)
  assert.match(timelineSource, /class="technical-stage-alert"/)
})

test('report loading restores the pre-orb indicators without replacing stage or log content', () => {
  assert.doesNotMatch(dataCanvasSource, /ReportOrbLoader|defineAsyncComponent/)
  assert.match(dataCanvasSource, /class="source-status-orbit" :class="`source-status-\$\{taskProgressView\.tone\}`"/)
  assert.match(mainStyles, /\.source-status-orbit \{[\s\S]*?width: 78px;[\s\S]*?height: 78px;/)
  assert.match(dataCanvasSource, /<ReportProgressStageFlow :stages="progressStageFlow" \/>/)
  assert.match(dataCanvasSource, /<details class="source-technical-details" open>/)
  assert.match(dataCanvasSource, /<div v-if="isPlanning"[\s\S]*?class="nexus-loader scale-75 mx-auto"[\s\S]*?正在生成编报规划/)
})
