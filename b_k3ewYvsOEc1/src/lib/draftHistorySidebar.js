export const HISTORY_SIDEBAR_PREFERENCE_KEY = 'draftAssistant.historySidebarPreference'
export const HISTORY_SIDEBAR_PREFERENCES = ['auto', 'expanded', 'collapsed']

export function normalizeHistorySidebarPreference(value) {
  return HISTORY_SIDEBAR_PREFERENCES.includes(value) ? value : 'auto'
}

export function readHistorySidebarPreference(storage) {
  try {
    return normalizeHistorySidebarPreference(storage?.getItem(HISTORY_SIDEBAR_PREFERENCE_KEY))
  } catch {
    return 'auto'
  }
}

export function writeHistorySidebarPreference(storage, preference) {
  const normalized = normalizeHistorySidebarPreference(preference)
  try {
    storage?.setItem(HISTORY_SIDEBAR_PREFERENCE_KEY, normalized)
  } catch {
    // Storage is best-effort; the in-memory preference still applies.
  }
  return normalized
}

export function shouldAutoCollapseHistory({ currentStep = 1, draftStatus = 'idle', editorMode = '' } = {}) {
  if (draftStatus === 'failed') return false
  return Number(currentStep) >= 4
    || draftStatus === 'generated'
    || draftStatus === 'completed'
    || editorMode === 'confirm'
    || editorMode === 'edit'
}

export function resolveHistorySidebarCollapsed({
  preference = 'auto',
  currentStep = 1,
  draftStatus = 'idle',
  editorMode = '',
  manuallyChangedForCurrentEvent = false,
  currentCollapsed = false,
  eventChanged = false,
} = {}) {
  const normalized = normalizeHistorySidebarPreference(preference)
  if (normalized === 'expanded') return false
  if (normalized === 'collapsed') return true
  if (manuallyChangedForCurrentEvent && !eventChanged) return Boolean(currentCollapsed)
  if (shouldAutoCollapseHistory({ currentStep, draftStatus, editorMode })) return true
  return eventChanged ? false : Boolean(currentCollapsed)
}

export function historySidebarColumns(collapsed, rightPanelVisible = true) {
  if (rightPanelVisible) return collapsed ? '64px minmax(720px, 1fr) 270px' : '250px minmax(720px, 1fr) 270px'
  return collapsed ? '64px minmax(0, 1fr)' : '250px minmax(0, 1fr)'
}
