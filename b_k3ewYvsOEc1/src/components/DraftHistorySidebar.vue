<script setup>
import { computed, ref, watch } from 'vue'
import { PanelLeftClose, Search, SquarePen } from '@lucide/vue'
import { filterDraftHistory } from '../lib/draftAssistantFlow.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  currentEventId: { type: String, default: '' },
  events: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'select-event', 'create-event'])
const search = ref('')
const filteredEvents = computed(() => filterDraftHistory(props.events, search.value))

watch(() => props.open, (open) => {
  if (!open) search.value = ''
})

function formatHistoryTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="draft-history-layer">
      <button class="draft-history-backdrop" type="button" aria-label="关闭历史编报" @click="emit('close')"></button>
      <aside class="draft-history-drawer" role="dialog" aria-modal="true" aria-label="历史编报">
        <header class="draft-history-head">
          <strong>历史编报</strong>
          <button type="button" aria-label="关闭历史编报" title="关闭" @click="emit('close')">
            <PanelLeftClose :size="19" aria-hidden="true" />
          </button>
        </header>

        <button class="draft-history-new" type="button" @click="emit('create-event')">
          <SquarePen :size="17" aria-hidden="true" />新建编报
        </button>

        <label class="draft-history-search">
          <span class="sr-only">搜索历史编报</span>
          <Search :size="16" aria-hidden="true" />
          <input v-model="search" type="search" placeholder="搜索历史编报" />
        </label>

        <div class="draft-history-section-label">最近编报</div>
        <div class="draft-history-list">
          <div v-if="loading" class="draft-history-empty">正在加载...</div>
          <button
            v-for="item in filteredEvents"
            v-else
            :key="item.eventId"
            class="draft-history-row"
            :class="{ active: item.eventId === currentEventId }"
            type="button"
            :title="item.title || '未命名编报'"
            @click="emit('select-event', item.eventId)"
          >
            <span>{{ item.title || '未命名编报' }}</span>
            <time>{{ formatHistoryTime(item.updatedAt || item.createdAt) }}</time>
          </button>
          <div v-if="!loading && !filteredEvents.length" class="draft-history-empty">没有匹配的历史编报</div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.draft-history-layer { position: fixed; inset: 0; z-index: 80; }
.draft-history-backdrop { position: absolute; inset: 0; width: 100%; border: 0; background: rgba(15, 23, 42, 0.22); cursor: default; }
.draft-history-drawer { position: absolute; top: 0; bottom: 0; left: 0; display: flex; flex-direction: column; width: 260px; max-width: calc(100vw - 24px); border-right: 1px solid #e2e5ea; background: #f8f8f8; padding: 12px 8px; box-shadow: 18px 0 38px rgba(15, 23, 42, 0.14); }
.draft-history-head { display: flex; align-items: center; justify-content: space-between; min-height: 42px; padding: 0 8px; }
.draft-history-head strong { color: #20242c; font-size: 16px; }
.draft-history-head button { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 0; background: transparent; color: #555d69; border-radius: 7px; cursor: pointer; }
.draft-history-head button:hover { background: #e9eaec; }
.draft-history-new { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 40px; margin-top: 8px; border: 0; background: transparent; color: #252a33; border-radius: 7px; padding: 0 10px; cursor: pointer; text-align: left; font-size: 13px; font-weight: 650; }
.draft-history-new:hover { background: #e9eaec; }
.draft-history-search { display: flex; align-items: center; gap: 8px; margin: 8px 5px 12px; border: 1px solid #d9dde3; background: #fff; color: #8a929e; border-radius: 7px; padding: 0 9px; }
.draft-history-search:focus-within { border-color: #9eb8df; box-shadow: 0 0 0 3px rgba(49, 95, 157, 0.1); }
.draft-history-search input { min-width: 0; width: 100%; height: 36px; border: 0; background: transparent; color: #252a33; outline: 0; font-size: 12px; }
.draft-history-section-label { padding: 7px 10px; color: #7b8490; font-size: 11px; font-weight: 700; }
.draft-history-list { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.draft-history-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; min-height: 38px; border: 0; background: transparent; color: #343a44; border-radius: 7px; padding: 0 10px; cursor: pointer; text-align: left; }
.draft-history-row:hover { background: #ededee; }
.draft-history-row.active { background: #e4e4e6; color: #171a20; }
.draft-history-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.draft-history-row time { color: #9aa1ab; font-size: 10px; }
.draft-history-empty { padding: 24px 10px; color: #8a929e; text-align: center; font-size: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.draft-history-head button:focus-visible, .draft-history-new:focus-visible, .draft-history-row:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.2); outline-offset: 1px; }

@media (max-width: 640px) {
  .draft-history-drawer { top: 12px; bottom: 12px; left: 12px; width: calc(100vw - 24px); border: 1px solid #dfe3e8; border-radius: 8px; }
}
</style>
