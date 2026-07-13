import { Inject, Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import type { EntityPolicy } from './entity-policy.js';
import type { SourceEntityMatch } from './source-entity-guard.js';
import { ResearchKeysService } from './research-keys.service.js';

export interface WebSearchSource extends Record<string, unknown> {
  title: string;
  url: string;
  summary: string;
  content?: string;
  publisher: string;
  publishedAt: string;
  sourceType: 'web';
  engine: 'tavily';
  query: string;
  searchScore: number;
  entityMatch?: SourceEntityMatch;
  sourceQuality?: SourceQualityResult;
  sourcePriority?: number;
  validationStage?: 'search_result_validation' | 'fetched_content_validation';
}

export interface SourceQualityResult {
  status: 'accepted' | 'uncertain' | 'rejected';
  score: number;
  tier: 'official' | 'mainstream' | 'industry' | 'research' | 'repost' | 'ordinary' | 'invalid';
  reason: string;
}

export interface SupplementTriggerInput {
  acceptedDatabaseCount: number;
  minimumAcceptedDatabaseSources?: number;
  context?: Record<string, unknown>;
}

export interface SupplementTriggerDecision {
  triggered: boolean;
  reason: string;
  minimumAcceptedDatabaseSources: number;
}

function boundedEnvInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

export const WEB_SUPPLEMENT_LIMITS = {
  maxQueries: boundedEnvInt('WEB_SUPPLEMENT_MAX_QUERIES', 8, 4, 10),
  candidatesPerQuery: boundedEnvInt('WEB_SUPPLEMENT_CANDIDATES_PER_QUERY', 8, 5, 10),
  maxUniqueUrls: boundedEnvInt('WEB_SUPPLEMENT_MAX_UNIQUE_URLS', 30, 5, 60),
  maxFullContentFetches: boundedEnvInt('WEB_SUPPLEMENT_MAX_FULL_CONTENT_FETCHES', 20, 1, 30),
  maxControlledFetchUrls: boundedEnvInt('WEB_SUPPLEMENT_MAX_CONTROLLED_FETCH_URLS', 10, 1, 20),
  retryCount: boundedEnvInt('WEB_SUPPLEMENT_RETRY_COUNT', 1, 0, 1),
  searchTimeoutMs: boundedEnvInt('WEB_SUPPLEMENT_SEARCH_TIMEOUT_MS', 12_000, 2_000, 30_000),
  totalTimeoutMs: boundedEnvInt('WEB_SUPPLEMENT_TOTAL_TIMEOUT_MS', 120_000, 90_000, 180_000),
};

export interface QueryTelemetry {
  query: string;
  reason: string;
  resultCount: number;
  durationMs: number;
  error?: string;
}

export interface WebSearchTelemetryResult {
  sources: WebSearchSource[];
  queryDiagnostics: QueryTelemetry[];
  durationMs: number;
}

@Injectable()
export class WebSupplementService {
  constructor(@Inject(ResearchKeysService) private readonly researchKeys: ResearchKeysService) {}

  async search(queries: string[], maxResultsPerQuery = 8): Promise<WebSearchSource[]> {
    return (await this.searchWithDiagnostics(queries, maxResultsPerQuery)).sources;
  }

  async searchWithDiagnostics(queries: string[], maxResultsPerQuery = WEB_SUPPLEMENT_LIMITS.candidatesPerQuery): Promise<WebSearchTelemetryResult> {
    const startedAt = Date.now();
    const selectedQueries = queries.slice(0, WEB_SUPPLEMENT_LIMITS.maxQueries);
    const results = await Promise.all(selectedQueries.map(async (query) => {
      const queryStartedAt = Date.now();
      try {
        const sources = await this.searchQueryWithRetry(query, maxResultsPerQuery);
        return { sources, diagnostic: { query, reason: 'entity_policy', resultCount: sources.length, durationMs: Date.now() - queryStartedAt } };
      } catch (error) {
        return {
          sources: [] as WebSearchSource[],
          diagnostic: {
            query,
            reason: 'entity_policy',
            resultCount: 0,
            durationMs: Date.now() - queryStartedAt,
            error: String(error instanceof Error ? error.message : error).slice(0, 240),
          },
        };
      }
    }));
    return {
      sources: dedupeSupplementSources(results.flatMap((item) => item.sources)).slice(0, WEB_SUPPLEMENT_LIMITS.maxUniqueUrls) as WebSearchSource[],
      queryDiagnostics: results.map((item) => item.diagnostic),
      durationMs: Date.now() - startedAt,
    };
  }

  private async searchQueryWithRetry(query: string, maxResults: number): Promise<WebSearchSource[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= WEB_SUPPLEMENT_LIMITS.retryCount; attempt += 1) {
      try {
        return await this.searchQuery(query, maxResults);
      } catch (error) {
        lastError = error;
        const status = Number((error as { status?: unknown })?.status || 0);
        if (attempt >= WEB_SUPPLEMENT_LIMITS.retryCount || ![429, 500, 502, 503, 504].includes(status)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Tavily search failed'));
  }

  private async searchQuery(query: string, maxResults: number): Promise<WebSearchSource[]> {
    return this.researchKeys.withKeyFailover('tavilyApiKey', async (apiKey) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEB_SUPPLEMENT_LIMITS.searchTimeoutMs);
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: 'advanced',
            max_results: Math.max(1, Math.min(10, maxResults)),
            include_answer: false,
            include_raw_content: false,
          }),
        });
        if (!response.ok) {
          const error = new Error(`Tavily search failed with ${response.status}`) as Error & { status?: number };
          error.status = response.status;
          throw error;
        }
        const data = await response.json() as { results?: Array<Record<string, unknown>> };
        return (Array.isArray(data.results) ? data.results : []).map((item) => ({
          title: clean(item.title, 500),
          url: clean(item.url, 2000),
          summary: clean(item.content, 2000),
          content: clean(item.raw_content, 20_000),
          publisher: clean(item.source, 300) || hostname(item.url),
          publishedAt: clean(item.published_date, 80),
          sourceType: 'web' as const,
          engine: 'tavily' as const,
          query,
          searchScore: normalizeScore(item.score),
        })).filter((item) => item.title || item.url);
      } finally {
        clearTimeout(timer);
      }
    });
  }
}

