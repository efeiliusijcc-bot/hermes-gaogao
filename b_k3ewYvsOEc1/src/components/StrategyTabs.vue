<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  writingFocus: { type: Array, default: () => [] },
  sourceRequirements: { type: Array, default: () => [] },
  uncertaintiesToVerify: { type: Array, default: () => [] },
  editable: { type: Boolean, default: true },
})

const emit = defineEmits(['add', 'move', 'remove', 'duplicate', 'update', 'restore'])
const activeTab = ref('writingFocus')
const openMenu = ref('')
const editingIndex = ref(-1)
const editText = ref('')
const editInput = ref(null)
const draggingIndex = ref(-1)
const deletedItem = ref(null)
let deleteTimer = null

const tabDefinitions = [
  { key: 'writingFocus', label: '写作重点', description: '明确报告需要重点回答的问题和核心写作方向。', tone: 'blue', addLabel: '添加写作重点' },
  { key: 'sourceRequirements', label: '来源要求', description: '设置报告优先使用的信息来源和引用标准。', tone: 'green', addLabel: '添加来源要求' },
  { key: 'uncertaintiesToVerify', label: '待核实事项', description: '列出报告生成前必须核实的事实、数据和时间节点。', tone: 'orange', addLabel: '添加待核实事项' },
]

const activeDefinition = computed(() => tabDefinitions.find((item) => item.key === activeTab.value) || tabDefinitions[0])
const activeItems = computed(() => Array.isArray(props[activeTab.value]) ? props[activeTab.value] : [])

function itemText(item) {
  if (typeof item === 'string') return item
  return String(item?.summary || item?.title || item?.content || '')
}

function selectTab(key) {
  activeTab.value = key
  openMenu.value = ''
  editingIndex.value = -1
}

async function startEdit(index) {
  editText.value = itemText(activeItems.value[index])
  editingIndex.value = index
  openMenu.value = ''
  await nextTick()
  editInput.value?.focus()
}

function saveEdit() {
  const value = editText.value.trim()
  if (!value || editingIndex.value < 0) return
  emit('update', activeTab.value, editingIndex.value, value)
  editingIndex.value = -1
}

function cancelEdit() {
  editingIndex.value = -1
  editText.value = ''
}

function setEditInput(element) {
  editInput.value = element
}

function handleEditKey(event) {
  if (event.key === 'Escape') cancelEdit()
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveEdit()
}

function menuAction(action, index) {
  openMenu.value = ''
  if (action === 'edit') void startEdit(index)
  else if (action === 'remove') {
    if (window.confirm('确定删除这条内容吗？')) {
      deletedItem.value = { key: activeTab.value, index, item: activeItems.value[index] }
      emit('remove', activeTab.value, index)
      if (deleteTimer) window.clearTimeout(deleteTimer)
      deleteTimer = window.setTimeout(() => { deletedItem.value = null }, 5000)
    }
  } else if (action === 'duplicate') emit('duplicate', activeTab.value, index)
  else emit('move', activeTab.value, index, action === 'up' ? -1 : 1)
}

function undoDelete() {
  if (!deletedItem.value) return
  emit('restore', deletedItem.value.key, deletedItem.value.index, deletedItem.value.item)
  deletedItem.value = null
  if (deleteTimer) window.clearTimeout(deleteTimer)
}

function onDrop(index) {
  if (draggingIndex.value < 0 || draggingIndex.value === index) return
  emit('move', activeTab.value, draggingIndex.value, index - draggingIndex.value)
  draggingIndex.value = -1
}

onBeforeUnmount(() => {
  if (deleteTimer) window.clearTimeout(deleteTimer)
})
</script>

