import { computed, ref, watch } from 'vue'

const VERSION = 1
const PREFIX = 'hermes-report-planning:'
const OWNER_KEY = `${PREFIX}owner`
const STATES = ['generating', 'ready', 'error', 'interrupted', 'submitting', 'uncertain']
export const clonePlanningValue = (value) => JSON.parse(JSON.stringify(value))
const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const stringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')

export async function awaitPlanningSubmission(request, timeoutMs = 45000) {
  let timer
  try {
    return await Promise.race([request, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('提交等待超时，提交结果待核实。')), timeoutMs)
    })])
  } finally {
    clearTimeout(timer)
  }
}

export function emptyPlanningEditor() {
  return {
    reportPlan: null, planStepIndex: 0, planSelections: {}, planSearchSelections: [],
    planSourceInput: '', planSupplement: '', databaseSourceEnabled: true, planError: '',
    manualSourceDraft: '', manualDirectionDraft: '',
  }
}

export function validPlanningDraft(value, accountId) {
  const editor = value?.editor
  return value?.version === VERSION && value.accountId === accountId &&
    typeof value.id === 'string' && Boolean(value.id) &&
    Number.isFinite(Date.parse(value.updatedAt)) && STATES.includes(value.status) &&
    isObject(value.form) && typeof value.form.title === 'string' &&
    typeof value.form.reportType === 'string' && typeof value.form.contextText === 'string' &&
    ['countryOrRegion', 'currentPosition', 'scenario', 'targetCity', 'visitTime', 'outputDepth']
      .every((field) => typeof value.form[field] === 'string') &&
    isObject(value.form.parameterValues) && stringArray(value.form.activeParameters) &&
    isObject(editor) && Number.isInteger(editor.planStepIndex) && editor.planStepIndex >= 0 &&
    isObject(editor.planSelections) && Object.values(editor.planSelections).every(stringArray) &&
    stringArray(editor.planSearchSelections) && typeof editor.planSourceInput === 'string' &&
    typeof editor.planSupplement === 'string' && typeof editor.planError === 'string' &&
    typeof editor.databaseSourceEnabled === 'boolean' &&
    (editor.reportPlan === null || (isObject(editor.reportPlan) &&
      (!editor.reportPlan.searchQueries || stringArray(editor.reportPlan.searchQueries)) &&
      (!editor.reportPlan.intentRecognition || isObject(editor.reportPlan.intentRecognition)) &&
      (!editor.reportPlan.eventTaskPlan || (isObject(editor.reportPlan.eventTaskPlan) &&
        Array.isArray(editor.reportPlan.eventTaskPlan.tasks) && editor.reportPlan.eventTaskPlan.tasks.every(isObject))) &&
      editor.planStepIndex < Math.max(editor.reportPlan.steps?.length || 0, 1) &&
      Array.isArray(editor.reportPlan.steps) && editor.reportPlan.steps.every((step) =>
        isObject(step) && typeof step.id === 'string' &&
        (!step.options || (Array.isArray(step.options) && step.options.every(isObject)))))) &&
    (!['ready', 'submitting', 'uncertain'].includes(value.status) || editor.reportPlan !== null)
}

// A draft and its async lease belong to one authenticated account in this tab.
export function createReportPlanningDraft({ storage = () => window.sessionStorage, delay = 200 } = {}) {
  const draft = ref(null)
  const visible = ref(false)
  const storageWarning = ref('')
  let accountId = null
  let revision = 0
  let timer
  let restoring = false
  const key = (id) => `${PREFIX}${id}`
  function access(action) {
    try {
      return action(storage())
    } catch {
      storageWarning.value = '当前仅临时保存，刷新可能丢失'
      return undefined
    }
  }
  function flush() {
    clearTimeout(timer)
    if (!accountId || !draft.value) return
    access((store) => store.setItem(key(accountId), JSON.stringify(draft.value)))
  }
  const stop = watch(() => draft.value && JSON.stringify({ ...draft.value, updatedAt: undefined }), () => {
    if (restoring || !draft.value) return
    draft.value.updatedAt = new Date().toISOString()
    clearTimeout(timer)
    timer = setTimeout(flush, delay)
  }, { flush: 'sync' })
  function setAccount(id) {
    const next = String(id || '')
    if (next === accountId) return
    clearTimeout(timer)
    revision += 1
    visible.value = false
    storageWarning.value = ''
    if (accountId) access((store) => store.removeItem(key(accountId)))
    access((store) => {
      const previous = store.getItem(OWNER_KEY)
      if (previous && previous !== next) store.removeItem(key(previous))
      if (next) store.setItem(OWNER_KEY, next)
      else store.removeItem(OWNER_KEY)
    })
    accountId = next
    draft.value = null
    if (!next) return
    restoring = true
    const raw = access((store) => store.getItem(key(next)))
    try {
      const cached = raw ? JSON.parse(raw) : null
      if (validPlanningDraft(cached, next)) {
        if (cached.status === 'generating') cached.status = 'interrupted'
        if (cached.status === 'submitting') cached.status = 'uncertain'
        draft.value = cached
        flush()
      } else if (raw) access((store) => store.removeItem(key(next)))
    } catch {
      access((store) => store.removeItem(key(next)))
    } finally {
      restoring = false
    }
  }
  function start(form) {
    if (!accountId || draft.value) return null
    draft.value = {
      version: VERSION, accountId,
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      updatedAt: new Date().toISOString(), status: 'generating',
      form: clonePlanningValue(form), editor: emptyPlanningEditor(), vectorStatus: null,
    }
    visible.value = true
    flush()
    return begin('generating')
  }
  function begin(status) {
    if (!draft.value) return null
    revision += 1
    draft.value.status = status
    flush()
    return { accountId, id: draft.value.id, revision }
  }
  function matches(token) {
    return Boolean(token && token.accountId === accountId &&
      token.id === draft.value?.id && token.revision === revision)
  }
  function suspend() {
    flush()
    visible.value = false
  }
  function discard() {
    clearTimeout(timer)
    revision += 1
    draft.value = null
    visible.value = false
    if (accountId) access((store) => store.removeItem(key(accountId)))
  }
  function editorField(name) {
    const fallback = ref(emptyPlanningEditor()[name])
    return computed({
      get: () => draft.value ? draft.value.editor[name] : fallback.value,
      set: (value) => {
        if (draft.value) draft.value.editor[name] = value
        else fallback.value = value
      },
    })
  }
  function dispose() {
    flush()
    clearTimeout(timer)
    stop()
    revision += 1
  }
  return { draft, visible, storageWarning, setAccount, start, begin, matches,
    suspend, discard, flush, editorField, dispose }
}
