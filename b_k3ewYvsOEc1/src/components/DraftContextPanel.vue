<script setup>
const props = defineProps({
  currentStep: { type: String, required: true },
  inputSummary: { type: Object, required: true },
  coverage: { type: Object, required: true },
  events: { type: Array, default: () => [] },
  versions: { type: Array, default: () => [] },
  currentOutlineId: { type: String, default: '' },
  selectedVersionLabel: { type: String, default: '尚未选择版本' },
  importedVersionLabel: { type: String, default: '' },
  importedPlanIdShort: { type: String, default: '' },
  importStatus: { type: String, default: '' },
  displayOutline: { type: Object, default: () => ({}) },
  importedPlan: { type: Object, default: null },
  canImport: { type: Boolean, default: false },
  isVersionConfirmed: { type: Boolean, default: false },
  isImportReady: { type: Boolean, default: false },
  isReportJobReady: { type: Boolean, default: false },
  editing: { type: Boolean, default: false },
  hasEditChanges: { type: Boolean, default: false },
  isGeneratingOutline: { type: Boolean, default: false },
  isRefining: { type: Boolean, default: false },
  isSaving: { type: Boolean, default: false },
  isImportingOutline: { type: Boolean, default: false },
  isCreatingReportJob: { type: Boolean, default: false },
  outlinePreference: { type: String, default: '' },
  refineFeedback: { type: String, default: '' },
})

const emit = defineEmits([
  'close',
  'open-left',
  'reanalyze',
  'generate-outline',
  'refine',
  'edit',
  'confirm',
  'select-version',
  'import-outline',
  'create-report',
  'update:outline-preference',
  'update:refine-feedback',
])

function formatTime(value) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function versionType(item) {
  if (item?.editType === 'ai_refine') return 'AI 修改版'
  if (item?.editType === 'manual') return '手动修改版'
  return 'AI 生成版'
}
</script>