<template>
  <section class="strategy-tabs-shell">
    <div class="strategy-tabs" role="tablist" aria-label="写作策略与核查">
      <button
        v-for="tab in tabDefinitions"
        :id="`strategy-tab-${tab.key}`"
        :key="tab.key"
        class="strategy-tab"
        :class="[tab.tone, { active: activeTab === tab.key }]"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.key"
        :aria-controls="`strategy-panel-${tab.key}`"
        @click="selectTab(tab.key)"
      >
        <span>{{ tab.label }}</span>
        <b>{{ props[tab.key]?.length || 0 }}</b>
      </button>
    </div>

    <div :id="`strategy-panel-${activeTab}`" class="strategy-panel" role="tabpanel" :aria-labelledby="`strategy-tab-${activeTab}`">
      <div class="strategy-panel-head">
        <div>
          <h3>{{ activeDefinition.label }}</h3>
          <p>{{ activeDefinition.description }}</p>
        </div>
      </div>

      <div class="strategy-item-list">
        <article
          v-for="(item, index) in activeItems"
          :key="`${activeTab}-${index}`"
          class="strategy-item"
          :class="{ readonly: !editable }"
          :draggable="editable"
          @dragstart="draggingIndex = index"
          @dragover.prevent
          @drop="onDrop(index)"
        >
          <button v-if="editable" class="strategy-drag" type="button" aria-label="拖动排序" title="拖动排序">⋮⋮</button>
          <div class="strategy-item-content">
            <template v-if="editingIndex === index">
              <label class="strategy-edit-label">
                <span>编辑{{ activeDefinition.label }}</span>
                <textarea :ref="setEditInput" v-model="editText" rows="4" @keydown="handleEditKey"></textarea>
              </label>
              <div class="strategy-edit-actions">
                <small>Ctrl/Cmd + Enter 保存，Esc 取消</small>
                <button type="button" @click="cancelEdit">取消</button>
                <button class="primary" type="button" @click="saveEdit">保存</button>
              </div>
            </template>
            <template v-else>
              <span v-if="activeTab === 'uncertaintiesToVerify'" class="strategy-verification-status">待核实</span>
              <p>{{ itemText(item) }}</p>
            </template>
          </div>
          <div v-if="editable && editingIndex !== index" class="strategy-item-menu">
            <button type="button" aria-label="更多条目操作" :aria-expanded="openMenu === `${activeTab}-${index}`" @click.stop="openMenu = openMenu === `${activeTab}-${index}` ? '' : `${activeTab}-${index}`">•••</button>
            <div v-if="openMenu === `${activeTab}-${index}`" class="strategy-item-popover">
              <button type="button" :disabled="index === 0" @click="menuAction('up', index)">上移</button>
              <button type="button" :disabled="index === activeItems.length - 1" @click="menuAction('down', index)">下移</button>
              <button type="button" @click="menuAction('edit', index)">编辑</button>
              <button type="button" @click="menuAction('duplicate', index)">复制</button>
              <button class="danger" type="button" @click="menuAction('remove', index)">删除</button>
            </div>
          </div>
        </article>
        <div v-if="!activeItems.length" class="strategy-empty">当前还没有{{ activeDefinition.label }}。</div>
      </div>

      <button v-if="editable" class="strategy-add" type="button" @click="emit('add', activeTab)">+ {{ activeDefinition.addLabel }}</button>
    </div>

    <div v-if="editable && deletedItem" class="strategy-undo" role="status">
      <span>已删除一条{{ tabDefinitions.find((item) => item.key === deletedItem.key)?.label }}</span>
      <button type="button" @click="undoDelete">撤销</button>
    </div>
  </section>
</template>

