function cleanTitleLine(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function extractHttpUrls(value) {
  const matches = String(value || '').match(/https?:\/\/[^\s<>'"，。；]+/gi) || []
  return Array.from(new Set(matches.map((item) => {
    try {
      return new URL(item).toString()
    } catch {
      return ''
    }
  }).filter(Boolean)))
}

function readableValue(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join('\n')
  if (typeof value !== 'object') return String(value).trim()

  if ('risks' in value || 'pendingVerifications' in value) {
    return [
      readableValue(value.summary),
      readableValue(value.risks),
      readableValue(value.pendingVerifications),
    ].filter(Boolean).join('\n')
  }

  if ('riskType' in value || 'riskLevel' in value) {
    return [
      readableValue(value.title || value.riskType),
      readableValue(value.description),
      readableValue(value.basis),
      readableValue(value.uncertainty),
    ].filter(Boolean).join('；')
  }

  const preferred = [
    value.summary,
    value.content,
    value.text,
    value.fact,
    value.name,
    value.actor,
    value.title,
    value.event,
    value.location,
  ].map(readableValue).filter(Boolean)
  const time = readableValue(value.time || value.date || value.occurredAt)
  if (time && preferred.length) return `${time} ${preferred[0]}`.trim()
  return preferred[0] || ''
}

function firstReadable(...values) {
  for (const value of values) {
    const readable = readableValue(value)
    if (readable) return readable
  }
  return '暂无明确内容'
}

function firstReadableOr(fallback, ...values) {
  const content = firstReadable(...values)
  return content === '暂无明确内容' ? fallback : content
}

export function buildDraftAnalyzePayload(sourceInput) {
  const materials = String(sourceInput || '').trim()
  if (!materials) throw new Error('请输入编报主体和相关材料')
  const firstLine = materials.split(/\r?\n/).map(cleanTitleLine).find(Boolean)
  return {
    title: firstLine || '未命名编报',
    materials,
    links: extractHttpUrls(materials),
    category: '',
    region: '',
  }
}

export function buildDraftAnalysisSections(eventResult = {}) {
  const analysis = eventResult.analysis || eventResult.event?.analysis || {}
  const event = eventResult.event || {}
  const timeline = firstReadable(analysis.timeAndPlace, analysis.timelineSummary, analysis.timeline, event.timeline)
  const location = firstReadable(analysis.location, event.region)
  const timeAndPlace = [timeline, location]
    .filter((value, index, items) => value !== '暂无明确内容' && items.indexOf(value) === index)
    .join('\n') || '事件发生时间、关键节点及具体地点尚待权威信源核实。'

  return [
    {
      key: 'summary',
      title: '事件概括',
      content: firstReadableOr('当前材料不足以形成明确事件概括，需补充权威信源核实。', analysis.oneSentenceSummary, analysis.summary, event.summary),
    },
    {
      key: 'actors',
      title: '核心主体',
      content: firstReadableOr('当前材料未明确列出可核实的核心主体，相关国家、机构及当事方身份待核实。', analysis.keyActors, analysis.coreActors, analysis.actors, event.actors),
    },
    {
      key: 'timeAndPlace',
      title: '时间与地点',
      content: timeAndPlace,
    },
    {
      key: 'facts',
      title: '关键事实',
      content: firstReadableOr('当前材料未提供可直接确认的关键事实，具体进展、政策安排及影响待核实。', analysis.mainFacts, event.basicFacts),
    },
    {
      key: 'risk',
      title: '涉我风险',
      content: firstReadableOr('当前材料不足以形成明确涉我风险结论，相关影响待研判。', analysis.riskSummary, analysis.riskToUs, analysis.risks),
    },
  ]
}

export function filterDraftHistory(events = [], query = '') {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return events
  return events.filter((item) => {
    return `${item?.title || ''} ${item?.summary || ''}`.toLowerCase().includes(needle)
  })
}

export function restoredDraftStage(eventResult = {}) {
  return eventResult.latestOutline?.outlineId ? 'outline' : 'analysis'
}

export function resetDraftScroll(container) {
  if (container) container.scrollTop = 0
}