<template>
  <aside class="draft-context-panel draft-panel draft-right" aria-label="当前步骤辅助操作">
    <button class="context-close" type="button" aria-label="关闭操作面板" @click="emit('close')">×</button>

    <template v-if="currentStep === 'input'">
      <section>
        <header><span>Step 1</span><h2>输入建议</h2></header>
        <ul class="context-guidance">
          <li>标题应明确包含事件主体和主要动向。</li>
          <li>材料可粘贴已知事实、背景和现有判断。</li>
          <li>相关链接每行一个，建议优先使用可追溯来源。</li>
        </ul>
      </section>
      <section>
        <header><h2>输入完整度</h2><strong>{{ inputSummary.completion }}%</strong></header>
        <div class="context-progress"><i :style="{ width: `${inputSummary.completion}%` }"></i></div>
        <p>{{ inputSummary.canAnalyze ? '已具备分析条件，可继续补充可选信息。' : '填写事件标题后即可开始分析。' }}</p>
      </section>
      <section>
        <header><h2>最近草稿</h2><span>{{ events.length }} 项</span></header>
        <div class="context-recent">
          <div v-for="item in events.slice(0, 3)" :key="item.eventId">
            <strong>{{ item.title }}</strong><small>{{ formatTime(item.updatedAt || item.createdAt) }}</small>
          </div>
          <p v-if="!events.length">当前还没有历史草稿。</p>
        </div>
        <small class="context-condition">当前步骤暂不需要版本操作。</small>
      </section>
    </template>

    <template v-else-if="currentStep === 'analysis'">
      <section>
        <header><span>Step 2</span><h2>分析操作</h2></header>
        <p>当前分析结果将作为写作重点和提纲结构的基础。</p>
        <button class="context-secondary" type="button" @click="emit('reanalyze')">重新分析</button>
        <button class="context-secondary" type="button" @click="emit('open-left')">补充事件材料</button>
      </section>
      <section>
        <header><h2>生成提纲</h2></header>
        <label>
          <span>生成偏好</span>
          <textarea :value="outlinePreference" rows="5" placeholder="例如：突出风险判断、强化权威来源" @input="emit('update:outline-preference', $event.target.value)"></textarea>
        </label>
        <button class="context-primary" type="button" :disabled="isGeneratingOutline" @click="emit('generate-outline')">
          {{ isGeneratingOutline ? '正在生成提纲…' : '确认分析结果并生成提纲' }}
        </button>
      </section>
    </template>

    <template v-else-if="currentStep === 'outline'">
      <section>
        <header><span>Step 3</span><h2>AI 修改建议</h2></header>
        <label>
          <span>修改要求</span>
          <textarea :value="refineFeedback" rows="6" placeholder="说明需要补充的角度、章节顺序或来源要求" @input="emit('update:refine-feedback', $event.target.value)"></textarea>
        </label>
        <button class="context-primary" type="button" :disabled="isRefining || !currentOutlineId" @click="emit('refine')">
          {{ isRefining ? '正在调整…' : '生成 AI 修改版本' }}
        </button>
      </section>
      <section>
        <header><h2>版本记录</h2><span>{{ versions.length }} 个</span></header>
        <button v-for="item in versions" :key="item.outlineId" class="context-version" :class="{ active: item.outlineId === currentOutlineId }" type="button" @click="emit('select-version', item.outlineId)">
          <strong>V{{ item.versionNo }} · {{ versionType(item) }}</strong><small>{{ formatTime(item.createdAt) }}</small>
        </button>
        <p v-if="!versions.length">尚未生成提纲版本。</p>
      </section>
      <section>
        <header><h2>提纲操作</h2></header>
        <button class="context-secondary" type="button" @click="emit('edit')">编辑提纲</button>
        <button class="context-primary" type="button" @click="emit('confirm')">确认当前版本</button>
      </section>
    </template>

    <template v-else-if="currentStep === 'confirm'">
      <section>
        <header><span>Step 4</span><h2>AI 修改建议</h2></header>
        <label>
          <span>修改要求</span>
          <textarea :value="refineFeedback" rows="6" placeholder="说明需要调整的内容" @input="emit('update:refine-feedback', $event.target.value)"></textarea>
        </label>
        <button class="context-secondary" type="button" :disabled="isRefining || hasEditChanges" @click="emit('refine')">提交修改建议</button>
        <small v-if="hasEditChanges" class="context-warning">请先保存或取消当前手动修改。</small>
      </section>
      <section>
        <header><h2>版本记录</h2><span>{{ versions.length }} 个</span></header>
        <button v-for="item in versions" :key="item.outlineId" class="context-version" :class="{ active: item.outlineId === currentOutlineId }" type="button" @click="emit('select-version', item.outlineId)">
          <strong>V{{ item.versionNo }} · {{ versionType(item) }}</strong><small>{{ formatTime(item.createdAt) }}</small>
        </button>
      </section>
      <section class="context-next">
        <header><h2>下一步操作</h2></header>
        <p>确认已保存的当前版本后，可继续检查资料覆盖并导入深度编报。</p>
        <button class="context-primary" type="button" :disabled="hasEditChanges || isSaving" @click="emit('confirm')">确认当前版本并继续</button>
      </section>
    </template>

    <template v-else-if="currentStep === 'import'">
      <section>
        <header><span>Step 5</span><h2>导入说明</h2></header>
        <strong class="context-version-label">{{ importedPlan ? importedVersionLabel : selectedVersionLabel }}</strong>
        <p>导入后，系统将使用当前版本和已确认资料生成正式报告规划。</p>
      </section>
      <section>
        <header><h2>资料覆盖</h2><strong>{{ coverage.label }}</strong></header>
        <dl class="context-coverage">
          <div><dt>写作重点</dt><dd>{{ displayOutline.writingFocus?.length || 0 }} 项</dd></div>
          <div><dt>来源要求</dt><dd>{{ displayOutline.sourceRequirements?.length || 0 }} 项</dd></div>
          <div><dt>待核实事项</dt><dd>{{ displayOutline.uncertaintiesToVerify?.length || 0 }} 项</dd></div>
          <div><dt>有效事件链接</dt><dd>{{ coverage.validLinkCount }} 条</dd></div>
          <div><dt>已采集资料数量</dt><dd>{{ coverage.collectedSourceCountLabel }}</dd></div>
        </dl>
      </section>
      <section>
        <header><h2>{{ importedPlan ? '创建正式任务' : '确认导入' }}</h2></header>
        <div v-if="importedPlan" class="context-plan">
          <span>Plan ID</span><strong>{{ importedPlanIdShort }}</strong>
          <p>{{ importedPlan.plan?.reportTitle || displayOutline.reportTitle || '深度编报规划' }}</p>
        </div>
        <p v-else-if="!canImport">当前账号没有导入深度编报的权限。</p>
        <p v-else>{{ importStatus }}</p>
        <button v-if="!importedPlan" class="context-primary" type="button" :disabled="!isImportReady || isImportingOutline || editing" @click="emit('import-outline')">
          {{ isImportingOutline ? '正在导入…' : '确认导入深度编报' }}
        </button>
        <button v-else class="context-primary" type="button" :disabled="!isReportJobReady || isCreatingReportJob" @click="emit('create-report')">
          {{ isCreatingReportJob ? '正在创建…' : '创建深度编报任务' }}
        </button>
      </section>
    </template>
  </aside>