<style scoped>
.strategy-tabs-shell { margin-top: 22px; border: 1px solid #dbe3ef; background: #fff; border-radius: 14px; overflow: visible; }
.strategy-tabs { display: flex; gap: 4px; border-bottom: 1px solid #e2e8f0; padding: 10px 14px 0; overflow-x: auto; }
.strategy-tab { position: relative; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; border: 0; background: transparent; color: #64748b; padding: 0 14px; cursor: pointer; font-size: 14px; font-weight: 800; white-space: nowrap; }
.strategy-tab::after { content: ''; position: absolute; right: 10px; bottom: -1px; left: 10px; height: 3px; border-radius: 3px 3px 0 0; background: transparent; }
.strategy-tab b { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; border-radius: 6px; background: #f1f5f9; color: #64748b; font-size: 11px; }
.strategy-tab.active { color: #0f172a; }
.strategy-tab.active.blue::after { background: #2563eb; }
.strategy-tab.active.green::after { background: #16a34a; }
.strategy-tab.active.orange::after { background: #ea580c; }
.strategy-tab:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.2); outline-offset: -2px; border-radius: 8px 8px 0 0; }
.strategy-panel { padding: 22px; }
.strategy-panel-head h3 { margin: 0; color: #0f172a; font-size: 19px; font-weight: 900; letter-spacing: 0; }
.strategy-panel-head p { margin: 5px 0 0; color: #64748b; font-size: 13px; line-height: 1.7; }
.strategy-item-list { display: grid; gap: 10px; margin-top: 18px; }
.strategy-item { position: relative; display: grid; grid-template-columns: 34px minmax(0, 1fr) 38px; align-items: start; gap: 10px; min-width: 0; border: 1px solid #e2e8f0; background: #fbfdff; border-radius: 10px; padding: 14px 12px; }
.strategy-item.readonly { grid-template-columns: minmax(0, 1fr); padding: 15px 16px; }
.strategy-item:hover { border-color: #bfdbfe; background: #fff; }
.strategy-drag { width: 32px; height: 34px; border: 0; background: transparent; color: #94a3b8; cursor: grab; font-size: 16px; letter-spacing: -4px; }
.strategy-drag:active { cursor: grabbing; }
.strategy-item-content { min-width: 0; }
.strategy-item-content > p { margin: 3px 0 0; color: #253247; font-size: 14px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.strategy-verification-status { display: inline-flex; margin-bottom: 4px; border: 1px solid #fed7aa; background: #fff7ed; color: #c2410c; border-radius: 6px; padding: 3px 7px; font-size: 10px; font-weight: 900; }
.strategy-item-menu { position: relative; }
.strategy-item-menu > button { width: 34px; height: 34px; border: 0; background: transparent; color: #64748b; border-radius: 8px; cursor: pointer; font-size: 14px; }
.strategy-item-menu > button:hover { background: #eef4ff; color: #1d4ed8; }
.strategy-item-popover { position: absolute; top: 38px; right: 0; z-index: 8; width: 132px; border: 1px solid #e2e8f0; background: #fff; border-radius: 8px; padding: 5px; box-shadow: 0 14px 28px rgba(15, 23, 42, 0.14); }
.strategy-item-popover button { width: 100%; border: 0; background: transparent; color: #334155; border-radius: 6px; padding: 8px 9px; text-align: left; cursor: pointer; font-size: 12px; }
.strategy-item-popover button:hover:not(:disabled) { background: #f1f5f9; }
.strategy-item-popover button:disabled { color: #cbd5e1; cursor: not-allowed; }
.strategy-item-popover button.danger { color: #b91c1c; }
.strategy-edit-label span { display: block; margin-bottom: 6px; color: #475569; font-size: 12px; font-weight: 800; }
.strategy-edit-label textarea { width: 100%; min-height: 104px; border: 1px solid #93c5fd; background: #fff; color: #1e293b; border-radius: 8px; padding: 10px 12px; resize: vertical; font: inherit; font-size: 14px; line-height: 1.7; }
.strategy-edit-label textarea:focus { outline: 3px solid rgba(37, 99, 235, 0.16); }
.strategy-edit-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 8px; }
.strategy-edit-actions small { margin-right: auto; color: #94a3b8; font-size: 11px; }
.strategy-edit-actions button { border: 1px solid #cbd5e1; background: #fff; color: #475569; border-radius: 7px; padding: 7px 11px; cursor: pointer; font-size: 12px; font-weight: 800; }
.strategy-edit-actions button.primary { border-color: #2563eb; background: #2563eb; color: #fff; }
.strategy-add { margin-top: 14px; border: 1px dashed #93c5fd; background: #f8fbff; color: #1d4ed8; border-radius: 9px; padding: 10px 14px; cursor: pointer; font-size: 13px; font-weight: 800; }
.strategy-add:hover { border-style: solid; background: #eff6ff; }
.strategy-empty { border: 1px dashed #cbd5e1; border-radius: 9px; padding: 18px; color: #64748b; text-align: center; font-size: 13px; }
.strategy-undo { position: sticky; bottom: 12px; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 18px; width: min(360px, calc(100% - 24px)); margin: 12px auto 0; background: #0f172a; color: #fff; border-radius: 8px; padding: 10px 12px; box-shadow: 0 14px 28px rgba(15, 23, 42, 0.2); font-size: 12px; }
.strategy-undo button { border: 0; background: transparent; color: #93c5fd; cursor: pointer; font-weight: 900; }

@media (max-width: 760px) {
  .strategy-panel { padding: 16px; }
  .strategy-item { grid-template-columns: 28px minmax(0, 1fr) 34px; gap: 6px; padding: 12px 8px; }
  .strategy-edit-actions { flex-wrap: wrap; }
  .strategy-edit-actions small { width: 100%; }
}
</style>
