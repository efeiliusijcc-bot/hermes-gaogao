<script setup>
import { computed } from 'vue'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CircleAlert,
  Cloud,
  Copy,
  LoaderCircle,
  Plus,
  RotateCw,
  Trash2,
  WandSparkles,
} from '@lucide/vue'
import AutoResizeTextarea from './common/AutoResizeTextarea.vue'

const props = defineProps({
  modelValue: { type: Object, required: true },
  saveStatus: { type: String, default: 'idle' },
  saveError: { type: String, default: '' },
  feedback: { type: String, default: '' },
  revising: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:modelValue',
  'update:feedback',
  'revise',
  'retry-save',
  'confirm',
  'back',
])

const outlineItems = computed(() => Array.isArray(props.modelValue?.outlineItems) ? props.modelValue.outlineItems : [])
const saveDisplay = computed(() => ({
  idle: { label: '已自动保存', tone: 'saved', icon: Cloud },
  dirty: { label: '未保存', tone: 'dirty', icon: CircleAlert },
  saving: { label: '保存中', tone: 'saving', icon: LoaderCircle },
  saved: { label: '已自动保存', tone: 'saved', icon: Check },
  error: { label: '保存失败', tone: 'error', icon: CircleAlert },
}[props.saveStatus] || { label: '未保存', tone: 'dirty', icon: CircleAlert }))

function cloneItems(items = outlineItems.value) {
  return items.map((item) => ({
    level: 1,
    title: String(item?.title || ''),
    summary: String(item?.summary || ''),
    children: Array.isArray(item?.children)
      ? item.children.map((child) => ({
          level: 2,
          title: String(child?.title || ''),
          summary: String(child?.summary || ''),
        }))
      : [],
  }))
}

function emitOutline(patch) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function patchRoot(key, value) {
  emitOutline({ [key]: value })
}

function patchSection(index, patch) {
  const items = cloneItems()
  items[index] = { ...items[index], ...patch }
  emitOutline({ outlineItems: items })
}

function patchChild(sectionIndex, childIndex, patch) {
  const items = cloneItems()
  items[sectionIndex].children[childIndex] = {
    ...items[sectionIndex].children[childIndex],
    ...patch,
  }
  emitOutline({ outlineItems: items })
}

function addSection() {
  emitOutline({
    outlineItems: [
      ...cloneItems(),
      { level: 1, title: '新增章节', summary: '', children: [] },
    ],
  })
}

function duplicateSection(index) {
  const items = cloneItems()
  items.splice(index + 1, 0, JSON.parse(JSON.stringify(items[index])))
  emitOutline({ outlineItems: items })
}

function moveSection(index, offset) {
  const target = index + offset
  if (target < 0 || target >= outlineItems.value.length) return
  const items = cloneItems()
  const [item] = items.splice(index, 1)
  items.splice(target, 0, item)
  emitOutline({ outlineItems: items })
}

function removeSection(index) {
  const items = cloneItems()
  items.splice(index, 1)
  emitOutline({ outlineItems: items })
}

function addChild(sectionIndex) {
  const items = cloneItems()
  items[sectionIndex].children.push({ level: 2, title: '新增小节', summary: '' })
  emitOutline({ outlineItems: items })
}

function removeChild(sectionIndex, childIndex) {
  const items = cloneItems()
  items[sectionIndex].children.splice(childIndex, 1)
  emitOutline({ outlineItems: items })
}
</script>