</template>

<style scoped>
.draft-context-panel { position: sticky; top: 0; display: flex; flex-direction: column; gap: 0; min-width: 0; max-height: calc(100vh - 220px); border: 1px solid rgba(148, 163, 184, 0.24); background: #fff; border-radius: 8px; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05); overflow-y: auto; }
.context-close { display: none; position: absolute; top: 8px; right: 8px; z-index: 3; width: 30px; height: 30px; border: 0; background: #f1f5f9; color: #475569; border-radius: 8px; cursor: pointer; font-size: 18px; }
.draft-context-panel section { padding: 16px; border-bottom: 1px solid #e2e8f0; }
.draft-context-panel section:last-child { border-bottom: 0; }
.draft-context-panel header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.draft-context-panel header h2 { margin: 0; color: #172033; font-size: 15px; font-weight: 900; }
.draft-context-panel header > span { color: #2563eb; font-size: 10px; font-weight: 900; }
.draft-context-panel header > strong { color: #1d4ed8; font-size: 11px; }
.draft-context-panel p { margin: 6px 0 0; color: #64748b; font-size: 12px; line-height: 1.65; }
.context-guidance { display: grid; gap: 8px; margin: 0; padding-left: 18px; color: #475569; font-size: 12px; line-height: 1.65; }
.context-progress { height: 6px; overflow: hidden; background: #dbeafe; border-radius: 6px; }
.context-progress i { display: block; height: 100%; background: #2563eb; border-radius: inherit; }
.context-recent { display: grid; gap: 8px; }
.context-recent > div { padding-bottom: 8px; border-bottom: 1px solid #eef2f7; }
.context-recent strong,
.context-recent small { display: block; }
.context-recent strong { display: -webkit-box; overflow: hidden; color: #334155; font-size: 11px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.context-recent small { margin-top: 3px; color: #94a3b8; font-size: 9px; }
.context-condition { display: block; margin-top: 10px; color: #94a3b8; font-size: 10px; line-height: 1.5; }
.draft-context-panel label { display: grid; gap: 6px; }
.draft-context-panel label > span { color: #475569; font-size: 11px; font-weight: 900; }
.draft-context-panel textarea { width: 100%; border: 1px solid #dbe3ef; background: #f8fafc; color: #334155; border-radius: 8px; padding: 9px 10px; resize: vertical; font: inherit; font-size: 12px; line-height: 1.65; }
.draft-context-panel textarea:focus { border-color: #60a5fa; background: #fff; outline: 3px solid rgba(37, 99, 235, 0.13); }
.context-primary,
.context-secondary { width: 100%; min-height: 38px; margin-top: 10px; border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 900; }
.context-primary { border-color: #2563eb; background: #2563eb; color: #fff; }
.context-primary:hover:not(:disabled) { background: #1d4ed8; }
.context-secondary:hover:not(:disabled) { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.context-primary:disabled,
.context-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
.context-warning { display: block; margin-top: 7px; color: #b45309; font-size: 10px; line-height: 1.5; }
.context-version { display: grid; gap: 3px; width: 100%; margin-top: 5px; border: 0; border-left: 3px solid transparent; background: #f8fafc; color: #475569; border-radius: 7px; padding: 9px; text-align: left; cursor: pointer; }
.context-version.active { border-left-color: #2563eb; background: #eff6ff; }
.context-version strong { color: #334155; font-size: 11px; }
.context-version small { color: #94a3b8; font-size: 9px; }
.context-next { background: #f8fbff; }
.context-version-label { display: block; color: #1d4ed8; font-size: 12px; }
.context-coverage { display: grid; gap: 0; margin: 0; }
.context-coverage > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid #eef2f7; }
.context-coverage dt { color: #64748b; font-size: 11px; }
.context-coverage dd { margin: 0; color: #334155; font-size: 11px; font-weight: 900; }
.context-plan { border: 1px solid #bbf7d0; background: #f0fdf4; border-radius: 8px; padding: 10px; }
.context-plan span,
.context-plan strong { display: block; color: #15803d; font-size: 10px; }
.context-plan strong { margin-top: 3px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

@media (max-width: 1359px) { .context-close { display: inline-flex; align-items: center; justify-content: center; } }
</style>
