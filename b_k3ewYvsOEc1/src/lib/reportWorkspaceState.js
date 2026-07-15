export function isUnfinishedReportJob(item) {
  return item?.status === 'queued' || item?.status === 'running'
}

export function resolveActiveWorkspaceJob(snapshot, visibleJob, openedHistoryJobId) {
  const snapshotJob = snapshot?.job
  if (snapshotJob?.jobId) return snapshotJob
  if (openedHistoryJobId) return null
  return isUnfinishedReportJob(visibleJob) ? visibleJob : null
}

export function upsertReportJob(list, item, { promote } = {}) {
  const source = Array.isArray(list) ? list : []
  if (!item?.jobId) return source

  const index = source.findIndex((entry) => entry?.jobId === item.jobId)
  if (index < 0) return [item, ...source]
  if (promote) return [item, ...source.slice(0, index), ...source.slice(index + 1)]
  return [...source.slice(0, index), item, ...source.slice(index + 1)]
}

export function includeOpenedHistoryJob(recentJobs, openedHistoryJobId, visibleJob) {
  const source = Array.isArray(recentJobs) ? recentJobs : []
  if (!openedHistoryJobId || visibleJob?.jobId !== openedHistoryJobId) return source
  if (source.some((item) => item?.jobId === openedHistoryJobId)) return source
  return [visibleJob, ...source]
}
