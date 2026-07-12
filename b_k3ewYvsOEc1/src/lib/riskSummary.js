const LEVEL_LABELS = {
  high: '高风险',
  medium: '中等风险',
  low: '较低风险',
  unknown: '待评估',
}

const SOURCE_STATUS_VALUES = new Set(['verified', 'partially_verified', 'unverified'])

export function mapRiskLevel(value) {
  const text = String(value || '').trim().toLowerCase()
  if (/^(high|高|高风险|严重|critical|severe)$/.test(text)) return riskLevel('high')
  if (/^(medium|moderate|中|中等|中风险|中等风险)$/.test(text)) return riskLevel('medium')
  if (/^(low|低|低风险|较低|较低风险)$/.test(text)) return riskLevel('low')
  return riskLevel('unknown')
}

export function normalizeRiskSummary(input) {
  return normalizeRiskValue(input, 0)
}

export function riskSummaryTitle(context = {}) {
  const subject = firstText(
    context.viewpointSubject,
    context.concernSubject,
    context.targetSubject,
    context.analysis?.viewpointSubject,
    context.analysis?.concernSubject,
    context.analysis?.targetSubject,
    context.event?.viewpointSubject,
    context.event?.concernSubject,
    context.event?.targetSubject,
  )
  return subject ? `对「${subject}」的潜在影响` : '风险研判'
}

function normalizeRiskValue(input, parseAttempts) {
  if (input == null || input === '') return emptySummary()
  if (Array.isArray(input)) return summaryFromItems(input)

  if (typeof input === 'string') {
    const text = stripJsonFence(input).trim()
    if (!text) return emptySummary()
    const parsed = tryParseRiskJson(text, parseAttempts)
    if (parsed.ok) return normalizeRiskValue(parsed.value, parsed.attempts)
    if (looksLikeStructuredRisk(text)) {
      return {
        ...emptySummary(),
        sourceStatus: 'unverified',
        note: 'parse_failed',
      }
    }
    return summaryFromItems([{ description: text, riskLevel: 'unknown', riskType: '风险线索' }])
  }

  if (typeof input === 'object') {
    const raw = input || {}
    const nested = raw.items ?? raw.risks ?? raw.riskSummary
    if (nested !== undefined) {
      const normalized = normalizeRiskValue(nested, parseAttempts)
      return completeSummary({
        ...normalized,
        pendingVerifications: cleanList(raw.pendingVerifications).length
          ? cleanList(raw.pendingVerifications)
          : normalized.pendingVerifications,
        sourceStatus: normalizeSourceStatus(raw.sourceStatus) || normalized.sourceStatus,
        overallLevel: normalizeOverall(raw.overallLevel) || normalized.overallLevel,
        overallLevelLabel: normalizeOverall(raw.overallLevel)
          ? LEVEL_LABELS[normalizeOverall(raw.overallLevel)]
          : normalized.overallLevelLabel,
      })
    }
    if (isRiskLikeObject(raw)) return summaryFromItems([raw])
  }

  return emptySummary()
}

function tryParseRiskJson(text, parseAttempts) {
  if (parseAttempts >= 2) return { ok: false, attempts: parseAttempts }
  try {
    return {
      ok: true,
      value: JSON.parse(text),
      attempts: parseAttempts + 1,
    }
  } catch (error) {
    return { ok: false, attempts: parseAttempts }
  }
}

function summaryFromItems(items) {
  const normalizedItems = items
    .map((item, index) => normalizeRiskItem(item, index))
    .filter((item) => item.description || item.basis || item.uncertainty || item.title || item.riskType)
  return completeSummary({
    items: normalizedItems,
    sourceStatus: 'unverified',
  })
}

function normalizeRiskItem(item, index) {
  if (typeof item === 'string') {
    const level = mapRiskLevel('unknown')
    return {
      id: `risk-${index + 1}`,
      riskType: '风险线索',
      riskLevel: level.value,
      riskLevelLabel: level.label,
      description: item.trim(),
    }
  }

  const raw = item && typeof item === 'object' ? item : {}
  const level = mapRiskLevel(raw.riskLevel ?? raw.level ?? raw.severity)
  const riskType = firstText(raw.riskType, raw.type, raw.category, raw.name, '风险研判')
  const title = firstText(raw.title, raw.riskTitle)
  return {
    id: firstText(raw.id, raw.riskId, `risk-${index + 1}`),
    riskType,
    riskLevel: level.value,
    riskLevelLabel: level.label,
    title,
    description: firstText(raw.description, raw.summary, raw.content, raw.riskDescription),
    basis: firstText(raw.basis, raw.evidence, raw.reason, raw.reasoning),
    uncertainty: firstText(raw.uncertainty, raw.uncertainties, raw.pendingVerification),
    confidence: numberOrUndefined(raw.confidence),
  }
}

function completeSummary(summary) {
  const hasExplicitOverall = summary.overallLevel !== undefined && summary.overallLevel !== null && summary.overallLevel !== ''
  const overallLevel = hasExplicitOverall ? normalizeOverall(summary.overallLevel) : deriveOverall(summary.items)
  const pendingVerifications = cleanList(summary.pendingVerifications).length
    ? cleanList(summary.pendingVerifications)
    : extractPendingVerifications(summary.items)
  return {
    overallLevel,
    overallLevelLabel: LEVEL_LABELS[overallLevel],
    items: summary.items || [],
    pendingVerifications,
    sourceStatus: normalizeSourceStatus(summary.sourceStatus) || 'unverified',
    ...(summary.note ? { note: summary.note } : {}),
  }
}

function deriveOverall(items = []) {
  const levels = items.map((item) => item.riskLevel)
  if (levels.includes('high')) return 'high'
  if (levels.includes('medium')) return 'medium'
  if (levels.includes('low')) return 'low'
  return 'unknown'
}

function extractPendingVerifications(items = []) {
  return unique(
    items
      .flatMap((item) => splitVerificationText(item.uncertainty))
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function splitVerificationText(value) {
  const text = firstText(value)
  if (!text) return []
  return text
    .split(/\n|[；;]|(?:^|\s)\d+[.、]/)
    .map((item) => item.replace(/^[-•·]\s*/, '').trim())
    .filter(Boolean)
}

function cleanList(value) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? splitVerificationText(value) : []
  return unique(items.map((item) => firstText(item)).filter(Boolean))
}

function normalizeOverall(value) {
  const level = mapRiskLevel(value).value
  return level === 'unknown' && value ? 'unknown' : level
}

function normalizeSourceStatus(value) {
  const text = String(value || '').trim()
  return SOURCE_STATUS_VALUES.has(text) ? text : ''
}

function riskLevel(value) {
  return {
    value,
    label: LEVEL_LABELS[value],
  }
}

function stripJsonFence(value) {
  return String(value || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
}

function looksLikeStructuredRisk(text) {
  return /^[\[{]/.test(text) || /"?(riskType|riskLevel|description|basis|uncertainty|risks|riskSummary)"?\s*:/.test(text)
}

function isRiskLikeObject(value) {
  return ['riskType', 'riskLevel', 'description', 'basis', 'uncertainty', 'title', 'summary'].some((key) => key in value)
}

function numberOrUndefined(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function unique(items) {
  return [...new Set(items)]
}

function emptySummary() {
  return {
    overallLevel: 'unknown',
    overallLevelLabel: LEVEL_LABELS.unknown,
    items: [],
    pendingVerifications: [],
    sourceStatus: 'unverified',
  }
}