<template>
  <section class="draft-outline-editor" aria-labelledby="draft-outline-editor-title">
    <header class="draft-editor-head">
      <div>
        <p>拟稿提纲</p>
        <h1 id="draft-outline-editor-title">编辑当前提纲</h1>
      </div>
      <div class="draft-save-status" :class="saveDisplay.tone" aria-live="polite">
        <component :is="saveDisplay.icon" :size="16" :class="{ spin: saveStatus === 'saving' }" aria-hidden="true" />
        <span>{{ saveDisplay.label }}</span>
        <button v-if="saveStatus === 'error'" type="button" @click="emit('retry-save')">
          <RotateCw :size="14" aria-hidden="true" />重试
        </button>
      </div>
    </header>

    <p v-if="saveStatus === 'error' && saveError" class="draft-save-error" role="alert">{{ saveError }}</p>

    <div class="draft-outline-fields">
      <label>
        <span>建议标题</span>
        <input :value="modelValue.reportTitle" maxlength="300" @input="patchRoot('reportTitle', $event.target.value)" />
      </label>
      <label>
        <span>主题立意</span>
        <AutoResizeTextarea
          :model-value="modelValue.reportTheme || ''"
          :min-height="88"
          :maxlength="1600"
          aria-label="主题立意"
          @update:model-value="patchRoot('reportTheme', $event)"
        />
      </label>
      <label>
        <span>核心判断</span>
        <AutoResizeTextarea
          :model-value="modelValue.coreArgument || ''"
          :min-height="100"
          :maxlength="2400"
          aria-label="核心判断"
          @update:model-value="patchRoot('coreArgument', $event)"
        />
      </label>
    </div>

    <div class="draft-directory-head">
      <div>
        <h2>目录结构</h2>
        <p>直接修改章节标题和说明。</p>
      </div>
      <button type="button" @click="addSection"><Plus :size="16" aria-hidden="true" />添加章节</button>
    </div>

    <div class="draft-directory-editor">
      <article v-for="(item, index) in outlineItems" :key="index" class="draft-section-editor">
        <header>
          <strong>{{ index + 1 }}</strong>
          <input
            :value="item.title"
            :aria-label="`第 ${index + 1} 章标题`"
            maxlength="300"
            @input="patchSection(index, { title: $event.target.value })"
          />
          <div class="draft-section-actions">
            <button type="button" :disabled="index === 0" aria-label="章节上移" title="上移" @click="moveSection(index, -1)"><ArrowUp :size="15" /></button>
            <button type="button" :disabled="index === outlineItems.length - 1" aria-label="章节下移" title="下移" @click="moveSection(index, 1)"><ArrowDown :size="15" /></button>
            <button type="button" aria-label="复制章节" title="复制" @click="duplicateSection(index)"><Copy :size="15" /></button>
            <button type="button" class="danger" aria-label="移除章节" title="移除" @click="removeSection(index)"><Trash2 :size="15" /></button>
          </div>
        </header>
        <AutoResizeTextarea
          :model-value="item.summary"
          :min-height="72"
          :maxlength="1800"
          :aria-label="`第 ${index + 1} 章说明`"
          placeholder="章节说明"
          @update:model-value="patchSection(index, { summary: $event })"
        />

        <div v-if="item.children.length" class="draft-child-list">
          <div v-for="(child, childIndex) in item.children" :key="childIndex" class="draft-child-editor">
            <span>{{ index + 1 }}.{{ childIndex + 1 }}</span>
            <div>
              <input
                :value="child.title"
                :aria-label="`第 ${index + 1} 章第 ${childIndex + 1} 节标题`"
                maxlength="300"
                @input="patchChild(index, childIndex, { title: $event.target.value })"
              />
              <AutoResizeTextarea
                :model-value="child.summary"
                :min-height="62"
                :maxlength="1200"
                :aria-label="`第 ${index + 1} 章第 ${childIndex + 1} 节说明`"
                placeholder="小节说明"
                @update:model-value="patchChild(index, childIndex, { summary: $event })"
              />
            </div>
            <button type="button" aria-label="移除小节" title="移除小节" @click="removeChild(index, childIndex)"><Trash2 :size="15" /></button>
          </div>
        </div>
        <button class="draft-add-child" type="button" @click="addChild(index)"><Plus :size="15" aria-hidden="true" />添加二级目录</button>
      </article>

      <div v-if="!outlineItems.length" class="draft-directory-empty">
        <p>当前提纲还没有目录。</p>
        <button type="button" @click="addSection"><Plus :size="16" aria-hidden="true" />添加第一章</button>
      </div>
    </div>

    <section class="draft-ai-revision" aria-labelledby="draft-ai-revision-title">
      <header>
        <WandSparkles :size="18" aria-hidden="true" />
        <div>
          <h2 id="draft-ai-revision-title">AI 修改</h2>
          <p>输入对当前提纲的修改意见。</p>
        </div>
      </header>
      <AutoResizeTextarea
        :model-value="feedback"
        :disabled="revising"
        :min-height="92"
        :maxlength="2000"
        aria-label="AI 修改意见"
        placeholder="例如：加强涉我风险分析，合并重复章节"
        @update:model-value="emit('update:feedback', $event)"
      />
      <button type="button" :disabled="revising || !feedback.trim() || saveStatus === 'error'" @click="emit('revise')">
        <LoaderCircle v-if="revising" :size="17" class="spin" aria-hidden="true" />
        <WandSparkles v-else :size="17" aria-hidden="true" />
        {{ revising ? '正在修改' : '应用 AI 修改' }}
      </button>
    </section>

    <footer class="draft-editor-footer">
      <button class="secondary" type="button" :disabled="revising" @click="emit('back')"><ArrowLeft :size="17" />返回事件分析</button>
      <button class="primary" type="button" :disabled="revising || saveStatus === 'saving' || saveStatus === 'error'" @click="emit('confirm')"><Check :size="17" />下一步：确认提纲</button>
    </footer>
  </section>
