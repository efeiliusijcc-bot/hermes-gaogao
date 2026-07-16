<script setup>
import { ArrowLeft, CircleAlert, LoaderCircle, RefreshCw } from '@lucide/vue'

defineProps({
  status: { type: String, default: 'creating' },
  error: { type: String, default: '' },
})

const emit = defineEmits(['retry', 'back'])
</script>

<template>
  <section class="draft-import-state" aria-labelledby="draft-import-title">
    <div v-if="status === 'error'" class="draft-import-mark error" aria-hidden="true">
      <CircleAlert :size="26" />
    </div>
    <div v-else class="draft-import-mark" aria-hidden="true">
      <LoaderCircle :size="26" class="draft-spin" />
    </div>

    <p class="draft-import-kicker">深度编报</p>
    <h1 id="draft-import-title">
      {{ status === 'error' ? '任务创建失败' : status === 'completed' ? '正在进入任务进度页' : '正在创建深度编报任务' }}
    </h1>
    <p v-if="status === 'error'" class="draft-import-error" role="alert">
      {{ error || '暂时无法创建任务，请稍后重试。' }}
    </p>
    <p v-else>正在准备已确认提纲并创建任务，请稍候。</p>

    <div v-if="status === 'error'" class="draft-import-actions">
      <button class="secondary" type="button" @click="emit('back')">
        <ArrowLeft :size="17" aria-hidden="true" />返回确认
      </button>
      <button class="primary" type="button" @click="emit('retry')">
        <RefreshCw :size="17" aria-hidden="true" />重新尝试
      </button>
    </div>
  </section>
</template>

<style scoped>
.draft-import-state { display: flex; flex-direction: column; align-items: center; justify-content: center; width: min(640px, 100%); min-height: min(560px, calc(100vh - 190px)); margin: 0 auto; padding: 56px 0 90px; color: #5b6472; text-align: center; }
.draft-import-mark { display: inline-flex; align-items: center; justify-content: center; width: 54px; height: 54px; border: 1px solid #cfdcf0; background: #f3f7fc; color: #315f9d; border-radius: 8px; }
.draft-import-mark.error { border-color: #f0bcbc; background: #fff5f5; color: #b42323; }
.draft-import-kicker { margin: 20px 0 5px; color: #7b8490; font-size: 12px; font-weight: 750; }
.draft-import-state h1 { margin: 0; color: #172033; font-size: 24px; line-height: 1.4; letter-spacing: 0; }
.draft-import-state > p:last-of-type { max-width: 480px; margin: 12px 0 0; font-size: 13px; line-height: 1.75; overflow-wrap: anywhere; }
.draft-import-error { color: #a72b2b; }
.draft-import-actions { display: flex; align-items: center; gap: 10px; margin-top: 24px; }
.draft-import-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; border-radius: 7px; padding: 0 14px; cursor: pointer; font-size: 12px; font-weight: 700; }
.draft-import-actions .secondary { border: 1px solid #d5dbe3; background: #fff; color: #4b5563; }
.draft-import-actions .primary { border: 1px solid #1f2937; background: #1f2937; color: #fff; }
.draft-import-actions button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.2); outline-offset: 2px; }
.draft-spin { animation: draft-spin 800ms linear infinite; }
@keyframes draft-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .draft-import-state { min-height: calc(100vh - 154px); padding: 44px 0 72px; }
  .draft-import-actions { align-items: stretch; flex-direction: column-reverse; width: 100%; }
  .draft-import-actions button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .draft-spin { animation: none; } }
</style>
