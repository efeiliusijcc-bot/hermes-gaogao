import type { EntityPolicy, CoreEntity, PossibleConfusion, AmbiguousTerm } from './entity-policy.js';
import { normalizePolicyText } from './entity-policy.js';

export interface SourceEntityGuardInput {
  title?: unknown;
  snippet?: unknown;
  summary?: unknown;
  content?: unknown;
  contentExcerpt?: unknown;
  url?: unknown;
  publisher?: unknown;
  websiteName?: unknown;
  metadata?: unknown;
  vectorScore?: unknown;
  similarity?: unknown;
  relevanceScore?: unknown;
  publishedAt?: unknown;
  publishTime?: unknown;
  sourceType?: unknown;
  [key: string]: unknown;
}

export interface SourceEntityMatch {
  status: 'accepted' | 'uncertain' | 'rejected';
  confidence: number;
  finalScore: number;
  matchedCoreEntities: string[];
  matchedAliases: string[];
  matchedTopicTerms: string[];
  matchedActionTerms: string[];
  matchedAmbiguousTerms: string[];
  matchedConfusions: string[];
  missingCoreEntities: string[];
  reason: string;
  vectorScore?: number;
}

export interface SourceWithEntityMatch extends Record<string, unknown> {
  entityMatch: SourceEntityMatch;
}

export interface SourceFilterDiagnostics {
  entityPolicyEnabled: boolean;
  requiredEntityMatch: boolean;
  coreEntities: string[];
  topicTerms: string[];
  acceptedCount: number;
  uncertainCount: number;
  rejectedCount: number;
  rejectionSummary: Array<{ reason: string; count: number }>;
  fallbackReason: string;
  shouldUseWebSupplement: boolean;
  recommendedSearchQueries: string[];
}

export interface SourceFilterResult<T extends object = Record<string, unknown>> {
  acceptedSources: Array<T & SourceWithEntityMatch>;
  uncertainSources: Array<T & SourceWithEntityMatch>;
  rejectedSources: Array<T & SourceWithEntityMatch>;
  diagnostics: SourceFilterDiagnostics;
}

