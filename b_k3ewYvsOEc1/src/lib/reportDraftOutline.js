function text(value) {
  return String(value ?? '').trim()
}

function normalizeTextItems(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object') return ''
      const label = text(item.label || item.title || item.name)
      const detail = text(item.detail || item.summary || item.description || item.content)
      return label && detail && label !== detail ? `${label}：${detail}` : label || detail
    })
    .filter(Boolean)
}

function normalizeOutlineItems(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => ({
      title: text(item?.title),
      summary: text(item?.summary),
      children: Array.isArray(item?.children)
        ? item.children
          .map((child) => ({ title: text(child?.title), summary: text(child?.summary) }))
          .filter((child) => child.title || child.summary)
        : [],
    }))
    .filter((item) => item.title || item.summary || item.children.length)
}

export function isDraftAssistantReportJob(job) {
  return Boolean(text(job?.outlineId))
}

export function normalizeReportDraftOutline(response) {
  const outline = response?.outline && typeof response.outline === 'object' ? response.outline : {}
  const outlineItems = normalizeOutlineItems(outline.outlineItems)
  const reportTitle = text(outline.reportTitle || response?.title)
  return {
    available: Boolean(reportTitle || outlineItems.length),
    outlineId: text(response?.outlineId),
    versionNo: Number(response?.versionNo) || 0,
    editType: text(response?.editType),
    createdAt: text(response?.createdAt),
    reportTitle,
    reportTheme: text(outline.reportTheme),
    coreArgument: text(outline.coreArgument || outline.coreJudgement),
    outlineItems,
    writingFocus: normalizeTextItems(outline.writingFocus || outline.writingConstraints),
    sourceRequirements: normalizeTextItems(outline.sourceRequirements),
    uncertaintiesToVerify: normalizeTextItems(outline.uncertaintiesToVerify),
  }
}