export function decideWebSupplementTrigger(input: SupplementTriggerInput): SupplementTriggerDecision {
  const context = input.context || {};
  const minimum = boundInt(input.minimumAcceptedDatabaseSources, 3, 1, 20);
  const databaseOptions = plainObject(context.databaseSourceOptions);
  const webOptions = plainObject(context.webSearchOptions || context.internetSearchOptions);
  const supplementOptions = plainObject(context.sourceSupplementOptions);
  const offline = context.offlineMode === true || context.offline === true || String(context.sourceMode || '').toLowerCase() === 'offline';
  const internalOnly = context.internalDatabaseOnly === true || context.internalOnly === true || /internal[_-]?only|database[_-]?only/i.test(String(context.sourceMode || ''));
  const internetExplicitlyDisabled = webOptions.enabled === false || context.internetSearchEnabled === false || context.webSearchEnabled === false;

  if (databaseOptions.enabled !== true && String(databaseOptions.enabled || '').toLowerCase() !== 'true') {
    return { triggered: false, reason: '数据库信源选项未启用，不执行数据库不足补充。', minimumAcceptedDatabaseSources: minimum };
  }
  if (supplementOptions.enabled === false) return { triggered: false, reason: '用户已关闭公开信源自动补充。', minimumAcceptedDatabaseSources: minimum };
  if (offline) return { triggered: false, reason: '当前任务为离线模式。', minimumAcceptedDatabaseSources: minimum };
  if (internalOnly) return { triggered: false, reason: '当前任务仅允许使用内部数据库。', minimumAcceptedDatabaseSources: minimum };
  if (internetExplicitlyDisabled) return { triggered: false, reason: '用户已关闭互联网搜索。', minimumAcceptedDatabaseSources: minimum };
  if (input.acceptedDatabaseCount >= minimum) return { triggered: false, reason: `数据库已有 ${input.acceptedDatabaseCount} 条有效信源，达到最低阈值 ${minimum}。`, minimumAcceptedDatabaseSources: minimum };
  return {
    triggered: true,
    reason: `数据库有效信源 ${input.acceptedDatabaseCount} 条，低于最低阈值 ${minimum}，启动公开信源补充。`,
    minimumAcceptedDatabaseSources: minimum,
  };
}

