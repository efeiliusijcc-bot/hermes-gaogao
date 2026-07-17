<script setup>
import { ArrowLeft, ListTree, LoaderCircle, RefreshCw } from '@lucide/vue'

defineProps({
  sourceInput: { type: String, default: '' },
  sections: {
    type: Array,
    default: () => [
      { key: 'summary', title: '事件概括', content: '' },
      { key: 'actors', title: '核心主体', content: '' },
      { key: 'timeAndPlace', title: '时间与地点', content: '' },
      { key: 'facts', title: '关键事实', content: '' },
      { key: 'risk', title: '涉我风险', content: '' },
    ],
  },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  generating: { type: Boolean, default: false },
})

const emit = defineEmits(['back', 'generate', 'retry'])
</script>

<template>
  <section class="draft-analysis-view" aria-labelledby="draft-analysis-title">
    <div class="draft-user-message">
      <span>编报主体</span>
      <p>{{ sourceInput }}</p>
    </div>

    <div class="draft-analysis-response">
      <header>
        <div class="draft-analysis-mark" aria-hidden="true"><ListTree :size="19" /></div>
        <div>
          <h1 id="draft-analysis-title">事件分析</h1>
          <p>已按当前材料整理关键信息</p>
        </div>
      </header>

      <div v-if="loading" class="draft-analysis-loading" aria-live="polite">
        <LoaderCircle :size="22" class="draft-spin" aria-hidden="true" />
        <span>正在分析事件材料...</span>
      </div>

      <div v-else-if="error" class="draft-analysis-error" role="alert">
        <p>{{ error }}</p>
        <button type="button" @click="emit('retry')"><RefreshCw :size="16" aria-hidden="true" />重新分析</button>
      </div>

      <div v-else class="draft-analysis-sections">
        <article v-for="section in sections" :key="section.key">
          <h2>{{ section.title }}</h2>
          <p>{{ section.content }}</p>
        </article>
      </div>
    </div>

    <footer class="draft-analysis-actions">
      <button class="secondary" type="button" :disabled="loading || generating" @click="emit('back')">
        <ArrowLeft :size="17" aria-hidden="true" />返回重新输入
      </button>
      <button class="primary" type="button" :disabled="loading || generating || Boolean(error)" @click="emit('generate')">
        <LoaderCircle v-if="generating" :size="17" class="draft-spin" aria-hidden="true" />
        <ListTree v-else :size="17" aria-hidden="true" />
        {{ generating ? '正在生成' : '生成提纲' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.draft-analysis-view { width: min(840px, 100%); margin: 0 auto; padding: 26px 0 160px; }
.draft-user-message { width: min(680px, 88%); margin-left: auto; border-radius: 8px; background: #f2f3f5; padding: 14px 16px; }
.draft-user-message span { color: #6b7280; font-size: 11px; font-weight: 700; }
.draft-user-message p { margin: 6px 0 0; color: #252a34; font-size: 14px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.draft-analysis-response { margin-top: 34px; }
.draft-analysis-response > header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.draft-analysis-mark { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 1px solid #d9e5f7; background: #f4f8fe; color: #315f9d; border-radius: 8px; }
.draft-analysis-response h1 { margin: 0; color: #111827; font-size: 20px; line-height: 1.4; }
.draft-analysis-response header p { margin: 2px 0 0; color: #8a929f; font-size: 12px; }
.draft-analysis-sections { margin-left: 48px; }
.draft-analysis-sections article { padding: 20px 0; border-bottom: 1px solid #e8ebf0; }
.draft-analysis-sections h2 { margin: 0; color: #253047; font-size: 15px; line-height: 1.5; }
.draft-analysis-sections p { margin: 8px 0 0; color: #4b5563; font-size: 14px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; }
.draft-analysis-loading { display: flex; align-items: center; gap: 10px; min-height: 260px; margin-left: 48px; color: #64748b; }
.draft-analysis-error { margin: 20px 0 0 48px; border-left: 3px solid #ef4444; background: #fff7f7; padding: 14px 16px; color: #991b1b; }
.draft-analysis-error p { margin: 0 0 10px; font-size: 13px; }
.draft-analysis-error button { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: #b91c1c; padding: 0; cursor: pointer; font-weight: 700; }
.draft-analysis-actions { position: fixed; left: 50%; bottom: 16px; z-index: 30; display: flex; align-items: center; justify-content: space-between; gap: 10px; width: min(840px, calc(100vw - 56px)); box-sizing: border-box; margin: 0; border: 1px solid #d8dee7; background: rgba(255, 255, 255, 0.97); border-radius: 8px; box-shadow: 0 10px 30px rgba(30, 41, 59, 0.14); padding: 12px; transform: translateX(-50%); backdrop-filter: blur(12px); }
.draft-analysis-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; border-radius: 7px; padding: 0 15px; cursor: pointer; font-size: 13px; font-weight: 700; }
.draft-analysis-actions button:disabled { opacity: 0.55; cursor: not-allowed; }
.draft-analysis-actions .secondary { border: 1px solid #d7dce4; background: #fff; color: #4b5563; }
.draft-analysis-actions .primary { border: 1px solid #1f2937; background: #1f2937; color: #fff; }
.draft-analysis-actions button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.2); outline-offset: 2px; }
.draft-spin { animation: draft-spin 800ms linear infinite; }
@keyframes draft-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .draft-analysis-view { padding: 14px 0 190px; }
  .draft-user-message { width: 94%; }
  .draft-analysis-sections, .draft-analysis-loading, .draft-analysis-error { margin-left: 0; }
  .draft-analysis-actions { bottom: 8px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: calc(100vw - 16px); padding: 10px; }
  .draft-analysis-actions button { width: 100%; min-width: 0; padding: 0 8px; line-height: 1.4; white-space: normal; }
}
@media (prefers-reduced-motion: reduce) { .draft-spin { animation: none; } }
</style>
