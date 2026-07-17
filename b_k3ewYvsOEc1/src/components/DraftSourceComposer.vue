<script setup>
import { ArrowUp, LoaderCircle } from '@lucide/vue'
import AutoResizeTextarea from './common/AutoResizeTextarea.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'submit'])

function submit() {
  if (props.loading) return
  emit('submit')
}

function handleKeydown(event) {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
  event.preventDefault()
  submit()
}
</script>

<template>
  <section class="draft-source-stage" aria-labelledby="draft-source-title">
    <div class="draft-source-heading">
      <h1 id="draft-source-title">开始一次新的编报</h1>
      <p>写下事件主体、已知材料、相关链接和重点关注方向。</p>
    </div>

    <form class="draft-source-composer" @submit.prevent="submit">
      <AutoResizeTextarea
        :model-value="modelValue"
        :disabled="loading"
        :min-height="152"
        :maxlength="12000"
        aria-label="编报主体和相关材料"
        class="draft-source-input"
        placeholder="输入编报主体和相关材料"
        @keydown="handleKeydown"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <div class="draft-source-actions">
        <span class="draft-source-count">{{ modelValue.length.toLocaleString('zh-CN') }} / 12,000</span>
        <button type="submit" :disabled="loading" aria-label="开始拟稿" title="开始拟稿">
          <LoaderCircle v-if="loading" :size="18" class="draft-spin" aria-hidden="true" />
          <ArrowUp v-else :size="19" aria-hidden="true" />
          <span>{{ loading ? '正在分析' : '开始拟稿' }}</span>
        </button>
      </div>
    </form>

    <p v-if="error" class="draft-source-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.draft-source-stage {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: min(760px, 100%);
  min-height: min(620px, calc(100vh - 190px));
  margin: 0 auto;
  padding: 40px 0 80px;
}

.draft-source-heading { margin-bottom: 28px; text-align: center; }
.draft-source-heading h1 { margin: 0; color: #111827; font-size: 30px; font-weight: 760; line-height: 1.3; letter-spacing: 0; }
.draft-source-heading p { margin: 10px 0 0; color: #6b7280; font-size: 14px; line-height: 1.7; }

.draft-source-composer {
  border: 1px solid #d9dde5;
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08);
}

.draft-source-composer:focus-within { border-color: #93b4e8; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1), 0 14px 34px rgba(15, 23, 42, 0.08); }
.draft-source-input { display: block; border: 0; background: transparent; color: #111827; padding: 0; font-size: 16px; line-height: 1.75; outline: 0; }
.draft-source-input::placeholder { color: #9ca3af; }
.draft-source-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #eef0f4; }
.draft-source-count { color: #9ca3af; font-size: 11px; }
.draft-source-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px; border: 0; background: #1f2937; color: #fff; border-radius: 7px; padding: 0 14px; cursor: pointer; font-size: 13px; font-weight: 700; }
.draft-source-actions button:hover:not(:disabled) { background: #111827; }
.draft-source-actions button:disabled { background: #9ca3af; cursor: wait; }
.draft-source-actions button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.22); outline-offset: 2px; }
.draft-source-error { margin: 12px 0 0; color: #b91c1c; font-size: 13px; text-align: center; }
.draft-spin { animation: draft-spin 800ms linear infinite; }
@keyframes draft-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .draft-source-stage { min-height: calc(100vh - 154px); padding: 24px 0 52px; }
  .draft-source-heading h1 { font-size: 24px; }
  .draft-source-composer { padding: 13px; }
  .draft-source-actions { align-items: flex-end; }
  .draft-source-actions button span { display: none; }
  .draft-source-actions button { width: 38px; padding: 0; }
}

@media (prefers-reduced-motion: reduce) { .draft-spin { animation: none; } }
</style>
