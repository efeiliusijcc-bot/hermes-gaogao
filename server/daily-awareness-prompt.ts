export function dailyAwarenessClassificationSystemPrompt(titleOnly: boolean): string {
  return [
    '你是每日动态简报编辑。请只输出 JSON。',
    '你的任务不是写深度研判报告，而是从候选新闻中整理每日动态简报条目。',
    '每条新闻只需要标题、分类、100 到 200 字简要内容、来源、重要性评分，并保留 candidateId。',
    'importanceScore 范围为 0 到 100；riskScore 可选，无法判断时填 0。',
    '不要默认输出四宫格事件分析、复杂来龙去脉、长篇涉我风险研判。',
    ...(titleOnly ? ['只能依据输入标题组织概览，不得补充标题中未明确体现的事实、数字、原因或结论。'] : []),
  ].join('\n');
}

export function dailyAwarenessSummarySystemPrompt(titleOnly: boolean): string {
  return [
    '你是每日动态简报编辑。请用中文输出一段 300 字以内的总体摘要，不要输出 JSON。',
    ...(titleOnly ? ['只能依据输入标题归纳主题，不得补充标题中未明确体现的事实、数字、原因或结论。'] : []),
  ].join('\n');
}