export function validateSourceEntityMatch(source: SourceEntityGuardInput, entityPolicy: EntityPolicy): SourceEntityMatch {
  const normalized = buildNormalizedSource(source);
  const vectorScore = normalizeScore(source.vectorScore ?? source.similarity ?? source.relevanceScore);
  const matchedEntities: CoreEntity[] = [];
  const matchedAliases = new Set<string>();
  const matchedTopicTerms = matchTerms(entityPolicy.topicTerms, normalized.allText);
  const matchedActionTerms = matchTerms(entityPolicy.actionTerms, normalized.allText);
  const matchedAmbiguousTerms = matchAmbiguousTerms(entityPolicy.ambiguousTerms, normalized.allText);
  const matchedConfusions = matchConfusions(entityPolicy.possibleConfusions, normalized.allText);

  for (const entity of entityPolicy.coreEntities || []) {
    const aliases = entity.aliases?.length ? entity.aliases : [entity.canonical];
    const entityMatchedAliases = aliases.filter((alias) => containsTerm(normalized.allText, alias));
    if (entityMatchedAliases.length) {
      matchedEntities.push(entity);
      entityMatchedAliases.forEach((alias) => matchedAliases.add(alias));
    }
  }

  const matchedCoreEntities = unique(matchedEntities.map((entity) => entity.canonical));
  const missingCoreEntities = (entityPolicy.coreEntities || [])
    .filter((entity) => !matchedCoreEntities.includes(entity.canonical))
    .map((entity) => entity.canonical);
  const hasCore = matchedCoreEntities.length > 0;
  const matchedAliasList = Array.from(matchedAliases);
  const ambiguousAliasOnly = matchedAliasList.length > 0 &&
    matchedAliasList.every((alias) => matchedAmbiguousTerms.some((term) => normalizeForMatch(term) === normalizeForMatch(alias)));
  const hasOnlyAmbiguous = matchedAmbiguousTerms.length > 0 && !hasCore && matchedTopicTerms.length === 0;
  const titleHasCore = matchedEntities.some((entity) => (entity.aliases || [entity.canonical]).some((alias) => containsTerm(normalized.title, alias)));
  const bodyHasCore = hasCore && !titleHasCore;
  const onlyParentMatch = hasCore && matchedEntities.every((entity) => entity.importance === 'parent' || entity.importance === 'context');
  const strongNegativeConflict = matchedConfusions.length > 0 && !hasCore;
  const emptySource = !normalized.title && !normalized.allText.replace(/https?:\/\/\S+/g, '').trim();

  let hardRejectReason = '';
  if (emptySource) hardRejectReason = '来源标题和内容为空，无法判断与主题实体的关系。';
  else if (ambiguousAliasOnly) hardRejectReason = '仅命中短词/缩写，未命中可消歧的核心实体全称或主题上下文。';
  else if (entityPolicy.requiredEntityMatch && !hasCore) hardRejectReason = matchedConfusions.length
    ? '命中可能混淆对象，且未命中核心实体。'
    : matchedAmbiguousTerms.length
      ? '仅命中短词/缩写，未命中可消歧的核心实体全称或别名。'
      : '未命中核心实体或别名。';
  else if (strongNegativeConflict) hardRejectReason = '命中可能混淆对象，且缺少核心实体证据。';
  else if (hasOnlyAmbiguous) hardRejectReason = '仅命中短词/缩写，不能作为可用信源。';

  const entityScore = !hasCore
    ? 0
    : titleHasCore
      ? 1
      : bodyHasCore
        ? 0.72
        : 0.55;
  const topicScore = Math.min(1, matchedTopicTerms.length * 0.18 + matchedActionTerms.length * 0.22);
  const sourceQualityScore = sourceQuality(normalized);
  const freshnessScore = freshness(source.publishedAt ?? source.publishTime);
  const negativePenalty = Math.min(0.45, matchedConfusions.length * 0.22 + (onlyParentMatch ? 0.18 : 0));
  const finalScore = clamp01(
    0.4 * entityScore +
    0.25 * topicScore +
    0.15 * vectorScore +
    0.1 * sourceQualityScore +
    0.1 * freshnessScore -
    negativePenalty,
  );

  if (hardRejectReason) {
    return {
      status: 'rejected',
      confidence: clamp01(0.75 + (matchedConfusions.length ? 0.15 : 0)),
      finalScore,
      matchedCoreEntities,
      matchedAliases: Array.from(matchedAliases),
      matchedTopicTerms,
      matchedActionTerms,
      matchedAmbiguousTerms,
      matchedConfusions,
      missingCoreEntities,
      reason: hardRejectReason,
      vectorScore,
    };
  }

  let status: SourceEntityMatch['status'] = 'rejected';
  let reason = '';
  if (finalScore >= 0.65 && hasCore && matchedConfusions.length === 0 && !onlyParentMatch) {
    status = 'accepted';
    reason = '命中核心实体或别名，并具备足够主题相关性。';
  } else if (finalScore >= 0.4 || hasCore || !entityPolicy.requiredEntityMatch) {
    status = 'uncertain';
    reason = onlyParentMatch
      ? '仅命中父级或上下文实体，未命中更具体核心对象。'
      : hasCore && matchedTopicTerms.length + matchedActionTerms.length === 0
        ? '命中核心实体，但主题词或动作词证据不足。'
        : '相关性不足以直接放行，需要人工或后续检索核验。';
  } else {
    reason = '综合分低于阈值。';
  }

  return {
    status,
    confidence: status === 'accepted' ? finalScore : clamp01(1 - finalScore),
    finalScore,
    matchedCoreEntities,
    matchedAliases: Array.from(matchedAliases),
    matchedTopicTerms,
    matchedActionTerms,
    matchedAmbiguousTerms,
    matchedConfusions,
    missingCoreEntities,
    reason,
    vectorScore,
  };
}

