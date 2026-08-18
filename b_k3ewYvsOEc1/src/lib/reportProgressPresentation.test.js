import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dataCanvasSource = readFileSync(new URL('../components/DataCanvas.vue', import.meta.url), 'utf8')
const flowSource = readFileSync(new URL('../components/ReportProgressStageFlow.vue', import.meta.url), 'utf8')
const timelineSource = readFileSync(new URL('../components/ReportTechnicalTimeline.vue', import.meta.url), 'utf8')
const orbLoaderSource = readFileSync(new URL('../components/ReportOrbLoader.vue', import.meta.url), 'utf8')
const orbRendererSource = readFileSync(new URL('./report-orb/renderer.ts', import.meta.url), 'utf8')
const orbPresetSource = readFileSync(new URL('./report-orb/preset.ts', import.meta.url), 'utf8')
const orbShaderSource = readFileSync(new URL('./report-orb/shader-source.ts', import.meta.url), 'utf8')
const orbLicenseSource = readFileSync(new URL('./report-orb/LICENSE', import.meta.url), 'utf8')
const orbUpstreamSource = readFileSync(new URL('./report-orb/UPSTREAM.md', import.meta.url), 'utf8')

test('the same horizontal stage flow is used for live and completed reports', () => {
  const usages = dataCanvasSource.match(/<ReportProgressStageFlow :stages="progressStageFlow" \/>/g) || []
  assert.equal(usages.length, 2)
  assert.doesNotMatch(dataCanvasSource, /class="task-stage-card"/)
  assert.match(flowSource, /report-progress-stage-connector/)
  assert.match(flowSource, /report-progress-stage-current/)
  assert.match(flowSource, /overflow-x: auto/)
})

test('completed report progress opens technical details and uses a fuller stage scale', () => {
  assert.match(dataCanvasSource, /<details class="source-technical-details result-technical-details" open>/)
  assert.match(flowSource, /min-height: 84px/)
  assert.match(flowSource, /font-size: 13px/)
})

test('stage summaries follow the reference table hierarchy', () => {
  assert.match(timelineSource, /class="technical-timeline-table-header"/)
  assert.match(timelineSource, /<span>开始时间<\/span>/)
  assert.match(timelineSource, /<span>结束时间<\/span>/)
  assert.match(timelineSource, /<span>耗时<\/span>/)
  assert.match(timelineSource, /class="technical-timeline-stage-current"|`technical-timeline-stage-\$\{group\.status\}`/)
})

test('existing execution log cards and raw record details remain available', () => {
  assert.match(timelineSource, /class="technical-timeline-event"/)
  assert.match(timelineSource, /class="technical-timeline-event-raw"/)
  assert.match(timelineSource, /<summary>原始记录<\/summary>/)
  assert.match(dataCanvasSource, /class="log-new-items-button"/)
})

test('live report progress uses the liquid orb loader without replacing stage or log content', () => {
  assert.match(dataCanvasSource, /const ReportOrbLoader = defineAsyncComponent\(\(\) => import\('\.\/ReportOrbLoader\.vue'\)\)/)
  assert.equal((dataCanvasSource.match(/<ReportOrbLoader \/>/g) || []).length, 2)
  assert.doesNotMatch(dataCanvasSource, /class="source-status-orbit"/)
  assert.match(dataCanvasSource, /<ReportProgressStageFlow :stages="progressStageFlow" \/>/)
  assert.match(dataCanvasSource, /<details class="source-technical-details" open>/)
})

test('report planning uses the same liquid orb instead of the legacy ring loader', () => {
  assert.match(dataCanvasSource, /<div v-if="isPlanning"[\s\S]*?<ReportOrbLoader \/>[\s\S]*?正在生成编报规划/)
  assert.doesNotMatch(dataCanvasSource, /<div v-if="isPlanning"[\s\S]*?class="nexus-loader scale-75 mx-auto"/)
})

test('the report orb loader is responsive, accessible, and keeps a non-WebGPU fallback', () => {
  assert.match(orbLoaderSource, /<canvas[\s\S]*aria-hidden="true"|aria-hidden="true"[\s\S]*<canvas/)
  assert.match(orbLoaderSource, /renderState\.value = 'fallback'/)
  assert.match(orbLoaderSource, /LoaderCircle/)
  assert.match(orbLoaderSource, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/)
  assert.match(orbLoaderSource, /animate: !reducedMotion\.value/)
  assert.match(orbLoaderSource, /width: clamp\(160px, 14vw, 188px\)/)
  assert.match(orbLoaderSource, /@media \(max-width: 640px\)[\s\S]*width: clamp\(112px, 34vw, 132px\)/)
  assert.match(orbLoaderSource, /onBeforeUnmount\([\s\S]*destroyRenderer\(\)/)
})

test('the WebGPU renderer limits sustained work and cleans up browser resources', () => {
  assert.match(orbLoaderSource, /maxFps: 30/)
  assert.match(orbLoaderSource, /maxDevicePixelRatio: 1\.5/)
  assert.match(orbRendererSource, /document\.visibilityState !== 'hidden'/)
  assert.match(orbRendererSource, /addEventListener\('visibilitychange'/)
  assert.match(orbRendererSource, /removeEventListener\('visibilitychange'/)
  assert.match(orbRendererSource, /if \(animate \|\| !readyNotified\) scheduleFrame\(frame\)/)
  assert.match(orbRendererSource, /frameInterval/)
  assert.match(orbRendererSource, /gpuContext\?\.unconfigure\(\)/)
  assert.match(orbRendererSource, /device\?\.destroy\(\)/)
  assert.match(orbRendererSource, /if \(!navigator\.gpu\)/)
})

test('the vendored orb keeps a restrained Hermes palette and upstream attribution', () => {
  assert.match(orbPresetSource, /style: 'opal'/)
  assert.match(orbPresetSource, /radius: 0\.88/)
  assert.match(orbPresetSource, /colorB: '#34D399'/)
  assert.match(orbPresetSource, /colorC: '#38BDF8'/)
  assert.match(orbPresetSource, /colorD: '#2563EB'/)
  assert.match(orbShaderSource, /effect\.wgsl\?raw/)
  assert.match(orbLicenseSource, /MIT License/)
  assert.match(orbLicenseSource, /Copyright \(c\) 2026 LerSent001/)
  assert.match(orbUpstreamSource, /https:\/\/github\.com\/LerSent001\/orb/)
  assert.match(orbUpstreamSource, /6e12177a41a5dc773689133fc4360a355ad1b1b4/)
})
