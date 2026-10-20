<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { fetchResearchToolLog } from '../lib/api.js'
import { formatTimelineDuration } from '../lib/reportTechnicalTimeline.js'

const props = defineProps({
  jobId: { type: String, default: '' },
  running: { type: Boolean, default: false },
})
const items = ref([])
const loading = ref(false)
const unavailable = ref(false)
let generation = 0
let timer
const labels = { running: '调用中', completed: '完成', failed: '失败', fallback: '摘要回退', cached: '缓存命中' }
const hasArtifacts = computed(() => items.value.some((item) => item.evidence === 'artifact'))

watch(() => [props.jobId, props.running], () => {
  const current = ++generation
  clearTimeout(timer)
  items.value = []
  unavailable.value = false
  async function load() {
    if (!props.jobId || current !== generation) return
    loading.value = !items.value.length
    try {
      const result = await fetchResearchToolLog(props.jobId)
      if (current !== generation) return
      items.value = (result.items || []).filter((item) => ['Tavily Search', 'web_fetch', 'Web Fetch'].includes(item.tool))
      unavailable.value = Boolean(result.unavailable)
    } catch {
      if (current === generation) unavailable.value = true
    } finally {
      if (current === generation) {
        loading.value = false
        if (props.running) timer = setTimeout(load, 5000)
      }
    }
  }
  void load()
}, { immediate: true })

onBeforeUnmount(() => {
  generation++
  clearTimeout(timer)
})

function clock(value) {
  return value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '--'
}
function duration(value) {
  return Number.isFinite(value) ? formatTimelineDuration(value) : '--'
}
</script>

<template>
  <section class="research-tool-log" aria-label="深度采集工具调用">
    <header>
      <strong>工具调用</strong>
      <span>{{ items.length ? `${items.length} 条记录` : '--' }}</span>
    </header>
    <p v-if="hasArtifacts" class="tool-log-note">历史任务保留了工具结果；未记录的逐次调用时间、耗时显示为 --。</p>
    <p v-if="unavailable" class="tool-log-note" role="status">部分工具记录暂时无法读取。</p>
    <div v-if="items.length" class="tool-log-list">
      <div class="tool-log-columns" aria-hidden="true"><span>序号 / 时间</span><span>工具与调用记录</span><span>状态</span></div>
      <article v-for="(item, index) in items" :key="item.id" :class="`is-${item.status}`">
        <div class="tool-log-time"><span>{{ String(index + 1).padStart(3, '0') }}</span><time>{{ clock(item.occurredAt) }}</time></div>
        <div class="tool-log-content">
          <div class="tool-log-title"><strong>{{ item.tool }}</strong><small>分组 {{ item.group }}</small><small v-if="item.evidence === 'artifact'">结果记录</small></div>
          <div class="tool-log-meta"><span>耗时 {{ duration(item.durationMs) }}</span><span v-if="item.attempt">第 {{ item.attempt }} 次尝试</span></div>
          <pre v-if="item.input" class="tool-log-input">{{ item.input }}</pre>
          <details v-if="item.output" :open="item.status === 'failed' || item.status === 'fallback' || item.evidence === 'call'">
            <summary>{{ item.status === 'failed' ? '异常详情' : '返回结果' }}</summary>
            <pre>{{ item.output }}</pre>
          </details>
        </div>
        <span class="tool-log-status">{{ labels[item.status] || '--' }}</span>
      </article>
    </div>
    <p v-else class="tool-log-empty">{{ loading ? '正在读取工具记录…' : '暂无已保存的工具调用记录' }}</p>
  </section>
</template>

<style scoped>
.research-tool-log { min-width: 0; color: #334155; }
.research-tool-log > header { display: flex; justify-content: space-between; gap: 16px; padding: 16px; font-size: 14px; border-bottom: 1px solid #e2e8f0; }
.research-tool-log > header span, .tool-log-note { font-size: 12px; color: #64748b; }
.tool-log-note { margin: 0; padding: 10px 16px; line-height: 19px; border-bottom: 1px solid #e2e8f0; }
.tool-log-columns, .tool-log-list article { display: grid; grid-template-columns: 86px minmax(0, 1fr) 70px; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; }
.tool-log-columns { background: #f6f8fb; color: #64748b; font-size: 12px; padding-block: 10px; }
.tool-log-time { display: flex; flex-direction: column; gap: 8px; font-family: ui-monospace, monospace; font-size: 12px; color: #64748b; }
.tool-log-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: 14px; }
.tool-log-title small, .tool-log-meta { color: #64748b; font-size: 12px; }
.tool-log-meta { display: flex; flex-wrap: wrap; gap: 12px; margin: 6px 0; }
.tool-log-content { min-width: 0; }
.tool-log-content pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0 0; font: inherit; font-size: 14px; line-height: 22px; }
.tool-log-content details { margin-top: 10px; }
.tool-log-content summary { display: list-item; min-height: 0; padding: 0; border: 0; background: none; box-shadow: none; cursor: pointer; font-size: 12px; color: #475569; }
.tool-log-content summary::after { content: none; }
.tool-log-status { text-align: right; font-size: 12px; color: #475569; }
.is-running .tool-log-status { color: #2563eb; }
.is-failed .tool-log-status, .is-failed summary { color: #b91c1c; }
.is-fallback .tool-log-status { color: #92400e; }
.tool-log-empty { padding: 24px 16px; color: #64748b; font-size: 14px; }
@media (max-width: 600px) {
  .tool-log-columns, .tool-log-list article { grid-template-columns: 60px minmax(0, 1fr) 52px; gap: 8px; padding-inline: 10px; }
}
</style>