export function buildSupplementQueries(entityPolicy: EntityPolicy): string[] {
  const queries = new Set<string>();
  const add = (value: string) => {
    const cleanValue = clean(value, 240);
    if (cleanValue && hasSpecificEntity(cleanValue, entityPolicy)) queries.add(cleanValue);
  };
  for (const query of entityPolicy.searchQueries || []) add(query);

  const ambiguous = new Set((entityPolicy.ambiguousTerms || []).map((item) => item.term.toLowerCase()));
  const entities = [...(entityPolicy.coreEntities || [])]
    .filter((entity) => !ambiguous.has(entity.canonical.toLowerCase()) && !/(?:下属|旗下)?子公司$/.test(entity.canonical))
    .sort((a, b) => importanceRank(a.importance) - importanceRank(b.importance));
  const primary = entities[0];
  const secondary = entities.find((entity) => entity !== primary);
  const topicTerms = (entityPolicy.topicTerms || []).slice(0, 4);
  const actionTerms = (entityPolicy.actionTerms || []).slice(0, 4);
  if (primary) {
    const fullAliases = unique([primary.canonical, ...(primary.aliases || [])])
      .filter((alias) => !ambiguous.has(alias.toLowerCase()) && !/^[A-Z0-9]{2,6}$/.test(alias))
      .sort((a, b) => b.length - a.length);
    for (const alias of fullAliases.slice(0, 3)) {
      add([alias, ...topicTerms.slice(0, 3)].filter(Boolean).join(' '));
      add([alias, ...actionTerms.slice(0, 3)].filter(Boolean).join(' '));
    }
    if (secondary) add([primary.canonical, secondary.canonical, ...topicTerms.slice(0, 2)].join(' '));
  }
  for (const entity of entities.slice(0, 4)) add([entity.canonical, ...topicTerms.slice(0, 2)].join(' '));
  if (primary && queries.size < 4) {
    for (const suffix of ['官方 公告', '最新 进展', '研究 报告', '新闻 动态']) add(`${primary.canonical} ${suffix}`);
  }
  return Array.from(queries).filter((query) => hasFullEntity(query, entityPolicy)).slice(0, WEB_SUPPLEMENT_LIMITS.maxQueries);
}

export function assessSourceQuality(source: Record<string, unknown>): SourceQualityResult {
  const title = clean(source.title, 800).toLowerCase();
  const url = clean(source.url, 2000).toLowerCase();
  const publisher = clean(source.publisher || source.websiteName, 500).toLowerCase();
  const content = clean(source.content || source.contentText || source.rawContent || source.summary, 30_000);
  const combined = `${title} ${url} ${publisher} ${content.slice(0, 2000)}`.toLowerCase();

  if (!title && !content) return { status: 'rejected', score: 0, tier: 'invalid', reason: '页面缺少标题和正文。' };
  if (content.length < 120) return { status: 'rejected', score: 0.15, tier: 'invalid', reason: '页面无有效正文或正文过短。' };
  if (/\b(login|sign in|subscribe|paywall|access denied|captcha)\b|登录后|付费订阅|无权访问|验证码/.test(combined)) {
    return { status: 'rejected', score: 0.1, tier: 'invalid', reason: '登录页、付费墙或不可访问页面。' };
  }
  if (/\/(search|tag|tags|category|author)(\/|\?|$)|搜索结果|标签页|站内搜索/.test(combined)) {
    return { status: 'rejected', score: 0.15, tier: 'invalid', reason: '搜索页、标签页或聚合索引页。' };
  }
  if (/stocktwits|seekingalpha|motley fool|tradingview|investing\.com|reddit|forum|论坛|股吧|个人博客/.test(combined)) {
    return { status: 'uncertain', score: 0.4, tier: 'ordinary', reason: '普通博客、论坛或股票评论，需更高质量来源印证。' };
  }
  if (/\.gov\b|\.gov\.|government|ministry|commission|official|公告|政府|监管|公司官网|investor relations/.test(combined)) {
    return { status: 'accepted', score: 0.95, tier: 'official', reason: '官方、政府或公司公告来源。' };
  }
  if (/reuters|associated press|\bap news\b|bloomberg|financial times|bbc|新华社|路透|彭博|央视/.test(combined)) {
    return { status: 'accepted', score: 0.88, tier: 'mainstream', reason: '主流媒体来源。' };
  }
  if (/institute|university|research|think tank|研究院|大学|智库/.test(combined)) {
    return { status: 'accepted', score: 0.8, tier: 'research', reason: '研究机构来源。' };
  }
  if (/industry|technology|energy|mining|semiconductor|battery|行业|产业|科技|能源/.test(combined)) {
    return { status: 'accepted', score: 0.72, tier: 'industry', reason: '专业行业媒体或机构来源。' };
  }
  return { status: 'uncertain', score: 0.55, tier: 'repost', reason: '来源质量一般，需交叉印证。' };
}

