import { timelineStageKey } from './reportTechnicalTimeline.js'

const STAGE_CODES = {
  plan: 'CONNECTING',
  database: 'PG_RECALL',
  research: 'RESEARCHING',
  deep_collection: 'DEEP_COLLECTION',
  consolidate: 'CONSOLIDATE',
  report: 'WRITING',
  quality: 'QUALITY_REVIEW',
}

const PHASE_VIEWS = {
  start: ['CONNECTING', '任务规划', '系统正在整理编报要求、确定信源范围并拆解调研任务。'],
  running: ['TASK_START', '任务规划', '系统正在整理编报要求、确定信源范围并拆解调研任务。'],
  database_sources: ['PG_RECALL', '数据库检索', '数据库信源检索已完成。'],
  context_preparing: ['PREPARING', '任务规划', '系统正在整理编报要求、确定信源范围并拆解调研任务。'],
  research_planning: ['PLANNING', '任务规划', '系统正在生成调研计划并拆解任务。'],
  research_dispatch: ['RESEARCH_TASK', '资料采集', '系统正在启动资料调研任务。'],
  research_waiting: ['WAITING_RESEARCH', '资料采集', '系统正在等待资料调研完成。'],
  research_collecting: ['RESEARCHING', '资料采集', '系统正在采集公开资料并提取关键事实。'],
  research_consolidating: ['CONSOLIDATE', '素材整合', '系统正在合并调研证据和分析要点。'],
  deep_source_collection: ['DEEP_COLLECTION', '资料深度采集', '系统正在补充并核验公开资料。'],
  deep_source_collection_done: ['DEEP_COLLECTION_DONE', '资料深度采集', '深度资料采集与核验已完成。'],
  deep_source_collection_failed: ['DEEP_COLLECTION_FAILED', '资料深度采集', '深度资料采集出现异常。'],
  synthesis_dispatch: ['SYNTHESIS_TASK', '素材整合', '系统正在启动素材整合和撰稿任务。'],
  synthesis_waiting: ['WAITING_SYNTHESIS', '素材整合', '系统正在等待素材整合任务完成。'],
  synthesis_writing: ['WRITING', '报告撰写', '系统正在撰写报告正文并完成校验。'],
  report_verifying: ['VERIFYING', '报告撰写', '系统正在校验报告结构和内容。'],
  report_saving: ['SAVING', '报告撰写', '系统正在保存报告文件。'],
  waiting_final_report: ['WRITING', '等待报告成稿', '编报智能体正在完成报告正文并等待成稿文件确认。'],
  received: ['SAVING', '报告成稿已接收', '最终报告文件已返回并完成确认。'],
  quality_review: ['QUALITY_REVIEW', '成稿自检', '系统正在检查主题一致性、信源依据、风险推理和写作质量。'],
  quality_review_done: ['QUALITY_REVIEW_DONE', '成稿自检', '成稿自检已完成，可查看评分和建议。'],
  quality_review_failed: ['QUALITY_REVIEW_FAILED', '成稿自检', '成稿自检出现异常，可稍后重试。'],
  approval_required: ['DETAIL', '等待工具授权', '编报智能体正在等待必要的工具授权。'],
  execution_log_unavailable: ['DETAIL', '执行记录降级', '执行记录通道暂不可用，编报任务仍在继续。'],
  hermes_run_completed: ['SAVING', '整理报告产物', '编报智能体已完成核心执行，正在整理报告产物。'],
  hermes_run_cancelled: ['ERROR', '编报任务已取消', '编报智能体执行已取消。'],
  done: ['COMPLETED', '编报任务已完成', '报告已生成，可以查看或导出。'],
  error: ['ERROR', '任务执行出现异常', '系统执行过程中出现异常，请查看技术详情或重试。'],
}

function classifyToolDisplayName(rawValue) {
  const raw = String(rawValue || '').toLowerCase()
  if (!raw.trim()) return ''
  if (
    /pg-sources__query|mysql-test__mysql_query|database_sources\.json|database_query_plan\.json|vector_sources\.json/.test(raw) ||
    /\b(pg|postgres|postgresql|mysql|sql|vector|embedding|database|db)\b/.test(raw) ||
    /数据库|向量|召回/.test(raw)
  ) return '数据库检索工具'
  if (
    /\b(exa|firecrawl|tavily|internet|search|crawl|scrape|browser)\b|web[_\s-]?(search|fetch|crawl|scrape)|search\.mjs|extract\.mjs/.test(raw) ||
    /互联网|联网|搜索|抓取/.test(raw)
  ) return '互联网搜索工具'
  return '本地脚本工具'
}

export function logToolDisplayName(log) {
  if (log?.type === 'stage' || log?.type === 'done' || log?.type === 'error') return '系统进度'
  const explicit = log?.toolDisplayName || log?.toolName
  const raw = [log?.label, log?.summary, log?.command, log?.detail].filter(Boolean).join('\n')
  return classifyToolDisplayName(explicit) || classifyToolDisplayName(raw)
}

