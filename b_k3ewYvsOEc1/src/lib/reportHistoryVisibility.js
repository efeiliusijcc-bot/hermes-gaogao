export function isReportHistoryVisible(env) {
  return env?.VITE_REPORT_HISTORY_VISIBLE === 'true'
}

export const REPORT_HISTORY_VISIBLE = isReportHistoryVisible(import.meta.env)
