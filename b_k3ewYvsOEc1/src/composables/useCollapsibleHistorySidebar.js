import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  readHistorySidebarPreference,
  resolveHistorySidebarCollapsed,
  writeHistorySidebarPreference,
} from '../lib/draftHistorySidebar.js'

export function useCollapsibleHistorySidebar({
  currentEventId,
  currentStep,
  draftStatus,
  editorMode,
  searchFocused,
  sidebarComponentRef,
  autoCollapseTargetRef,
}) {
  const storage = typeof window !== 'undefined' ? window.localStorage : null
  const preference = ref(readHistorySidebarPreference(storage))
  const collapsed = ref(preference.value === 'collapsed')
  const manuallyChangedForCurrentEvent = ref(false)
  const autoCollapseNoticeVisible = ref(false)
  const notifiedEvents = new Set()
  let noticeTimer = null
  let previousEventId = ''

  function showAutoCollapseNotice(eventId) {
    const key = String(eventId || 'new-event')
    if (notifiedEvents.has(key)) return
    notifiedEvents.add(key)
    autoCollapseNoticeVisible.value = true
    if (noticeTimer) window.clearTimeout(noticeTimer)
    noticeTimer = window.setTimeout(() => { autoCollapseNoticeVisible.value = false }, 3000)
  }

  async function applyState() {
    const eventId = String(currentEventId.value || '')
    const eventChanged = eventId !== previousEventId
    if (eventChanged) manuallyChangedForCurrentEvent.value = false
    const wasCollapsed = collapsed.value
    const nextCollapsed = resolveHistorySidebarCollapsed({
      preference: preference.value,
      currentStep: currentStep.value,
      draftStatus: draftStatus.value,
      editorMode: editorMode.value,
      manuallyChangedForCurrentEvent: manuallyChangedForCurrentEvent.value,
      currentCollapsed: collapsed.value,
      eventChanged,
    })
    collapsed.value = searchFocused?.value && nextCollapsed && !collapsed.value ? false : nextCollapsed
    previousEventId = eventId
    if (!wasCollapsed && collapsed.value && preference.value === 'auto') showAutoCollapseNotice(eventId)
    if (!wasCollapsed && collapsed.value && preference.value === 'auto') {
      const sidebarRoot = sidebarComponentRef?.value?.root
      const focusWasInSidebar = sidebarRoot?.contains(document.activeElement)
      await nextTick()
      if (focusWasInSidebar) {
        sidebarComponentRef?.value?.toggleButton?.focus({ preventScroll: true })
      } else {
        autoCollapseTargetRef?.value?.focus({ preventScroll: true })
      }
    }
  }

  function setPreference(value) {
    preference.value = writeHistorySidebarPreference(storage, value)
    manuallyChangedForCurrentEvent.value = true
    collapsed.value = preference.value === 'collapsed'
    autoCollapseNoticeVisible.value = false
  }

  function toggle() {
    setPreference(collapsed.value ? 'expanded' : 'collapsed')
  }

  function expand() {
    setPreference('expanded')
  }

  function collapse() {
    setPreference('collapsed')
  }

  function useAutomaticPreference() {
    preference.value = writeHistorySidebarPreference(storage, 'auto')
    manuallyChangedForCurrentEvent.value = false
    void applyState()
  }

  watch([currentEventId, currentStep, draftStatus, editorMode, searchFocused], () => { void applyState() }, { immediate: true })

  onBeforeUnmount(() => {
    if (noticeTimer) window.clearTimeout(noticeTimer)
  })

  return {
    collapsed,
    preference,
    manuallyChangedForCurrentEvent,
    autoCollapseNoticeVisible,
    toggle,
    expand,
    collapse,
    useAutomaticPreference,
  }
}
