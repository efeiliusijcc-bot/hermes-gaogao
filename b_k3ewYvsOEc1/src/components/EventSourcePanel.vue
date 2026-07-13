<script setup>
const props = defineProps({
  modelValue: { type: Object, required: true },
  summary: { type: Object, required: true },
  events: { type: Array, default: () => [] },
  currentEventId: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'refresh', 'select-event', 'create-event'])

const categoryOptions = ['国际政治', '区域安全', '产业经济', '科技竞争', '社会舆情']
const regionOptions = ['全球', '中国', '东亚', '东南亚', '欧洲', '北美', '中东', '非洲']

function updateField(key, value) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function formatEventTime(value) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <aside class="event-source-panel" aria-label="事件源输入">
    <header class="event-source-head">
      <div>
        <h2>事件源输入</h2>
        <span>Step 1 · 形成可分析的事件材料</span>
      </div>
      <button type="button" :disabled="loading" @click="emit('refresh')">{{ loading ? '刷新中' : '刷新' }}</button>
    </header>

    <div class="event-source-fields">
      <label>
        <span>事件标题 <b>*</b><small>{{ String(modelValue.title || '').length }}/60</small></span>
        <input
          :value="modelValue.title"
          maxlength="60"
          placeholder="输入需要分析的完整事件标题"
          @input="updateField('title', $event.target.value)"
        />
      </label>
      <label>
        <span>补充材料 <small>{{ String(modelValue.materials || '').length }} 字</small></span>
        <textarea
          :value="modelValue.materials"
          rows="6"
          placeholder="输入背景、事实、已知信息和材料片段"
          @input="updateField('materials', $event.target.value)"
        ></textarea>
      </label>
      <label>
        <span>相关链接 <small>{{ summary.links.valid.length }} 个有效链接</small></span>
        <textarea
          :value="modelValue.linksText"
          rows="4"
          placeholder="每行输入一个 http 或 https 链接"
          @input="updateField('linksText', $event.target.value)"
        ></textarea>
        <small v-if="summary.links.invalid.length" class="field-warning">
          {{ summary.links.invalid.length }} 个链接格式无效，请检查后再试。
        </small>
      </label>
      <div class="event-source-pair">
        <label>
          <span>类别</span>
          <input
            :value="modelValue.category"
            list="draft-category-options"
            placeholder="选择或输入类别"
            @input="updateField('category', $event.target.value)"
          />
          <datalist id="draft-category-options"><option v-for="item in categoryOptions" :key="item" :value="item" /></datalist>
        </label>
        <label>
          <span>地区</span>
          <input
            :value="modelValue.region"
            list="draft-region-options"
            placeholder="选择或输入地区"
            @input="updateField('region', $event.target.value)"
          />
          <datalist id="draft-region-options"><option v-for="item in regionOptions" :key="item" :value="item" /></datalist>
        </label>
      </div>
    </div>

    <section class="event-completion" aria-label="事件信息完整度">
      <div class="event-completion-head">
        <strong>事件信息完整度</strong>
        <span>{{ summary.completion }}%</span>
      </div>
      <div class="event-completion-track"><i :style="{ width: `${summary.completion}%` }"></i></div>
      <p><b>已填写：</b>{{ summary.filled.join('、') || '无' }}</p>
      <p><b>待补充：</b>{{ summary.missing.join('、') || '信息已完整' }}</p>
    </section>

    <section class="event-recent">
      <div class="event-recent-head">
        <h3>最近事件</h3>
        <button type="button" @click="emit('create-event')">+ 新建</button>
      </div>
      <div class="event-recent-list">
        <button
          v-for="item in events"
          :key="item.eventId"
          type="button"
          :class="{ selected: item.eventId === currentEventId }"
          @click="emit('select-event', item.eventId)"
        >
          <strong>{{ item.title }}</strong>
          <span>{{ formatEventTime(item.updatedAt || item.createdAt) }}</span>
          <small>{{ item.eventId === currentEventId ? '当前事件' : '已保存' }}</small>
        </button>
        <p v-if="!events.length" class="event-recent-empty">还没有历史事件，完成首次分析后会显示在这里。</p>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.event-source-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; border: 1px solid rgba(148, 163, 184, 0.24); background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05); overflow: hidden; }
.event-source-head,
.event-source-head > div,
.event-completion-head,
.event-recent-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.event-source-head > div { display: block; }
.event-source-head h2,
.event-recent-head h3 { margin: 0; color: #0f172a; font-weight: 900; }
.event-source-head h2 { font-size: 16px; }
.event-source-head span { display: block; margin-top: 4px; color: #94a3b8; font-size: 11px; }
.event-source-head button,
.event-recent-head button { border: 0; background: transparent; color: #1d4ed8; cursor: pointer; font-size: 11px; font-weight: 900; }
.event-source-fields { display: grid; gap: 12px; margin-top: 16px; }
.event-source-fields label { display: grid; gap: 6px; min-width: 0; }
.event-source-fields label > span { display: flex; justify-content: space-between; gap: 8px; color: #475569; font-size: 12px; font-weight: 900; }
.event-source-fields label > span b { color: #dc2626; }
.event-source-fields label > span small { color: #94a3b8; font-size: 10px; font-weight: 700; }
.event-source-fields input,
.event-source-fields textarea { width: 100%; border: 1px solid #dbe3ef; background: #f8fafc; color: #1e293b; border-radius: 8px; padding: 9px 10px; font: inherit; font-size: 12px; line-height: 1.65; }
.event-source-fields textarea { resize: vertical; }
.event-source-fields input:focus,
.event-source-fields textarea:focus { border-color: #60a5fa; background: #fff; outline: 3px solid rgba(37, 99, 235, 0.13); }
.field-warning { color: #b45309; font-size: 11px; line-height: 1.5; }
.event-source-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.event-completion { margin-top: 16px; border: 1px solid #bfdbfe; background: #f8fbff; border-radius: 8px; padding: 12px; }
.event-completion-head strong { color: #334155; font-size: 12px; }
.event-completion-head span { color: #1d4ed8; font-size: 13px; font-weight: 900; }
.event-completion-track { height: 6px; margin: 9px 0; overflow: hidden; background: #dbeafe; border-radius: 6px; }
.event-completion-track i { display: block; height: 100%; background: #2563eb; border-radius: inherit; transition: width 180ms ease; }
.event-completion p { margin: 4px 0 0; color: #64748b; font-size: 10px; line-height: 1.5; }
.event-completion p b { color: #475569; }
.event-recent { display: flex; flex-direction: column; min-height: 0; margin-top: 16px; padding-top: 14px; border-top: 1px solid #e2e8f0; }
.event-recent-head h3 { font-size: 13px; }
.event-recent-list { display: grid; gap: 7px; min-height: 120px; margin-top: 9px; overflow-y: auto; overscroll-behavior: contain; }
.event-recent-list > button { width: 100%; border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; border-radius: 8px; padding: 9px; text-align: left; cursor: pointer; }
.event-recent-list > button.selected { border-color: #93c5fd; border-left: 4px solid #2563eb; background: #eff6ff; padding-left: 6px; }
.event-recent-list strong { display: -webkit-box; overflow: hidden; color: #1e293b; font-size: 11px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.event-recent-list span,
.event-recent-list small { display: block; margin-top: 3px; color: #94a3b8; font-size: 9px; }
.event-recent-list small { color: #2563eb; font-weight: 800; }
.event-recent-empty { margin: 0; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 12px; color: #64748b; font-size: 11px; line-height: 1.6; }

@media (prefers-reduced-motion: reduce) { .event-completion-track i { transition: none; } }
</style>