</template>

<style scoped>
.draft-outline-editor { width: min(1040px, 100%); margin: 0 auto; padding: 18px 0 58px; }
.draft-editor-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.draft-editor-head p { margin: 0 0 4px; color: #64748b; font-size: 12px; font-weight: 700; }
.draft-editor-head h1 { margin: 0; color: #111827; font-size: 24px; letter-spacing: 0; }
.draft-save-status { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; border: 1px solid #d8dee7; background: #fff; color: #64748b; border-radius: 7px; padding: 0 10px; font-size: 12px; }
.draft-save-status.saved { border-color: #bbd8c7; color: #27704b; }
.draft-save-status.dirty { border-color: #f4d59b; background: #fffaf0; color: #9a6012; }
.draft-save-status.error { border-color: #f1b8b8; background: #fff7f7; color: #b42323; }
.draft-save-status button { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: inherit; padding: 0 0 0 4px; cursor: pointer; font-weight: 700; }
.draft-save-error { margin: -10px 0 18px; color: #b42323; font-size: 12px; text-align: right; }
.draft-outline-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.draft-outline-fields label:last-child { grid-column: 1 / -1; }
.draft-outline-fields label, .draft-section-editor { min-width: 0; }
.draft-outline-fields label > span { display: block; margin-bottom: 7px; color: #374151; font-size: 12px; font-weight: 750; }
.draft-outline-fields input, .draft-outline-fields :deep(textarea), .draft-section-editor input, .draft-section-editor :deep(textarea), .draft-ai-revision :deep(textarea) { width: 100%; box-sizing: border-box; border: 1px solid #dce1e8; background: #fff; color: #1f2937; border-radius: 7px; padding: 10px 11px; font-size: 13px; line-height: 1.7; outline: 0; }
.draft-outline-fields input:focus, .draft-outline-fields :deep(textarea:focus), .draft-section-editor input:focus, .draft-section-editor :deep(textarea:focus), .draft-ai-revision :deep(textarea:focus) { border-color: #8daedb; box-shadow: 0 0 0 3px rgba(49, 95, 157, 0.1); }
.draft-directory-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-top: 34px; padding-bottom: 10px; border-bottom: 1px solid #dfe4ea; }
.draft-directory-head h2, .draft-ai-revision h2 { margin: 0; color: #1f2937; font-size: 16px; }
.draft-directory-head p, .draft-ai-revision p { margin: 4px 0 0; color: #89919d; font-size: 11px; }
.draft-directory-head button, .draft-add-child, .draft-directory-empty button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #d6dde7; background: #fff; color: #3f4b5d; border-radius: 7px; padding: 8px 10px; cursor: pointer; font-size: 12px; font-weight: 700; }
.draft-section-editor { padding: 20px 0; border-bottom: 1px solid #e4e8ed; }
.draft-section-editor > header { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 10px; margin-bottom: 10px; }
.draft-section-editor > header > strong { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #edf3fb; color: #315f9d; border-radius: 7px; font-size: 12px; }
.draft-section-actions { display: flex; align-items: center; gap: 3px; }
.draft-section-actions button, .draft-child-editor > button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 0; background: transparent; color: #697386; border-radius: 6px; cursor: pointer; }
.draft-section-actions button:hover:not(:disabled), .draft-child-editor > button:hover { background: #eef1f5; color: #253047; }
.draft-section-actions button:disabled { color: #c7ccd3; cursor: not-allowed; }
.draft-section-actions button.danger:hover, .draft-child-editor > button:hover { background: #fff0f0; color: #b42323; }
.draft-child-list { margin: 14px 0 0 30px; border-left: 2px solid #d9e5f7; padding-left: 14px; }
.draft-child-editor { display: grid; grid-template-columns: 36px minmax(0, 1fr) 32px; gap: 8px; align-items: start; padding: 11px 0; }
.draft-child-editor > span { padding-top: 9px; color: #788393; font-size: 11px; font-weight: 700; }
.draft-child-editor > div { display: grid; gap: 7px; }
.draft-add-child { margin: 12px 0 0 30px; border-style: dashed; }
.draft-directory-empty { padding: 32px 0; color: #7b8490; text-align: center; }
.draft-directory-empty p { margin: 0 0 12px; }
.draft-ai-revision { margin-top: 32px; border-top: 1px solid #dfe4ea; padding-top: 22px; }
.draft-ai-revision > header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; color: #315f9d; }
.draft-ai-revision > header div { color: initial; }
.draft-ai-revision > button { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; margin-top: 10px; border: 1px solid #3c679f; background: #3c679f; color: #fff; border-radius: 7px; padding: 0 13px; cursor: pointer; font-size: 12px; font-weight: 700; }
.draft-ai-revision > button:disabled { opacity: 0.52; cursor: not-allowed; }
.draft-editor-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 34px; border-top: 1px solid #e1e5ea; padding-top: 18px; }
.draft-editor-footer button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; border-radius: 7px; padding: 0 14px; cursor: pointer; font-size: 12px; font-weight: 700; }
.draft-editor-footer .secondary { border: 1px solid #d5dbe3; background: #fff; color: #4b5563; }
.draft-editor-footer .primary { border: 1px solid #1f2937; background: #1f2937; color: #fff; }
.draft-editor-footer button:disabled { opacity: 0.52; cursor: not-allowed; }
.draft-outline-editor button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.2); outline-offset: 2px; }
.spin { animation: draft-spin 800ms linear infinite; }
@keyframes draft-spin { to { transform: rotate(360deg); } }

@media (max-width: 760px) {
  .draft-editor-head, .draft-directory-head, .draft-editor-footer { align-items: stretch; flex-direction: column; }
  .draft-save-status { align-self: flex-start; }
  .draft-outline-fields { grid-template-columns: 1fr; }
  .draft-outline-fields label:last-child { grid-column: auto; }
  .draft-section-editor > header { grid-template-columns: 30px minmax(0, 1fr); }
  .draft-section-actions { grid-column: 2; justify-content: flex-start; }
  .draft-child-list, .draft-add-child { margin-left: 8px; }
  .draft-child-editor { grid-template-columns: 34px minmax(0, 1fr) 32px; }
  .draft-editor-footer button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