export function sanitizeReportExecutionText(value) {
  const text = String(value || '')
  if (/content_filter|considered high risk|safety policy|高风险/i.test(text)) {
    return '本次主题触发模型安全策略，生成内容被拦截，未形成有效报告。请调整表述或降低敏感措辞后重试。'
  }
  return text
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [已隐藏]')
    .replace(/\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*[^\s,;]+/gi, '[已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[已隐藏]')
    .replace(/\/(?:opt\/data|app\/storage|home\/[^/]+|usr\/docker\/hermes)(?:\/[^\s]*)?/gi, '.../[路径已隐藏]')
    .replace(/\b(?:exa|firecrawl|tavily|web[_\s-]?(?:search|fetch|crawl|scrape)|search\.mjs|extract\.mjs)\b/gi, '互联网搜索工具')
    .replace(/Hermes\s+Gateway/gi, '任务通道')
    .replace(/Hermes\s+report-agent/gi, '编报智能体')
    .replace(/Hermes/gi, '自主智能体')
    .replace(/\breport-agent\b/gi, '编报智能体')
    .replace(/\bGateway\b/gi, '任务通道')
    .replace(/returned too little report content\.?/gi, '生成内容不足，未达到编报成稿要求。')
    .trim()
}

function rawLogText(log) {
  return [logToolDisplayName(log), log?.label, log?.summary, log?.command, log?.detail]
    .filter(Boolean)
    .join('\n')
}

function extractQuery(rawLog) {
  const quoted = rawLog.match(/--query\s+["']([^"']+)["']/i)
  if (quoted?.[1]) return quoted[1].trim()
  const plain = rawLog.match(/--query\s+([^\n\r]+)/i)
  return plain?.[1]?.replace(/\s+--\S+.*$/, '').trim() || ''
}

function readableStatus(log) {
  const status = String(log?.status || '').toLowerCase()
  const phase = String(log?.phase || status).toLowerCase()
  if (status === 'failed' || status === 'error' || log?.type === 'tool_error' || log?.type === 'error' || /(?:^|_)failed$|cancelled/.test(phase)) return 'error'
  if (
    status === 'completed' ||
    status === 'succeeded' ||
    status === 'done' ||
    log?.type === 'done' ||
    phase === 'received' ||
    phase === 'database_sources' ||
    phase === 'hermes_run_completed' ||
    /_done$/.test(phase)
  ) return 'done'
  return 'running'
}

function readableDuration(log) {
  const text = [log?.durationLabel, log?.detail, log?.summary].filter(Boolean).join(' ')
  const match = text.match(/耗时\s*([0-9]+(?:\.[0-9]+)?\s*(?:毫秒|秒|分钟|分|小时))/)
  return match?.[1] || ''
}

