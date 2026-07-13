const STEP_DEFINITIONS = [
  { key: 'input', title: '事件输入' },
  { key: 'analysis', title: '事件分析' },
  { key: 'outline', title: '拟稿提纲' },
  { key: 'confirm', title: '确认版本' },
  { key: 'import', title: '导入深度编报' },
]

const STATUS_LABELS = {
  current: '进行中',
  completed: '已完成',
  needs_attention: '需要处理',
  processing: '处理中',
  failed: '失败',
  not_started: '未开始',
}

export function parseEventLinks(text) {
  const valid = []
  const invalid = []
  String(text || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      try {
        const url = new URL(item)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
        valid.push(url.toString())
      } catch {
        invalid.push(item)
      }
    })
  return { valid, invalid }
}

export function eventInputSummary(form = {}) {
  const links = parseEventLinks(form.linksText)
  const fields = {
    title: Boolean(String(form.title || '').trim()),
    materials: Boolean(String(form.materials || '').trim()),
    links: links.valid.length > 0,
    category: Boolean(String(form.category || '').trim()),
    region: Boolean(String(form.region || '').trim()),
  }
  const labels = {
    title: '事件标题',
    materials: '补充材料',
    links: '相关链接',
    category: '类别',
    region: '地区',
  }
  return {
    canAnalyze: fields.title,
    completion: Object.values(fields).filter(Boolean).length * 20,
    filled: Object.keys(fields).filter((key) => fields[key]).map((key) => labels[key]),
    missing: Object.keys(fields).filter((key) => !fields[key]).map((key) => labels[key]),
    links,
  }
}

export function deriveDraftStepStates(state = {}) {
  const currentIndex = Math.max(0, STEP_DEFINITIONS.findIndex((item) => item.key === state.currentStep))
  return STEP_DEFINITIONS.map((item, index) => {
    let status = index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'not_started'
    if (item.key === 'analysis' && state.isAnalyzing) status = 'processing'
    if (item.key === 'outline' && (state.isGeneratingOutline || state.isRefining)) status = 'processing'
    if (item.key === 'outline' && state.draftStatus === 'failed') status = 'failed'
    if (item.key === 'confirm' && state.hasEditChanges) status = 'needs_attention'
    if (item.key === 'import' && (state.isImportingOutline || state.isCreatingReportJob)) status = 'processing'
    if (item.key === 'import' && state.createdReportJob) status = 'completed'
    return { ...item, status, statusLabel: STATUS_LABELS[status] }
  })
}

export function draftContextSections(step) {
  return {
    input: ['guidance', 'completion', 'recent'],
    analysis: ['reanalyze', 'materials', 'generate'],
    outline: ['revision', 'versions', 'preview'],
    confirm: ['revision', 'versions', 'next'],
    import: ['instructions', 'coverage', 'import'],
  }[step] || []
}

export function deriveMaterialCoverage(state = {}) {
  const materials = Boolean(String(state.materials || '').trim())
  const validLinkCount = Array.isArray(state.validLinks) ? state.validLinks.length : 0
  const imported = Boolean(state.importedPlan?.planId)
  const label = imported
    ? '已形成导入计划'
    : materials && validLinkCount >= 2
      ? '资料较完整'
      : materials || validLinkCount > 0
        ? '基础资料'
        : '待补充'
  const collectedSourceCountLabel = Array.isArray(state.collectedSources)
    ? String(state.collectedSources.length)
    : Number.isFinite(state.collectedSourceCount)
      ? String(state.collectedSourceCount)
      : '未提供'
  return { label, validLinkCount, collectedSourceCountLabel }
}
