<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  createPromptSnippet,
  createUserTemplate,
  deletePromptSnippet,
  deleteUserTemplate,
  getMyPreferences,
  getPromptSnippets,
  getUserTemplates,
  updateMyPreferences,
  updateUserTemplate,
} from '../lib/api.js'

const emit = defineEmits(['close'])

const activeTab = ref('preferences')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const templates = ref([])
const snippets = ref([])

const preferenceForm = reactive({
  defaultReportType: '',
  defaultRegion: '',
  writingStyle: '',
  tone: '',
  defaultSourceOptionsText: '{\n  "databaseSourceEnabled": true,\n  "lookbackDays": 30,\n  "maxMetadataRows": 50,\n  "maxContentRows": 8\n}',
  defaultOutlineOptionsText: '{\n  "includeAttitudes": true,\n  "includeRiskToUs": true,\n  "includeTrend": true\n}',
})

const templateForm = reactive({
  templateName: '',
  templateType: 'daily_event_report',
  description: '',
  isDefault: false,
  templateJsonText: JSON.stringify({
    sections: [
      { title: '事件概况', goal: '讲清事件背景、经过、进展和影响' },
      { title: '各方态度', goal: '标注表态主体、时间、媒体、来源' },
      { title: '涉我风险', goal: '分析对我方政治、经济、安全、舆论等影响' },
      { title: '趋势研判', goal: '判断后续演变' },
    ],
    writingConstraints: ['不得仅根据标题推断事实', '缺少来源的信息标注待核实', '风险判断必须有事实依据'],
    sourceRequirements: ['优先使用数据库信源', '各方态度必须包含时间、媒体、来源'],
  }, null, 2),
})

const snippetForm = reactive({
  snippetName: '',
  snippetType: 'risk_focus',
  content: '',
  tagsText: 'risk',
})

const tabs = [
  { key: 'preferences', label: '编报偏好' },
  { key: 'templates', label: '我的模板' },
  { key: 'snippets', label: '常用提示词' },
]

const hasTemplates = computed(() => templates.value.length > 0)
const hasSnippets = computed(() => snippets.value.length > 0)

