<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({
  versionLabel: { type: String, default: '当前版本' },
  saveState: { type: String, default: 'saved' },
  saveStateLabel: { type: String, default: '已保存' },
  isSaving: { type: Boolean, default: false },
  canConfirm: { type: Boolean, default: true },
  previewMode: { type: Boolean, default: false },
})

const emit = defineEmits(['cancel', 'preview', 'save', 'confirm', 'open-left', 'open-right'])
const moreOpen = ref(false)
const moreRoot = ref(null)

function closeMore(event) {
  if (!moreRoot.value?.contains(event.target)) moreOpen.value = false
}

function run(action) {
  moreOpen.value = false
  emit(action)
}

onMounted(() => document.addEventListener('click', closeMore))
onBeforeUnmount(() => document.removeEventListener('click', closeMore))
</script>

<template>
  <header class="draft-editor-toolbar">
    <div class="draft-editor-toolbar-context">
      <span class="draft-toolbar-step">Step 4</span>
      <div>
        <strong>编辑确认模式</strong>
        <small>当前版本：{{ versionLabel }}</small>
      </div>
    </div>

    <div class="draft-toolbar-save" :class="saveState" role="status">
      <span></span>
      {{ saveStateLabel }}
    </div>

    <div class="draft-toolbar-actions">
      <button class="draft-toolbar-panel-btn left" type="button" aria-label="打开事件栏" @click="emit('open-left')">事件</button>
      <button class="draft-toolbar-panel-btn right" type="button" aria-label="打开操作面板" @click="emit('open-right')">操作</button>
      <button class="draft-toolbar-btn weak draft-toolbar-secondary-action" type="button" @click="emit('cancel')">取消编辑</button>
      <button class="draft-toolbar-btn draft-toolbar-secondary-action" type="button" @click="emit('preview')">{{ previewMode ? '继续编辑' : '预览提纲' }}</button>
      <button class="draft-toolbar-btn emphasized draft-toolbar-secondary-action" type="button" :disabled="isSaving" @click="emit('save')">
        {{ isSaving ? '保存中...' : '保存为新版本' }}
      </button>
      <button class="draft-toolbar-btn primary" type="button" :disabled="!canConfirm || isSaving" @click="emit('confirm')">确认当前版本</button>

      <div ref="moreRoot" class="draft-toolbar-more">
        <button class="draft-toolbar-more-trigger" type="button" aria-label="更多编辑操作" :aria-expanded="moreOpen" @click.stop="moreOpen = !moreOpen">•••</button>
        <div v-if="moreOpen" class="draft-toolbar-more-menu">
          <button type="button" @click="run('preview')">{{ previewMode ? '继续编辑' : '预览提纲' }}</button>
          <button type="button" :disabled="isSaving" @click="run('save')">保存为新版本</button>
          <button class="weak" type="button" @click="run('cancel')">取消编辑</button>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.draft-editor-toolbar {
  position: sticky;
  top: 0;
  z-index: 12;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto minmax(430px, auto);
  align-items: center;
  gap: 16px;
  min-height: 68px;
  margin-bottom: 20px;
  border: 1px solid rgba(37, 99, 235, 0.16);
  background: rgba(255, 255, 255, 0.94);
  border-radius: 14px;
  padding: 8px 10px 8px 14px;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(14px);
}

.draft-editor-toolbar-context,
.draft-toolbar-actions,
.draft-toolbar-save {
  display: flex;
  align-items: center;
}

.draft-editor-toolbar-context { gap: 10px; min-width: 0; }
.draft-editor-toolbar-context > div { min-width: 0; }
.draft-editor-toolbar-context strong,
.draft-editor-toolbar-context small { display: block; letter-spacing: 0; }
.draft-editor-toolbar-context strong { color: #0f172a; font-size: 14px; font-weight: 900; }
.draft-editor-toolbar-context small { margin-top: 3px; color: #64748b; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.draft-toolbar-step {
  flex: 0 0 auto;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 900;
}

.draft-toolbar-save { gap: 7px; color: #475569; font-size: 12px; font-weight: 800; white-space: nowrap; }
.draft-toolbar-save span { width: 8px; height: 8px; border-radius: 50%; background: #16a34a; }
.draft-toolbar-save.dirty span { background: #f59e0b; }
.draft-toolbar-save.saving span { background: #2563eb; animation: draft-save-pulse 1s infinite alternate; }
.draft-toolbar-save.failed { color: #b91c1c; }
.draft-toolbar-save.failed span { background: #dc2626; }

.draft-toolbar-actions { justify-content: flex-end; gap: 8px; }
.draft-toolbar-btn,
.draft-toolbar-panel-btn,
.draft-toolbar-more-trigger {
  min-height: 38px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #334155;
  border-radius: 8px;
  padding: 0 12px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}
.draft-toolbar-btn:hover:not(:disabled),
.draft-toolbar-panel-btn:hover,
.draft-toolbar-more-trigger:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.draft-toolbar-btn:focus-visible,
.draft-toolbar-panel-btn:focus-visible,
.draft-toolbar-more-trigger:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.22); outline-offset: 2px; }
.draft-toolbar-btn:disabled { cursor: not-allowed; opacity: 0.52; }
.draft-toolbar-btn.weak { border-color: transparent; background: transparent; color: #64748b; }
.draft-toolbar-btn.emphasized { border-color: #93c5fd; color: #1d4ed8; }
.draft-toolbar-btn.primary { border-color: #2563eb; background: #2563eb; color: #fff; }
.draft-toolbar-btn.primary:hover:not(:disabled) { background: #1d4ed8; color: #fff; }
.draft-toolbar-panel-btn,
.draft-toolbar-more { display: none; }
.draft-toolbar-more { position: relative; }
.draft-toolbar-more-trigger { width: 38px; padding: 0; font-size: 15px; }
.draft-toolbar-more-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 176px;
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 8px;
  padding: 6px;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.14);
}
.draft-toolbar-more-menu button { width: 100%; border: 0; background: transparent; color: #334155; border-radius: 6px; padding: 9px 10px; text-align: left; cursor: pointer; font-size: 12px; }
.draft-toolbar-more-menu button:hover { background: #f1f5f9; }
.draft-toolbar-more-menu button.weak { color: #64748b; }

@keyframes draft-save-pulse { to { opacity: 0.35; } }

@media (max-width: 1599px) {
  .draft-editor-toolbar { grid-template-columns: minmax(200px, 1fr) auto minmax(380px, auto); }
}

@media (max-width: 1359px) {
  .draft-toolbar-panel-btn.right { display: inline-flex; align-items: center; }
}

@media (max-width: 1240px) {
  .draft-editor-toolbar { grid-template-columns: minmax(190px, 1fr) auto auto; }
  .draft-toolbar-secondary-action { display: none; }
  .draft-toolbar-more { display: block; }
}

@media (max-width: 1099px) {
  .draft-toolbar-panel-btn.left { display: inline-flex; align-items: center; }
}

@media (max-width: 760px) {
  .draft-editor-toolbar { grid-template-columns: minmax(0, 1fr) auto; gap: 8px; min-height: 64px; padding: 8px; }
  .draft-toolbar-save { display: none; }
  .draft-toolbar-btn.primary { padding: 0 10px; }
  .draft-toolbar-panel-btn { display: none !important; }
}
</style>