export function sourcePriority(source: Record<string, unknown>): number {
  const entityMatch = plainObject(source.entityMatch || source.entity_match);
  const quality = plainObject(source.sourceQuality || source.source_quality);
  const entityRelevance = normalizeScore(entityMatch.finalScore ?? source.relevanceScore ?? source.relevance_score);
  const topicMatches = Array.isArray(entityMatch.matchedTopicTerms) ? entityMatch.matchedTopicTerms.length : 0;
  const topicRelevance = Math.min(1, topicMatches * 0.25);
  const sourceQualityScore = normalizeScore(quality.score ?? source.credibilityScore ?? source.credibility_score ?? 0.5);
  const freshnessScore = freshness(source.publishedAt || source.publishTime || source.published_at || source.publish_time);
  const corroboration = normalizeScore(source.corroborationScore ?? source.corroboration_score);
  const ambiguityPenalty = (Array.isArray(entityMatch.matchedConfusions) ? entityMatch.matchedConfusions.length : 0) * 0.2;
  return clamp01(0.35 * entityRelevance + 0.2 * topicRelevance + 0.25 * sourceQualityScore + 0.1 * freshnessScore + 0.1 * corroboration - ambiguityPenalty);
}

export function dedupeSupplementSources<T extends Record<string, unknown>>(sources: T[]): T[] {
  const groups = new Map<string, T>();
  for (const source of sources) {
    const keys = dedupeKeys(source);
    const existingKey = keys.find((key) => groups.has(key));
    if (!existingKey) {
      for (const key of keys) groups.set(key, source);
      continue;
    }
    const existing = groups.get(existingKey)!;
    const winner = sourcePriority(source) > sourcePriority(existing) ? source : existing;
    const loser = winner === source ? existing : source;
    for (const key of unique([...dedupeKeys(winner), ...dedupeKeys(loser)])) groups.set(key, winner);
  }
  return Array.from(new Set(groups.values())).sort((a, b) => sourcePriority(b) - sourcePriority(a));
}

export function canonicalUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|ref$|source$|campaign$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  }
}

function dedupeKeys(source: Record<string, unknown>): string[] {
  const url = canonicalUrl(source.url || source.source_url || source.data_source_url);
  const title = normalizeTitle(source.title || source.ch_title);
  const content = clean(source.content || source.contentText || source.summary, 50_000);
  const contentHash = content.length >= 120 ? crypto.createHash('sha1').update(content.replace(/\s+/g, ' ').toLowerCase()).digest('hex') : '';
  const titleStem = title.replace(/[\d日期时间最新动态进展消息]/g, '').slice(0, 80);
  return unique([
    url ? `url:${url}` : '',
    title ? `title:${title}` : '',
    titleStem.length >= 8 ? `title-stem:${titleStem}` : '',
    contentHash ? `content:${contentHash}` : '',
  ]);
}

function hasSpecificEntity(query: string, policy: EntityPolicy): boolean {
  const lower = query.toLowerCase();
  return (policy.coreEntities || []).some((entity) => unique([entity.canonical, ...(entity.aliases || [])]).some((alias) => {
    const normalized = alias.toLowerCase();
    return normalized.length >= 3 && lower.includes(normalized);
  }));
}

function hasFullEntity(query: string, policy: EntityPolicy): boolean {
  const lower = query.toLowerCase();
  const ambiguous = new Set((policy.ambiguousTerms || []).map((item) => item.term.toLowerCase()));
  return (policy.coreEntities || []).some((entity) => unique([entity.canonical, ...(entity.aliases || [])]).some((alias) => {
    const normalized = alias.toLowerCase();
    if (ambiguous.has(normalized) || /^[a-z0-9]{2,6}$/.test(normalized) || /(?:下属|旗下)?子公司$/.test(alias)) return false;
    return normalized.length >= 3 && lower.includes(normalized);
  }));
}

function importanceRank(value: string): number {
  return value === 'primary' || value === 'subsidiary' ? 0 : value === 'parent' ? 1 : value === 'secondary' ? 2 : 3;
}

function normalizeTitle(value: unknown): string {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[“”"'‘’`]/g, '').replace(/[^\p{Letter}\p{Number}]+/gu, '').slice(0, 240);
}

function hostname(value: unknown): string {
  try { return new URL(String(value || '')).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function clean(value: unknown, maxLength: number): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const cleanValue = String(value || '').trim();
    if (!cleanValue || seen.has(cleanValue.toLowerCase())) return false;
    seen.add(cleanValue.toLowerCase());
    return true;
  });
}

function boundInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function normalizeScore(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return clamp01(number > 1 ? number / 100 : number);
}

function freshness(value: unknown): number {
  const time = new Date(String(value || '')).getTime();
  if (!Number.isFinite(time)) return 0.45;
  const ageDays = Math.max(0, (Date.now() - time) / 86_400_000);
  if (ageDays <= 30) return 1;
  if (ageDays <= 180) return 0.8;
  if (ageDays <= 365) return 0.6;
  return 0.35;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