export function filterSourcesByEntityPolicy<T extends object>(
  sources: T[],
  entityPolicy: EntityPolicy,
): SourceFilterResult<T> {
  const acceptedSources: Array<T & SourceWithEntityMatch> = [];
  const uncertainSources: Array<T & SourceWithEntityMatch> = [];
  const rejectedSources: Array<T & SourceWithEntityMatch> = [];
  for (const source of sources) {
    const entityMatch = validateSourceEntityMatch(source as SourceEntityGuardInput, entityPolicy);
    const enriched = { ...source, entityMatch } as T & SourceWithEntityMatch;
    if (entityMatch.status === 'accepted') acceptedSources.push(enriched);
    else if (entityMatch.status === 'uncertain') uncertainSources.push(enriched);
    else rejectedSources.push(enriched);
  }
  const rejectionSummary = summarizeRejections([...uncertainSources, ...rejectedSources]);
  const fallbackReason = acceptedSources.length
    ? ''
    : sources.length
      ? `数据库未找到通过核心实体校验的信源，已过滤 ${rejectedSources.length + uncertainSources.length} 条候选。`
      : '数据库召回未返回候选信源。';
  return {
    acceptedSources,
    uncertainSources,
    rejectedSources,
    diagnostics: {
      entityPolicyEnabled: true,
      requiredEntityMatch: entityPolicy.requiredEntityMatch,
      coreEntities: (entityPolicy.coreEntities || []).map((entity) => entity.canonical),
      topicTerms: entityPolicy.topicTerms || [],
      acceptedCount: acceptedSources.length,
      uncertainCount: uncertainSources.length,
      rejectedCount: rejectedSources.length,
      rejectionSummary,
      fallbackReason,
      shouldUseWebSupplement: acceptedSources.length < 3,
      recommendedSearchQueries: entityPolicy.searchQueries || [],
    },
  };
}

function buildNormalizedSource(source: SourceEntityGuardInput): { title: string; allText: string } {
  const metadata = source.metadata && typeof source.metadata === 'object' ? JSON.stringify(source.metadata) : '';
  const url = normalizeUrlText(source.url);
  const title = normalizeForMatch(source.title);
  const parts = [
    source.title,
    source.snippet,
    source.summary,
    source.content,
    source.contentExcerpt,
    url,
    source.publisher,
    source.websiteName,
    source.sourceType,
    metadata,
  ];
  return {
    title,
    allText: normalizeForMatch(parts.map((part) => String(part ?? '')).join('\n')),
  };
}

function normalizeForMatch(value: unknown): string {
  return normalizePolicyText(value, 20000)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrlText(value: unknown): string {
  const raw = String(value || '');
  try {
    const parsed = new URL(raw);
    return `${parsed.hostname} ${parsed.pathname.replace(/[._/-]+/g, ' ')}`;
  } catch {
    return raw.replace(/[._/-]+/g, ' ');
  }
}

function matchTerms(terms: string[] = [], text: string): string[] {
  return unique(terms.filter((term) => containsTerm(text, term)));
}

function matchAmbiguousTerms(terms: AmbiguousTerm[] = [], text: string): string[] {
  return unique(terms.map((term) => term.term).filter((term) => containsTerm(text, term)));
}

function matchConfusions(confusions: PossibleConfusion[] = [], text: string): string[] {
  const result: string[] = [];
  for (const confusion of confusions) {
    const aliases = confusion.aliases?.length ? confusion.aliases : [confusion.entity];
    if (aliases.some((alias) => containsTerm(text, alias))) result.push(confusion.entity);
  }
  return unique(result);
}

function containsTerm(text: string, rawTerm: string): boolean {
  const term = normalizeForMatch(rawTerm);
  if (!term || term.length < 2) return false;
  if (/^[a-z0-9 .+&/-]+$/.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(term);
}

function normalizeScore(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number > 1) return clamp01(number / 100);
  return clamp01(number);
}

function sourceQuality(normalized: { title: string; allText: string }): number {
  let score = 0.35;
  if (normalized.title.length >= 6) score += 0.2;
  if (/gov|edu|official|reuters|bloomberg|公告|政府|委员会|公司|集团/.test(normalized.allText)) score += 0.2;
  if (/https?/.test(normalized.allText) || /\bwww\b/.test(normalized.allText)) score += 0.1;
  if (normalized.allText.length > 180) score += 0.15;
  return clamp01(score);
}

function freshness(value: unknown): number {
  if (!value) return 0.45;
  const time = new Date(String(value)).getTime();
  if (!Number.isFinite(time)) return 0.45;
  const ageDays = Math.max(0, (Date.now() - time) / 86_400_000);
  if (ageDays <= 30) return 1;
  if (ageDays <= 180) return 0.8;
  if (ageDays <= 365) return 0.6;
  return 0.4;
}

function summarizeRejections(items: SourceWithEntityMatch[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const reason = item.entityMatch.reason || item.entityMatch.status;
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([reason, count]) => ({ reason, count })).slice(0, 12);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = String(value || '').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
