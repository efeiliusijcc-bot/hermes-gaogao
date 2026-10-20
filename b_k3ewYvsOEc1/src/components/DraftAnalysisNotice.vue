<script setup>
import { computed } from 'vue'
import { ArrowUpRight, LoaderCircle, X } from '@lucide/vue'
const props = defineProps({ store: { type: Object, required: true } })
const emit = defineEmits(['open'])
const job = computed(() => props.store.state.notice || props.store.activeJob())
const shown = computed(() => Boolean((job.value || props.store.state.pending)
  && !(props.store.state.workspace === 'draft' && props.store.state.selectedEventId === job.value?.eventId)))
const message = computed(() => props.store.state.connectionLost ? '连接中断，正在确认任务状态'
  : props.store.state.pending ? '正在确认拟稿提交'
  : job.value?.status === 'succeeded' ? '拟稿分析已完成'
  : job.value?.status === 'failed' ? '拟稿分析未完成'
  : '拟稿分析中')
</script>
<template>
  <aside v-if="shown" class="draft-analysis-notice" role="status" aria-live="polite">
    <LoaderCircle v-if="job?.status === 'running' || job?.status === 'queued'" :size="15" aria-hidden="true" />
    <span>{{ message }}</span>
    <button v-if="job" type="button" @click="emit('open', job.eventId)">返回查看<ArrowUpRight :size="15" aria-hidden="true" /></button>
    <button v-if="store.state.notice" type="button" aria-label="关闭拟稿提醒" title="关闭" @click="store.state.notice = null"><X :size="16" /></button>
  </aside>
</template>
<style scoped>
.draft-analysis-notice { position: fixed; top: 76px; right: 18px; z-index: 45; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; max-width: calc(100vw - 36px); padding: 10px 12px; border: 1px solid #dbe3ee; border-radius: 6px; background: #fff; color: #475569; font-size: 13px; }
.draft-analysis-notice button { display: inline-flex; align-items: center; gap: 4px; padding: 2px; border: 0; background: transparent; color: #2563eb; cursor: pointer; }
@media (max-width: 640px) {
  .draft-analysis-notice { position: static; align-self: flex-end; flex-shrink: 0; margin: 6px 12px; max-width: calc(100vw - 24px); }
}
</style>
