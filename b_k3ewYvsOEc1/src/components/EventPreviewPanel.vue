<script setup>
import { computed } from 'vue'

const props = defineProps({
  form: { type: Object, required: true },
  summary: { type: Object, required: true },
  analyzing: { type: Boolean, default: false },
})

const emit = defineEmits(['analyze'])

const materialPreview = computed(() => {
  const text = String(props.form.materials || '').trim()
  if (!text) return '尚未补充背景材料。可以仅使用事件标题继续分析，系统会将信息缺口标记为待核实。'
  return text.length > 280 ? `${text.slice(0, 280)}…` : text
})

const executionItems = [
  ['01', '提取核心实体', '识别事件涉及的主体、机构、地点和关键对象。'],
  ['02', '识别关键事实', '梳理已知事实、时间节点和材料中的主要信息。'],
  ['03', '分析背景和风险', '形成基本情况、各方态度和结构化风险研判。'],
  ['04', '生成写作重点', '提炼后续编报应重点回答的问题和核查方向。'],
  ['05', '形成拟稿提纲', '在分析确认后生成可编辑、可版本化的目录提纲。'],
]
</script>

<template>
  <section class="event-preview-panel">
    <header>
      <div>
        <span>Step 1 · 当前工作</span>
        <h2>事件输入预览</h2>
        <p>检查输入内容，并了解开始分析后系统将完成哪些工作。</p>
      </div>
      <strong>{{ summary.completion }}% 完整</strong>
    </header>

    <section class="event-preview-summary">
      <div class="event-preview-title">
        <span>事件标题</span>
        <h3>{{ form.title || '请先填写事件标题' }}</h3>
      </div>
      <div class="event-preview-meta">
        <span>{{ form.category || '类别待补充' }}</span>
        <span>{{ form.region || '地区待补充' }}</span>
        <span>{{ summary.links.valid.length }} 个有效链接</span>
      </div>
      <div class="event-preview-material">
        <strong>材料摘要</strong>
        <p>{{ materialPreview }}</p>
      </div>
    </section>

    <section class="event-execution">
      <div class="event-section-head">
        <div>
          <h3>系统将执行</h3>
          <p>分析结果会作为拟稿提纲的事实和策略基础。</p>
        </div>
      </div>
      <ol>
        <li v-for="item in executionItems" :key="item[0]">
          <span>{{ item[0] }}</span>
          <div><strong>{{ item[1] }}</strong><p>{{ item[2] }}</p></div>
        </li>
      </ol>
    </section>

    <footer>
      <div v-if="summary.canAnalyze && summary.completion < 60" class="event-sparse-notice">
        <strong>当前资料较少</strong>
        <span>系统仍可分析，但部分结论可能标记为待核实。</span>
      </div>
      <div v-else-if="!summary.canAnalyze" class="event-required-notice">
        <strong>还缺少事件标题</strong>
        <span>填写标题后即可开始事件分析。</span>
      </div>
      <button type="button" :disabled="!summary.canAnalyze || analyzing" @click="emit('analyze')">
        {{ analyzing ? '正在分析事件…' : '开始事件分析' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.event-preview-panel { display: flex; flex-direction: column; min-width: 0; min-height: 640px; border: 1px solid rgba(148, 163, 184, 0.24); background: #fff; border-radius: 8px; padding: 24px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.05); }
.event-preview-panel > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid #e2e8f0; }
.event-preview-panel > header span { color: #2563eb; font-size: 11px; font-weight: 900; }
.event-preview-panel h2,
.event-preview-panel h3,
.event-preview-panel p { margin: 0; letter-spacing: 0; }
.event-preview-panel h2 { margin-top: 5px; color: #0f172a; font-size: 23px; font-weight: 900; }
.event-preview-panel > header p { margin-top: 6px; color: #64748b; font-size: 13px; line-height: 1.7; }
.event-preview-panel > header > strong { border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; border-radius: 7px; padding: 6px 9px; font-size: 11px; white-space: nowrap; }
.event-preview-summary { padding: 20px 0; border-bottom: 1px solid #e2e8f0; }
.event-preview-title > span,
.event-preview-material > strong { color: #64748b; font-size: 11px; font-weight: 900; }
.event-preview-title h3 { margin-top: 7px; color: #172033; font-size: 20px; font-weight: 900; line-height: 1.55; overflow-wrap: anywhere; }
.event-preview-meta { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
.event-preview-meta span { border: 1px solid #dbe3ef; background: #f8fafc; color: #475569; border-radius: 7px; padding: 5px 8px; font-size: 11px; }
.event-preview-material { margin-top: 18px; border-left: 3px solid #93c5fd; padding-left: 14px; }
.event-preview-material p { margin-top: 6px; color: #475569; font-size: 14px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.event-execution { padding: 20px 0; }
.event-section-head h3 { color: #0f172a; font-size: 17px; font-weight: 900; }
.event-section-head p { margin-top: 4px; color: #64748b; font-size: 12px; }
.event-execution ol { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; margin: 16px 0 0; padding: 0; list-style: none; }
.event-execution li { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; min-width: 0; padding: 13px 0; border-bottom: 1px solid #eef2f7; }
.event-execution li > span { color: #2563eb; font-size: 11px; font-weight: 900; }
.event-execution li strong { color: #253247; font-size: 13px; }
.event-execution li p { margin-top: 4px; color: #64748b; font-size: 12px; line-height: 1.65; }
.event-preview-panel > footer { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: auto; border-top: 1px solid #e2e8f0; padding-top: 18px; }
.event-sparse-notice,
.event-required-notice { display: grid; gap: 3px; min-width: 0; }
.event-sparse-notice strong,
.event-required-notice strong { color: #b45309; font-size: 12px; }
.event-required-notice strong { color: #475569; }
.event-sparse-notice span,
.event-required-notice span { color: #64748b; font-size: 11px; line-height: 1.5; }
.event-preview-panel > footer button { min-width: 164px; min-height: 42px; border: 1px solid #2563eb; background: #2563eb; color: #fff; border-radius: 8px; padding: 0 18px; cursor: pointer; font-size: 13px; font-weight: 900; }
.event-preview-panel > footer button:hover:not(:disabled) { background: #1d4ed8; }
.event-preview-panel > footer button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.22); outline-offset: 2px; }
.event-preview-panel > footer button:disabled { border-color: #cbd5e1; background: #e2e8f0; color: #94a3b8; cursor: not-allowed; }

@media (max-width: 760px) {
  .event-preview-panel { min-height: 0; padding: 18px; }
  .event-preview-panel > header,
  .event-preview-panel > footer { flex-direction: column; align-items: stretch; }
  .event-execution ol { grid-template-columns: 1fr; }
}
</style>
