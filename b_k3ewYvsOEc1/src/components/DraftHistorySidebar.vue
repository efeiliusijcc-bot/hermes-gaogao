<script setup>
import { computed, nextTick, ref } from 'vue'

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  currentEventId: { type: String, default: '' },
  events: { type: Array, default: () => [] },
  preference: { type: String, default: 'auto' },
})

const emit = defineEmits(['toggle', 'select-event', 'create-event', 'search-focus-change', 'use-auto'])
const search = ref('')
const root = ref(null)
const toggleButton = ref(null)

const filteredEvents = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return props.events
  return props.events.filter((item) => String(item.title || '').toLowerCase().includes(query))
})
const railEvents = computed(() => props.events.slice(0, 4))

function eventStatus(item) {
  if (item.eventId === props.currentEventId) return { label: '正在编辑', tone: 'current' }
  if (item.status === 'failed') return { label: '失败', tone: 'failed' }
  if (item.status === 'running' || item.status === 'generating') return { label: '处理中', tone: 'running' }
  return { label: '已完成', tone: 'completed' }
}

function eventDate(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

async function requestToggle() {
  const focusInside = root.value?.contains(document.activeElement)
  emit('toggle')
  if (focusInside) {
    await nextTick()
    toggleButton.value?.focus()
  }
}

defineExpose({ root, toggleButton })
</script>

<template>
  <aside
    id="draft-history-sidebar"
    ref="root"
    class="draft-history-sidebar"
    :class="{ collapsed }"
    aria-label="历史事件"
  >
    <button
      ref="toggleButton"
      class="history-sidebar-toggle"
      type="button"
      :aria-label="collapsed ? '展开历史事件' : '收起历史事件'"
      :aria-expanded="!collapsed"
      aria-controls="draft-history-sidebar-content"
      :title="collapsed ? '展开历史事件' : '收起历史事件'"
      @click="requestToggle"
    >
      {{ collapsed ? '›' : '‹' }}
    </button>

    <div v-if="collapsed" id="draft-history-sidebar-content" class="history-sidebar-rail">
      <div class="history-rail-mark" aria-hidden="true">历</div>
      <div class="history-rail-events">
        <button
          v-for="item in railEvents"
          :key="item.eventId"
          class="history-rail-event"
          :class="[eventStatus(item).tone, { selected: item.eventId === currentEventId }]"
          type="button"
          :aria-label="`${item.title}，${eventDate(item.createdAt)}，${eventStatus(item).label}`"
          :title="`${item.title}\n${eventDate(item.createdAt)} · ${eventStatus(item).label}`"
          @click="emit('select-event', item.eventId)"
        >
          <span class="history-status-dot"></span>
          <b>{{ eventDate(item.createdAt) }}</b>
        </button>
      </div>
      <div class="history-rail-actions">
        <button type="button" aria-label="新建事件" title="新建事件" @click="emit('create-event')">+</button>
        <button v-if="preference !== 'auto'" type="button" aria-label="恢复自动收缩" title="恢复自动收缩" @click="emit('use-auto')">A</button>
      </div>
    </div>

    <div v-else id="draft-history-sidebar-content" class="history-sidebar-expanded">
      <header class="history-sidebar-head">
        <div>
          <h2>事件输入</h2>
          <span>当前提纲所属事件</span>
        </div>
        <button type="button" @click="emit('create-event')">+ 新建事件</button>
      </header>

      <label class="history-sidebar-search">
        <span>搜索事件</span>
        <input
          v-model="search"
          placeholder="搜索事件标题"
          @focus="emit('search-focus-change', true)"
          @blur="emit('search-focus-change', false)"
        />
      </label>

      <div class="history-sidebar-tabs" role="tablist" aria-label="事件列表范围">
        <button class="active" type="button" role="tab" aria-selected="true">最近编辑</button>
        <button type="button" role="tab" aria-selected="false">全部事件</button>
      </div>

      <div class="history-sidebar-list">
        <button
          v-for="item in filteredEvents"
          :key="item.eventId"
          class="history-sidebar-event"
          :class="{ selected: item.eventId === currentEventId }"
          type="button"
          :title="item.title"
          @click="emit('select-event', item.eventId)"
        >
          <strong>{{ item.title }}</strong>
          <span>{{ eventDate(item.createdAt) }}</span>
          <small :class="eventStatus(item).tone"><i></i>{{ eventStatus(item).label }}</small>
        </button>
        <div v-if="!filteredEvents.length" class="history-sidebar-empty">没有匹配的事件</div>
      </div>

      <button v-if="preference !== 'auto'" class="history-auto-preference" type="button" @click="emit('use-auto')">恢复跟随流程自动收缩</button>
    </div>
  </aside>
</template>

<style scoped>
.draft-history-sidebar {
  position: relative;
  min-width: 0;
  height: 100%;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
  transition: width 210ms ease, min-width 210ms ease;
}
.history-sidebar-toggle {
  position: absolute;
  top: 18px;
  right: -18px;
  z-index: 14;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid #bfdbfe;
  background: #fff;
  color: #1d4ed8;
  border-radius: 8px;
  box-shadow: 0 6px 14px rgba(37, 99, 235, 0.14);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}
.history-sidebar-toggle:hover { background: #eff6ff; border-color: #60a5fa; }
.history-sidebar-toggle:active { transform: translateY(1px); }
.history-sidebar-toggle:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.24); outline-offset: 2px; }
.history-sidebar-expanded { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 16px; opacity: 1; transition: opacity 130ms ease 70ms; }
.history-sidebar-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.history-sidebar-head h2 { margin: 0; color: #0f172a; font-size: 15px; font-weight: 900; }
.history-sidebar-head span { display: block; margin-top: 4px; color: #94a3b8; font-size: 11px; }
.history-sidebar-head button { border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; border-radius: 8px; padding: 7px 9px; cursor: pointer; font-size: 11px; font-weight: 800; white-space: nowrap; }
.history-sidebar-search span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
.history-sidebar-search input { width: 100%; border: 1px solid #dbe3ef; background: #f8fafc; color: #334155; border-radius: 8px; padding: 9px 10px; font-size: 12px; }
.history-sidebar-search input:focus { border-color: #60a5fa; outline: 3px solid rgba(37, 99, 235, 0.14); }
.history-sidebar-tabs { display: grid; grid-template-columns: 1fr 1fr; margin-top: 8px; border-bottom: 1px solid #e2e8f0; }
.history-sidebar-tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; color: #64748b; padding: 9px 4px; cursor: pointer; font-size: 12px; font-weight: 800; }
.history-sidebar-tabs button.active { border-bottom-color: #2563eb; color: #1d4ed8; }
.history-sidebar-list { display: grid; gap: 8px; min-height: 0; margin-top: 10px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.history-sidebar-event { width: 100%; border: 1px solid #e2e8f0; background: #f8fafc; color: #334155; border-radius: 8px; padding: 10px; text-align: left; cursor: pointer; }
.history-sidebar-event:hover { border-color: #bfdbfe; background: #fff; }
.history-sidebar-event.selected { border-color: #93c5fd; border-left: 4px solid #2563eb; background: #eff6ff; padding-left: 7px; }
.history-sidebar-event strong { display: -webkit-box; overflow: hidden; color: #1e293b; font-size: 12px; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.history-sidebar-event span { display: block; margin-top: 5px; color: #94a3b8; font-size: 10px; }
.history-sidebar-event small { display: flex; align-items: center; gap: 5px; margin-top: 4px; color: #64748b; font-size: 10px; }
.history-sidebar-event small i,
.history-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; }
.history-sidebar-event small.current i,
.history-sidebar-event small.running i,
.history-rail-event.current .history-status-dot,
.history-rail-event.running .history-status-dot { background: #2563eb; }
.history-sidebar-event small.completed i,
.history-rail-event.completed .history-status-dot { background: #16a34a; }
.history-sidebar-event small.failed i,
.history-rail-event.failed .history-status-dot { background: #dc2626; }
.history-sidebar-empty { border: 1px dashed #cbd5e1; border-radius: 8px; padding: 14px; color: #64748b; text-align: center; font-size: 12px; }
.history-auto-preference { margin-top: 10px; border: 0; background: transparent; color: #64748b; cursor: pointer; font-size: 11px; }
.history-auto-preference:hover { color: #1d4ed8; }
.history-sidebar-rail { display: flex; flex-direction: column; align-items: center; height: 100%; min-height: 0; padding: 12px 7px; }
.history-rail-mark { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; margin-top: 44px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; border-radius: 8px; font-size: 12px; font-weight: 900; }
.history-rail-events { display: grid; gap: 9px; margin-top: 18px; }
.history-rail-event { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; width: 44px; min-height: 44px; border: 1px solid #e2e8f0; background: #f8fafc; color: #64748b; border-radius: 8px; padding: 6px 3px; cursor: pointer; }
.history-rail-event:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.history-rail-event.selected { border-color: #60a5fa; border-left: 3px solid #2563eb; background: #eff6ff; }
.history-rail-event b { font-size: 9px; font-weight: 800; }
.history-rail-actions { display: grid; gap: 8px; margin-top: auto; }
.history-rail-actions button { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border: 1px solid #bfdbfe; background: #fff; color: #1d4ed8; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 900; }
.history-rail-actions button:hover { background: #eff6ff; }

@media (prefers-reduced-motion: reduce) {
  .draft-history-sidebar,
  .history-sidebar-expanded { transition: none; }
}
</style>
