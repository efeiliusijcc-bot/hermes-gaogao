export const MANUAL_SECTIONS = Object.freeze([
  { id: 'report', title: 'AI智能体深度编报' },
  { id: 'qa', title: 'QA问答' },
  { id: 'daily', title: '每日动态感知' },
  { id: 'draft', title: '拟稿助手' },
])

const MANUAL_SECTION_IDS = new Set(MANUAL_SECTIONS.map((section) => section.id))

export function normalizeManualSection(value) {
  return MANUAL_SECTION_IDS.has(value) ? value : 'report'
}