export function translateHermesExecutionLog(log) {
  const toolDisplayName = logToolDisplayName(log)
  const rawLog = rawLogText(log)
  const classificationText = [log?.toolName, log?.toolId, log?.label, log?.summary, log?.command, log?.detail]
    .filter(Boolean)
    .join('\n')
  const lower = classificationText.toLowerCase()
  const status = readableStatus(log)
  const base = {
    time: log?.time || '',
    stage: 'RUNNING',
    title: '正在推进编报任务',
    description: '系统正在执行当前编报步骤。',
    raw: sanitizeReportExecutionText(rawLog),
    status,
    toolDisplayName,
    durationLabel: readableDuration(log),
  }

  if (status === 'error' || /\b(error|failed|timed out|timeout exceeded)\b|超时/.test(lower)) {
    return { ...base, stage: 'ERROR', title: '任务执行出现异常', description: '系统执行过程中出现异常，请查看技术详情或重试。', status: 'error' }
  }
  if (/pg-sources__query|pg_sources__query|pg hybrid sources recalled|vector_sources\.json|database_sources(?:\.json|$)|database_query_plan\.json|pgvector|数据库|向量信源/.test(lower) || String(log?.phase || '').toLowerCase() === 'database_sources') {
    const recalledCount = String(log?.summary || '').match(/recalled:\s*(\d+)\s+items?/i)?.[1]
    return {
      ...base,
      stage: 'PG_RECALL',
      title: '数据库检索',
      description: status === 'done'
        ? recalledCount
          ? `数据库检索已完成，召回 ${recalledCount} 条候选信源。`
          : 'PG 向量库和数据库信源检索已完成。'
        : '系统正在优先召回 PG 向量库和数据库信源。',
    }
  }
  if (/deep_source_collection|深度资料采集/.test(lower)) {
    return { ...base, stage: status === 'done' ? 'DEEP_COLLECTION_DONE' : 'DEEP_COLLECTION', title: '资料深度采集', description: status === 'done' ? '深度资料采集与核验已完成。' : '系统正在补充并核验公开资料。' }
  }
  if (/sessions_spawn.*(?:research|调研)|research-group|research_agent/.test(lower)) {
    return { ...base, stage: 'RESEARCHING', title: '调研子任务', description: status === 'done' ? '调研子任务已完成，资料已返回。' : '系统正在启动资料调研子任务。' }
  }
  if (/web[_-]?(?:fetch|crawl|scrape)|extract\.mjs|资料提取|正文提取/.test(lower)) {
    return { ...base, stage: 'EXTRACTING', title: status === 'done' ? '资料提取已完成' : '正在提取资料正文', description: status === 'done' ? '重点来源内容已提取完成。' : '系统正在读取重点来源内容，提取可用于编报的事实材料。' }
  }
  if (/quality_review|成稿自检/.test(lower)) {
    return { ...base, stage: 'QUALITY_REVIEW', title: '成稿自检', description: status === 'done' ? '成稿自检已完成，可查看评分和建议。' : '系统正在检查成稿质量并生成建议。' }
  }
  if (/validate_report|report_file|report\.md|报告文件|report_saving|report_verifying|synthesis_writing/.test(lower)) {
    return { ...base, stage: status === 'done' ? 'SAVING' : 'WRITING', title: '报告撰写', description: status === 'done' ? '报告正文已生成并保存。' : '系统正在撰写报告正文并完成校验。' }
  }
  if (/consolidated\.json|research_consolidating|synthesis|素材整合|证据包/.test(lower)) {
    return { ...base, stage: 'CONSOLIDATE', title: '素材整合', description: status === 'done' ? '信源、证据和分析要点已完成整合。' : '系统正在汇总信源、证据和分析要点。' }
  }
  if (/web[_-]?search|search\.mjs|tavily|firecrawl|exa|research_|research_collecting|research_dispatch|sessions_spawn|sessions_yield|公开资料|资料调研|检索/.test(lower)) {
    const query = extractQuery(rawLog)
    return { ...base, stage: /extract|crawl|scrape/.test(lower) ? 'EXTRACTING' : 'SEARCHING', title: status === 'done' ? '资料采集已完成' : '正在检索相关资料', description: query ? `检索主题：${sanitizeReportExecutionText(query)}` : status === 'done' ? '公开资料检索与提取已完成。' : '系统正在检索与当前主题相关的公开资料、新闻和政策信息。' }
  }
  if (/harness_cli\.py\s+plan|plan\.json|context\.json|planning|planner|decomposition|任务规划/.test(lower)) {
    return { ...base, stage: 'PLANNING', title: '任务规划', description: status === 'done' ? '编报要求和调研计划已整理完成。' : '系统正在整理编报要求、确定信源范围并拆解调研任务。' }
  }

  const phaseView = PHASE_VIEWS[String(log?.phase || log?.status || '').toLowerCase()]
  if (phaseView) return { ...base, stage: phaseView[0], title: phaseView[1], description: phaseView[2] }
  if (lower.includes('succeeded')) return { ...base, stage: 'COMPLETED', title: '编报任务已完成', description: '报告已生成，可查看或导出。', status: 'done' }
  return base
}

function normalizedStageStatus(status) {
  const value = String(status || '').toLowerCase()
  if (value === 'done' || value === 'completed' || value === 'succeeded') return 'done'
  if (value === 'current' || value === 'running' || value === 'started') return 'running'
  if (value === 'error' || value === 'failed') return 'error'
  return 'waiting'
}

function dedupeLifecycleLogs(logs) {
  const result = []
  const latestByKey = new Map()

  for (const log of logs) {
    if (log?.type !== 'stage' && log?.type !== 'done') {
      result.push(log)
      continue
    }
    const key = [log.title, log.description, log.status].join('|')
    const occurredAt = new Date(log.occurredAt || log.time || '').getTime()
    const previous = latestByKey.get(key)
    if (previous && Number.isFinite(occurredAt) && Math.abs(occurredAt - previous.occurredAt) <= 1000) continue
    latestByKey.set(key, { occurredAt })
    result.push(log)
  }

  return result
}

export function buildReadableExecutionLogs({ stages = [], logs = [] } = {}) {
  const covered = new Set(logs.map((log) => timelineStageKey(log)).filter((key) => key !== 'other'))
  const reconstructed = []

  for (const stage of stages) {
    const status = normalizedStageStatus(stage?.status)
    if (!stage?.key || status === 'waiting' || covered.has(stage.key)) continue
    const evidence = Array.isArray(stage.evidence)
      ? stage.evidence.filter((item) => item && item.source !== 'job_status')
      : []
    const latestEvidence = evidence.at(-1) || null
    const occurredAt = String(latestEvidence?.time || '')
    const description = latestEvidence?.message
      ? sanitizeReportExecutionText(latestEvidence.message)
      : status === 'done'
        ? '该阶段已完成，详细执行事件未保存。'
        : status === 'error'
          ? '该阶段出现异常，详细执行事件未保存。'
          : stage.desc || '该阶段正在执行，详细执行事件尚未保存。'
    reconstructed.push({
      id: `reconstructed-${stage.key}`,
      stage: STAGE_CODES[stage.key] || String(stage.key).toUpperCase(),
      phase: stage.key,
      title: status === 'done' ? `${stage.title}已完成` : status === 'error' ? `${stage.title}出现异常` : `${stage.title}进行中`,
      description,
      summary: description,
      status,
      occurredAt,
      time: occurredAt,
      actor: 'system',
      reconstructed: true,
      raw: '',
    })
  }

  return [...dedupeLifecycleLogs(logs), ...reconstructed]
}