function parseObject(text, label) {
  try {
    const parsed = JSON.parse(text || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // Fall through to the shared error below.
  }
  throw new Error(`${label} 必须是 JSON 对象`)
}

function parseTags(text) {
  return String(text || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function fillPreferenceForm(value) {
  preferenceForm.defaultReportType = value?.defaultReportType || ''
  preferenceForm.defaultRegion = value?.defaultRegion || ''
  preferenceForm.writingStyle = value?.writingStyle || ''
  preferenceForm.tone = value?.tone || ''
  preferenceForm.defaultSourceOptionsText = JSON.stringify(value?.defaultSourceOptions || {}, null, 2)
  preferenceForm.defaultOutlineOptionsText = JSON.stringify(value?.defaultOutlineOptions || {}, null, 2)
}

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [preferences, templateResult, snippetResult] = await Promise.all([
      getMyPreferences(),
      getUserTemplates({ pageSize: 100 }),
      getPromptSnippets({ pageSize: 100 }),
    ])
    fillPreferenceForm(preferences)
    templates.value = Array.isArray(templateResult?.items) ? templateResult.items : []
    snippets.value = Array.isArray(snippetResult?.items) ? snippetResult.items : []
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function savePreferences() {
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const updated = await updateMyPreferences({
      defaultReportType: preferenceForm.defaultReportType,
      defaultRegion: preferenceForm.defaultRegion,
      writingStyle: preferenceForm.writingStyle,
      tone: preferenceForm.tone,
      defaultSourceOptions: parseObject(preferenceForm.defaultSourceOptionsText, '默认信源设置'),
      defaultOutlineOptions: parseObject(preferenceForm.defaultOutlineOptionsText, '默认提纲选项'),
      preferenceJson: {},
    })
    fillPreferenceForm(updated)
    notice.value = '编报偏好已保存。'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function addTemplate() {
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await createUserTemplate({
      templateName: templateForm.templateName,
      templateType: templateForm.templateType,
      description: templateForm.description,
      isDefault: templateForm.isDefault,
      templateJson: parseObject(templateForm.templateJsonText, '模板 JSON'),
    })
    templateForm.templateName = ''
    templateForm.description = ''
    templateForm.isDefault = false
    await loadTemplates()
    notice.value = '模板已保存。'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function loadTemplates() {
  const result = await getUserTemplates({ pageSize: 100 })
  templates.value = Array.isArray(result?.items) ? result.items : []
}

async function setDefaultTemplate(template) {
  saving.value = true
  error.value = ''
  try {
    await updateUserTemplate(template.templateId, { ...template, isDefault: true })
    await loadTemplates()
    notice.value = '默认模板已更新。'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function removeTemplate(template) {
  saving.value = true
  error.value = ''
  try {
    await deleteUserTemplate(template.templateId)
    await loadTemplates()
    notice.value = '模板已删除。'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function addSnippet() {
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await createPromptSnippet({
      snippetName: snippetForm.snippetName,
      snippetType: snippetForm.snippetType,
      content: snippetForm.content,
      tags: parseTags(snippetForm.tagsText),
    })
    snippetForm.snippetName = ''
    snippetForm.content = ''
    await loadSnippets()
    notice.value = '常用提示词已保存。'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function loadSnippets() {
  const result = await getPromptSnippets({ pageSize: 100 })
  snippets.value = Array.isArray(result?.items) ? result.items : []
}

async function removeSnippet(snippet) {
  saving.value = true
  error.value = ''
  try {
    await deletePromptSnippet(snippet.snippetId)
    await loadSnippets()
    notice.value = '常用提示词已删除。'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

onMounted(loadAll)
</script>

<template>
  <div class="personal-settings-backdrop" @click.self="emit('close')">
    <section class="personal-settings-panel" role="dialog" aria-modal="true" aria-labelledby="personal-settings-title">
      <header class="personal-settings-header">
        <div>
          <h2 id="personal-settings-title">个人设置</h2>
          <p>个人偏好、编报模板和常用提示词</p>
        </div>
        <button class="personal-icon-btn" type="button" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <nav class="personal-tabs" aria-label="个人设置分类">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div v-if="error" class="personal-alert error">{{ error }}</div>
      <div v-if="notice" class="personal-alert notice">{{ notice }}</div>
      <div v-if="loading" class="personal-loading">正在加载...</div>

      <div v-else class="personal-settings-body">
        <form v-if="activeTab === 'preferences'" class="personal-form" @submit.prevent="savePreferences">
          <label>默认地区<input v-model="preferenceForm.defaultRegion" type="text" placeholder="欧洲" /></label>
          <label>默认报告类型<input v-model="preferenceForm.defaultReportType" type="text" placeholder="综合研判" /></label>
          <label>写作风格<input v-model="preferenceForm.writingStyle" type="text" placeholder="简洁、正式、情报分析风格" /></label>
          <label>语气<input v-model="preferenceForm.tone" type="text" placeholder="客观审慎" /></label>
          <label>默认信源设置<textarea v-model="preferenceForm.defaultSourceOptionsText" rows="6" spellcheck="false"></textarea></label>
          <label>默认提纲选项<textarea v-model="preferenceForm.defaultOutlineOptionsText" rows="5" spellcheck="false"></textarea></label>
          <button class="personal-primary-btn" type="submit" :disabled="saving">保存偏好</button>
        </form>

        <div v-else-if="activeTab === 'templates'" class="personal-split">
          <form class="personal-form" @submit.prevent="addTemplate">
            <label>模板名称<input v-model="templateForm.templateName" type="text" placeholder="欧洲政治事件编报模板" /></label>
            <label>模板类型<input v-model="templateForm.templateType" type="text" /></label>
            <label>描述<input v-model="templateForm.description" type="text" /></label>
            <label class="personal-check"><input v-model="templateForm.isDefault" type="checkbox" /> 设为默认模板</label>
            <label>模板 JSON<textarea v-model="templateForm.templateJsonText" rows="10" spellcheck="false"></textarea></label>
            <button class="personal-primary-btn" type="submit" :disabled="saving">新增模板</button>
          </form>
          <div class="personal-list">
            <div v-if="!hasTemplates" class="personal-empty">暂无模板</div>
            <article v-for="template in templates" :key="template.templateId" class="personal-list-item">
              <div>
                <strong>{{ template.templateName }}</strong>
                <span>{{ template.templateType || '未分类' }}</span>
              </div>
              <div class="personal-actions">
                <button type="button" :disabled="saving || template.isDefault" @click="setDefaultTemplate(template)">
                  {{ template.isDefault ? '默认' : '设默认' }}
                </button>
                <button type="button" :disabled="saving" @click="removeTemplate(template)">删除</button>
              </div>
            </article>
          </div>
        </div>

        <div v-else class="personal-split">
          <form class="personal-form" @submit.prevent="addSnippet">
            <label>名称<input v-model="snippetForm.snippetName" type="text" placeholder="强化涉我风险" /></label>
            <label>类型<input v-model="snippetForm.snippetType" type="text" /></label>
            <label>标签<input v-model="snippetForm.tagsText" type="text" placeholder="risk,europe" /></label>
            <label>内容<textarea v-model="snippetForm.content" rows="6" placeholder="以欧洲政治和经济影响为主线。"></textarea></label>
            <button class="personal-primary-btn" type="submit" :disabled="saving">新增提示词</button>
          </form>
          <div class="personal-list">
            <div v-if="!hasSnippets" class="personal-empty">暂无常用提示词</div>
            <article v-for="snippet in snippets" :key="snippet.snippetId" class="personal-list-item">
              <div>
                <strong>{{ snippet.snippetName }}</strong>
                <span>{{ snippet.content }}</span>
              </div>
              <div class="personal-actions">
                <button type="button" :disabled="saving" @click="removeSnippet(snippet)">删除</button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.personal-settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 180;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.28);
}

.personal-settings-panel {
  width: min(980px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  overflow: auto;
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: 12px;
  background: #fff;
  color: #0f172a;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.22);
}

.personal-settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 14px;
  border-bottom: 1px solid #e2e8f0;
}

.personal-settings-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.personal-settings-header p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 12px;
}

.personal-icon-btn {
  width: 32px;
  height: 32px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.personal-tabs {
  display: flex;
  gap: 8px;
  padding: 14px 22px;
  border-bottom: 1px solid #e2e8f0;
}

.personal-tabs button,
.personal-actions button,
.personal-primary-btn {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
}

.personal-tabs button {
  min-height: 34px;
  padding: 0 12px;
}

.personal-tabs button.active,
.personal-primary-btn {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.personal-settings-body {
  padding: 18px 22px 22px;
}

.personal-form {
  display: grid;
  gap: 12px;
}

.personal-form label {
  display: grid;
  gap: 6px;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.personal-form input,
.personal-form textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 9px 10px;
  color: #0f172a;
  font-size: 13px;
  font-family: inherit;
}

.personal-form textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  resize: vertical;
}

.personal-check {
  display: flex !important;
  grid-template-columns: auto 1fr;
  align-items: center;
}

.personal-check input {
  width: auto;
}

.personal-primary-btn {
  min-height: 38px;
  padding: 0 14px;
  justify-self: start;
}

.personal-split {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(320px, 1.1fr);
  gap: 18px;
}

.personal-list {
  display: grid;
  gap: 10px;
  align-content: start;
}

.personal-list-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.personal-list-item strong,
.personal-list-item span {
  display: block;
}

.personal-list-item span {
  margin-top: 4px;
  color: #64748b;
  font-size: 12px;
}

.personal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.personal-actions button {
  min-height: 30px;
  padding: 0 10px;
}

.personal-alert,
.personal-loading,
.personal-empty {
  margin: 14px 22px 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.personal-alert.error {
  background: #fef2f2;
  color: #b91c1c;
}

.personal-alert.notice {
  background: #ecfdf5;
  color: #047857;
}

.personal-empty,
.personal-loading {
  background: #f8fafc;
  color: #64748b;
}

@media (max-width: 820px) {
  .personal-split {
    grid-template-columns: 1fr;
  }
}
</style>
