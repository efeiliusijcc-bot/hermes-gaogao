import crypto from 'crypto';
import type {
  DailyAwarenessCandidate,
  DailyAwarenessMaterial,
  DailyAwarenessScoredEvent,
  DailyAwarenessSourceInfo,
} from './daily-awareness.types.js';

const LEADING_PREFIX_PATTERN = /^(【[^】]{1,20}】|\[[^\]]{1,20}\]|快讯[:：]?|突发[:：]?|独家[:：]?|最新[:：]?)+/i;
const SOURCE_SUFFIX_PATTERN = /([_-]\s*)?(bbc|cnn|reuters|ap|法新社|路透社|新华社|央视新闻|环球网|观察者网)$/i;
const MOJIBAKE_PREFIX_PATTERN = /^[?\uFFFD�\s()[\]（）【】·•\-_:：|｜/\\]+(?=[\p{L}\p{N}\u4e00-\u9fff])/u;
const MOJIBAKE_SUFFIX_PATTERN = /(?<=[\p{L}\p{N}\u4e00-\u9fff])[?\uFFFD�\s()[\]（）【】·•\-_:：|｜/\\.。]+$/u;
const MOSTLY_PLACEHOLDER_PATTERN = /^[?\uFFFD�\s()[\]（）【】·•\-_:：|｜/\\.。]+$/u;

export function buildDailyMaterialWindow(targetDate: string, lookbackHours = 24) {
  const date = parseDateOnly(targetDate);
  const hours = Math.max(1, Math.min(168, Math.floor(Number(lookbackHours) || 24)));
  const exactStart = new Date(date.getTime() - hours * 60 * 60 * 1000);
  const exactEnd = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const fallbackStart = new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    targetDate: targetDate.slice(0, 10),
    lookbackHours: hours,
    exactStart: exactStart.toISOString(),
    exactEnd: exactEnd.toISOString(),
    fallbackStart: fallbackStart.toISOString(),
    fallbackEnd: exactEnd.toISOString(),
  };
}

export function normalizeEventTitle(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(LEADING_PREFIX_PATTERN, '')
    .replace(SOURCE_SUFFIX_PATTERN, '')
    .replace(/[“”"'‘’`´]/g, '')
    .replace(/[|｜:：,，.。;；!！?？()[\]{}<>《》、/\-_\s]/g, '')
    .toLowerCase()
    .slice(0, 160);
}

export function sanitizeSourceText(value: unknown): string {
  const text = String(value || '')
    .replace(/\u0000/g, '')
    .replace(MOJIBAKE_PREFIX_PATTERN, '')
    .replace(MOJIBAKE_SUFFIX_PATTERN, '')
    .trim();
  if (!text || MOSTLY_PLACEHOLDER_PATTERN.test(text)) return '';
  return text;
}

export function dedupeMaterials(materials: DailyAwarenessMaterial[]): DailyAwarenessMaterial[] {
  const byUrl = new Map<string, DailyAwarenessMaterial>();
  const withoutUrl: DailyAwarenessMaterial[] = [];

  for (const material of materials) {
    if (!String(material.title || material.content || '').trim()) continue;
    const url = String(material.url || '').trim();
    if (!url) {
      withoutUrl.push(material);
      continue;
    }
    const existing = byUrl.get(url);
    if (!existing || materialWeight(material) > materialWeight(existing)) byUrl.set(url, material);
  }

  return [...byUrl.values(), ...withoutUrl]
    .filter((material) => Boolean(normalizeEventTitle(material.title)))
    .sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt));
}

export function buildEventCandidates(materials: DailyAwarenessMaterial[]): DailyAwarenessCandidate[] {
  const groups = new Map<string, DailyAwarenessMaterial[]>();
  for (const material of materials) {
    const key = normalizeEventTitle(material.title);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), material]);
  }

  return [...groups.entries()]
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => materialWeight(b) - materialWeight(a));
      const primary = sorted[0];
      const sources = sorted.slice(0, 5).map(materialToSource);
      return {
        candidateId: `candidate_${hashText(key).slice(0, 16)}`,
        title: primary.title,
        summaryText: String(primary.summary || primary.content || primary.title).trim(),
        sources,
        relatedMaterialIds: sorted.map((item) => item.id).filter(Boolean),
        sourceCount: sorted.length,
        category: String(primary.designatedTag || primary.metadata.designatedTag || '其他').trim() || '其他',
        tag: String(primary.tag || primary.metadata.tag || '').trim(),
      };
    })
    .filter((item) => item.title && item.summaryText)
    .sort((a, b) => b.sourceCount - a.sourceCount);
}

