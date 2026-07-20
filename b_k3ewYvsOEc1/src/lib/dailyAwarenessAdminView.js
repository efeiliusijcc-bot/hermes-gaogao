const INBOX_STATUS_LABELS = {
  RECEIVED: { label: '即将开始', tone: 'neutral' },
  PROCESSING: { label: '正在生成', tone: 'info' },
  RETRY_PENDING: { label: '正在自动恢复', tone: 'warning' },
  DEAD_LETTER: { label: '需要人工处理', tone: 'danger' },
  PROCESSED: { label: '已解决', tone: 'success' },
}

function field(value, snakeKey, camelKey) {
  return value?.[snakeKey] ?? value?.[camelKey] ?? ''
}

function numberField(value, snakeKey, camelKey) {
  const number = Number(field(value, snakeKey, camelKey))
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function runTime(run) {
  return String(run?.finishedAt || run?.startedAt || run?.createdAt || '')
}

export function dailyAwarenessStatusLabel(value) {
  return INBOX_STATUS_LABELS[String(value || '').toUpperCase()]
    || { label: '状态未知', tone: 'neutral' }
}

export function dailyAwarenessIssueLabel(item = {}) {
  const status = String(item.status || '').toUpperCase()
  return {
    ...dailyAwarenessStatusLabel(status),
    action: status === 'DEAD_LETTER' ? 'reprocess' : 'inspect',
  }
}

export function buildTodaySummary(status = {}) {
  const generationStatus = String(field(status, 'generation_status', 'generationStatus') || 'WAITING').toUpperCase()
  const dataStatus = String(field(status, 'data_status', 'dataStatus') || 'WAITING').toUpperCase()
  const base = {
    businessDate: String(field(status, 'business_date', 'businessDate')),
    sourceBusinessDate: String(field(status, 'source_business_date', 'sourceBusinessDate')),
    selectedCount: numberField(status, 'selected_count', 'selectedCount'),
    generatedAt: String(field(status, 'generated_at', 'generatedAt')),
  }

  if (generationStatus === 'SUCCESS') {
    return {
      label: '今日简报已生成',
      description: '生成完成后，普通用户即可查看。',
      tone: 'success',
      ...base,
      action: 'view',
    }
  }
  if (generationStatus === 'GENERATING') {
    return {
      label: '正在生成',
      description: '系统正在筛选热点消息，请稍后刷新。',
      tone: 'info',
      ...base,
      action: 'refresh',
    }
  }
  if (generationStatus === 'NOT_REQUIRED' || dataStatus === 'NO_DATA') {
    return {
      label: '昨日暂无可用数据',
      description: '系统已完成检查，今天无需生成简报。',
      tone: 'neutral',
      ...base,
      action: 'refresh',
    }
  }
  if (generationStatus === 'GENERATION_FAILED') {
    return {
      label: '今日简报未完成',
      description: '系统未能自动完成，请查看处理办法。',
      tone: 'danger',
      ...base,
      action: 'issues',
    }
  }
  return {
    label: '等待开始',
    description: '系统将在数据准备完成后自动生成。',
    tone: 'neutral',
    ...base,
    action: 'refresh',
  }
}

export function mergeDailyAwarenessHistory(runs = [], historyItems = []) {
  const byDate = new Map()
  const ensure = (businessDate) => {
    const date = String(businessDate || '')
    if (!date) return null
    if (!byDate.has(date)) byDate.set(date, { businessDate: date, runs: [], brief: null })
    return byDate.get(date)
  }

  for (const run of Array.isArray(runs) ? runs : []) {
    const group = ensure(run?.businessDate)
    if (group) group.runs.push(run)
  }
  for (const brief of Array.isArray(historyItems) ? historyItems : []) {
    const group = ensure(brief?.businessDate)
    if (group) group.brief = brief
  }

  return [...byDate.values()]
    .sort((left, right) => right.businessDate.localeCompare(left.businessDate))
    .map((group) => {
      group.runs.sort((left, right) => runTime(right).localeCompare(runTime(left)))
      const latestRun = group.runs[0] || null
      const brief = group.brief
      if (brief) {
        const regenerated = ['INBOX_REPROCESS', 'MANUAL', 'AUTO_RETRY'].includes(String(latestRun?.triggerType || ''))
          || String(brief.generatedByType || '') === 'MANUAL'
        return {
          businessDate: group.businessDate,
          resultLabel: regenerated ? '补生成成功' : '生成成功',
          tone: 'success',
          sourceBusinessDate: String(brief.sourceBusinessDate || latestRun?.sourceBusinessDate || ''),
          selectedCount: Number(brief.selectedCount || 0),
          completedAt: String(brief.generatedAt || latestRun?.finishedAt || ''),
          action: 'view',
          latestRun,
          runs: group.runs,
          brief,
        }
      }

      const status = String(latestRun?.status || '').toUpperCase()
      if (status === 'NO_DATA') {
        return {
          businessDate: group.businessDate,
          resultLabel: '暂无数据',
          tone: 'neutral',
          sourceBusinessDate: String(latestRun?.sourceBusinessDate || ''),
          selectedCount: 0,
          completedAt: runTime(latestRun),
          action: 'inspect',
          latestRun,
          runs: group.runs,
          brief: null,
        }
      }
      if (status === 'RUNNING' || status === 'QUEUED') {
        return {
          businessDate: group.businessDate,
          resultLabel: '正在生成',
          tone: 'info',
          sourceBusinessDate: String(latestRun?.sourceBusinessDate || ''),
          selectedCount: 0,
          completedAt: runTime(latestRun),
          action: 'inspect',
          latestRun,
          runs: group.runs,
          brief: null,
        }
      }
      return {
        businessDate: group.businessDate,
        resultLabel: '未生成',
        tone: 'danger',
        sourceBusinessDate: String(latestRun?.sourceBusinessDate || ''),
        selectedCount: 0,
        completedAt: runTime(latestRun),
        action: 'regenerate',
        latestRun,
        runs: group.runs,
        brief: null,
      }
    })
}
