import crypto from 'crypto';
import type {
  DailyAwarenessCandidate,
  DailyAwarenessMaterial,
  DailyAwarenessScoredEvent,
  DailyAwarenessSourceInfo,
} from './daily-awareness.types.js';

const LEADING_PREFIX_PATTERN = /^(【[^】]{1,20}】|\[[^\]]{1,20}\]|快讯[:：]?|突发[:：]?|独家[:：]?|最新[:：]?)+/i;
const SOURCE_SUFFIX_PATTERN = /([_-]\s*)?(bbc|cnn|reuters|ap|法新社|路透社|新华社|央视新闻|环球网|观察者网)$/i;

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

  const byTitle = new Map<string, DailyAwarenessMaterial>();
  for (const material of [...byUrl.values(), ...withoutUrl]) {
    const key = normalizeEventTitle(material.title);
    if (!key) continue;
    const existing = byTitle.get(key);
    if (!existing || materialWeight(material) > materialWeight(existing)) byTitle.set(key, material);
  }

  return [...byTitle.values()].sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt));
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
        summaryText: sorted.map((item) => item.content || item.title).filter(Boolean).join('\n').slice(0, 1200),
        sources,
        relatedMaterialIds: sorted.map((item) => item.id).filter(Boolean),
        sourceCount: sorted.length,
      };
    })
    .filter((item) => item.title && item.summaryText)
    .sort((a, b) => b.sourceCount - a.sourceCount);
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

function materialToSource(material: DailyAwarenessMaterial): DailyAwarenessSourceInfo {
  return {
    title: material.title,
    publisher: material.publisher,
    publishedAt: material.publishedAt,
    url: material.url,
  };
}

function materialWeight(material: DailyAwarenessMaterial): number {
  return String(material.content || '').length + dateValue(material.publishedAt) / 10_000_000_000;
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