export function buildDailyAwarenessScoringPayload(
  candidates: Array<Pick<DailyAwarenessCandidate, 'candidateId' | 'title' | 'category' | 'tag'>>,
) {
  return candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    title: candidate.title,
    category: candidate.category || '其他',
    tag: candidate.tag || '',
  }));
}

export function applyDailyAwarenessScores(
  candidates: Array<Pick<DailyAwarenessCandidate, 'candidateId' | 'title' | 'summaryText' | 'category' | 'tag' | 'sources' | 'relatedMaterialIds'>>,
  scores: Array<Record<string, unknown>>,
): DailyAwarenessScoredEvent[] {
  const byCandidate = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const seen = new Set<string>();
  return scores.map((raw) => {
    const candidateId = String(raw.candidateId || '').trim();
    const candidate = byCandidate.get(candidateId);
    if (!candidate) return null;
    if (seen.has(candidateId)) return null;
    seen.add(candidateId);
    return {
      candidateId: candidate.candidateId,
      eventTitle: candidate.title,
      category: candidate.category || '其他',
      region: '',
      basicSituation: String(candidate.summaryText || '').trim(),
      backgroundContext: '',
      importanceJudgement: '',
      riskToUs: '',
      importanceScore: clampScore(raw.importanceScore),
      riskScore: clampScore(raw.riskScore),
      sourceInfo: candidate.sources,
      relatedMaterialIds: candidate.relatedMaterialIds,
    } satisfies DailyAwarenessScoredEvent;
  }).filter((event): event is DailyAwarenessScoredEvent => Boolean(event));
}

export function rankDailyEvents(events: DailyAwarenessScoredEvent[], maxItems: number): DailyAwarenessScoredEvent[] {
  const limit = Math.max(1, Math.min(50, Number(maxItems) || 50));
  return [...events]
    .map((event) => ({
      ...event,
      importanceScore: clampScore(event.importanceScore),
      riskScore: clampScore(event.riskScore),
    }))
    .sort((a, b) => weightedScore(b) - weightedScore(a))
    .slice(0, limit);
}

export function selectClassificationCandidates<T>(candidates: T[], maxItems: number): { items: T[]; limit: number } {
  const requested = Math.max(1, Math.min(50, Number(maxItems) || 50));
  const limit = Math.min(120, Math.max(80, requested * 4));
  return {
    items: candidates.slice(0, limit),
    limit,
  };
}

export function extractJsonObject(value: string): unknown {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('LLM output does not contain a JSON object');
  }
}

export function clampScore(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

export function weightedScore(event: Pick<DailyAwarenessScoredEvent, 'importanceScore' | 'riskScore'>): number {
  return clampScore(event.importanceScore) * 0.7 + clampScore(event.riskScore) * 0.3;
}

export function categoryStats(events: DailyAwarenessScoredEvent[]): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const category = String(event.category || '其他').trim() || '其他';
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'zh-CN'));
}

export function dailyReportTitle(date: string, usedFallback = false): string {
  return `${date} 每日动态简报${usedFallback ? '（使用最近可用信源）' : ''}`;
}

export function formatPublishedDate(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '时间未知';
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/u)?.[1];
  if (dateOnly) return dateOnly;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : text;
}

export function buildDailyReportJson(events: DailyAwarenessScoredEvent[]) {
  const sections = new Map<string, Array<Record<string, unknown>>>();
  events.forEach((event, index) => {
    const category = String(event.category || '其他').trim() || '其他';
    const source = primarySource(event);
    const items = sections.get(category) || [];
    items.push({
      rank: index + 1,
      title: event.eventTitle,
      category,
      importanceScore: clampScore(event.importanceScore),
      briefContent: eventBriefContent(event),
      publisher: source.publisher || '',
      publishedAt: source.publishedAt || '',
      sourceUrl: source.url || '',
      sourceCount: Array.isArray(event.sourceInfo) ? event.sourceInfo.length : 0,
    });
    sections.set(category, items);
  });

  return {
    sections: [...sections.entries()].map(([category, items]) => ({ category, items })),
  };
}

export function buildDailyReportMarkdown(input: {
  date: string;
  title: string;
  summary: string;
  materialCount: number;
  selectedCount: number;
  categoryStats: Array<{ category: string; count: number }>;
  events: DailyAwarenessScoredEvent[];
  usedFallback?: boolean;
}) {
  const materialCount = Number(input.materialCount || 0);
  const selectedCount = Number(input.selectedCount || input.events.length || 0);
  const categoryNames = input.categoryStats.map((item) => item.category).filter(Boolean);
  const overview = input.summary || [
    `今日共从 ${materialCount} 条候选新闻中筛选出 ${selectedCount} 条重点新闻`,
    categoryNames.length ? `主要集中在${categoryNames.slice(0, 5).join('、')}等领域` : '覆盖多个领域',
    input.usedFallback ? '。当前日期无可用材料，已使用最近 7 天可用信源生成简报。' : '。',
  ].join('');
  const lines: string[] = [
    `# ${input.title}`,
    '',
    '## 一、今日概览',
    '',
    overview,
    '',
    '## 二、分类分布',
    '',
  ];

  if (input.categoryStats.length) {
    for (const item of input.categoryStats) lines.push(`- ${item.category}：${item.count} 条`);
  } else {
    lines.push('- 暂无分类统计');
  }

  lines.push('', '## 三、重点新闻列表', '');
  const grouped = buildDailyReportJson(input.events).sections;
  for (const [sectionIndex, section] of grouped.entries()) {
    lines.push(`### ${toChineseSectionNumber(sectionIndex + 1)}${section.category}`, '');
    for (const [itemIndex, item] of section.items.entries()) {
      const sectionRank = itemIndex + 1;
      const title = String(item.title || '未命名新闻');
      const briefContent = String(item.briefContent || '暂无简要内容。');
      const publisher = sanitizeSourceText(item.publisher) || '来源未知';
      const publishedAt = formatPublishedDate(item.publishedAt);
      lines.push(`${sectionRank}. ${title}`);
      lines.push(`   简要内容：${briefContent}`);
      lines.push('');
      lines.push(`   来源：${publisher}，发布时间：${publishedAt}`);
      lines.push('');
    }
  }

  lines.push(
    '## 四、可进一步研判方向',
    '',
    '- 可围绕高频分类中的重点新闻形成专题编报；',
    '- 可选择单条新闻导入拟稿助手开展深度分析；',
    '- 正式编报前建议复核关键时间、主体表态和来源链接。',
  );

  return lines.join('\n').trim();
}

function eventBriefContent(event: DailyAwarenessScoredEvent): string {
  return String(event.basicSituation || event.backgroundContext || event.importanceJudgement || '').trim() || '暂无简要内容。';
}

function primarySource(event: DailyAwarenessScoredEvent): DailyAwarenessSourceInfo {
  return Array.isArray(event.sourceInfo) && event.sourceInfo[0]
    ? event.sourceInfo[0]
    : { title: '', publisher: '', publishedAt: '', url: '' };
}

function toChineseSectionNumber(value: number): string {
  const numbers = ['（一）', '（二）', '（三）', '（四）', '（五）', '（六）', '（七）', '（八）', '（九）', '（十）'];
  return numbers[value - 1] || `（${value}）`;
}

function materialToSource(material: DailyAwarenessMaterial): DailyAwarenessSourceInfo {
  return {
    title: sanitizeSourceText(material.title),
    publisher: sanitizeSourceText(material.publisher),
    publishedAt: material.publishedAt,
    url: material.url,
  };
}

function materialWeight(material: DailyAwarenessMaterial): number {
  return String(material.summary || material.content || '').length + dateValue(material.publishedAt) / 10_000_000_000;
}

function dateValue(value: string): number {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? time : 0;
}

function hashText(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function parseDateOnly(value: string): Date {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('date must be formatted as YYYY-MM-DD');
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error('date must be formatted as YYYY-MM-DD');
  return date;
}
