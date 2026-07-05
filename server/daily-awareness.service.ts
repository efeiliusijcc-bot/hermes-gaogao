import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import type { AuthUser } from './auth-user.interface.js';
import { createAuthPool, type PgPool } from './auth-database.js';
import {
  DIRECT_QA_API_KEY,
  DIRECT_QA_BASE_URL,
  DIRECT_QA_MODEL,
  REPORT_AGENT_API_KEY,
  REPORT_AGENT_BASE_URL,
  REPORT_AGENT_MODEL,
} from './config.js';
import type {
  DailyAwarenessBriefRow,
  DailyAwarenessEventRow,
  DailyAwarenessGenerateInput,
  DailyAwarenessMaterialDiagnostics,
  DailyAwarenessScoredEvent,
  DailyAwarenessSourceInfo,
} from './daily-awareness.types.js';
import {
  buildEventCandidates,
  categoryStats,
  clampScore,
  dedupeMaterials,
  extractJsonObject,
  rankDailyEvents,
} from './daily-awareness.utils.js';
import { VectorSourceService } from './vector-source.service.js';

const DEFAULT_CATEGORIES = [
  '欧洲政治',
  '欧洲经济',
  '美国政治',
  '美国经济',
  '国际安全',
  '俄乌局势',
  '中东局势',
  '亚太安全',
  '国际组织',
  '科技产业',
  '能源资源',
  '金融市场',
  '社会舆情',
  '其他',
];
const MAX_CLASSIFICATION_CANDIDATES = 300;

@Injectable()
export class DailyAwarenessService implements OnModuleDestroy {
  private pool: PgPool | null = null;
  private llm: OpenAI | null = null;

  constructor(private readonly vectorSources: VectorSourceService) {}

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async generate(input: DailyAwarenessGenerateInput, user: AuthUser) {
    if (user.role === 'viewer') throw new ForbiddenException({ error: 'Viewer cannot generate daily briefs' });
    const date = this.requiredDate(input.date);
    const maxItems = this.clampNumber(input.maxEvents ?? input.maxItems, 50, 1, 50);
    const lookbackHours = this.clampNumber(input.lookbackHours, 24, 1, 168);
    const categories = this.normalizeStringArray(input.categories).slice(0, 20);
    const region = this.text(input.region, 128);
    const keyword = this.text(input.keyword, 128);

    const materialResult = await this.vectorSources.listDailyMaterials({
      targetDate: date,
      lookbackHours,
      limit: 3000,
      keyword,
      categories,
      region,
    });
    const materials = materialResult.materials;
    const diagnostics = materialResult.diagnostics as DailyAwarenessMaterialDiagnostics;
    const deduped = dedupeMaterials(materials);
    const allCandidates = buildEventCandidates(deduped);
    const candidates = allCandidates.slice(0, MAX_CLASSIFICATION_CANDIDATES);
    if (!candidates.length) {
      throw new BadRequestException({
        error: '信源库中未检索到可用于每日动态感知的材料，请检查 PGVector 信源库是否有数据，或扩大回溯范围。',
        diagnostics,
      });
    }

    const batchErrors: string[] = [];
    const scoredEvents: DailyAwarenessScoredEvent[] = [];
    for (let index = 0; index < candidates.length; index += 40) {
      const batch = candidates.slice(index, index + 40);
      try {
        scoredEvents.push(...await this.classifyBatch(batch, categories));
      } catch (error) {
        batchErrors.push(`batch ${Math.floor(index / 40) + 1}: ${this.safeError(error)}`);
      }
    }
    if (!scoredEvents.length) {
      throw new ServiceUnavailableException({ error: '每日简报生成失败：模型未返回可用事件', batchErrors });
    }

    const ranked = rankDailyEvents(scoredEvents, maxItems);
    const stats = categoryStats(ranked);
    const summary = await this.generateSummary(date, ranked, stats).catch(() => {
      return `${date} 每日动态感知共筛选 ${ranked.length} 条重点事件，涉及 ${stats.map((item) => item.category).join('、') || '多个'}领域。`;
    });
    const title = `${date} 每日动态简报`;
    const contentJson = {
      briefDate: date,
      title,
      summary,
      generation: {
        lookbackHours,
        keyword,
        region,
        requestedCategories: categories,
        candidateMaterialCount: materials.length,
        dedupedMaterialCount: deduped.length,
        candidateEventCount: candidates.length,
        totalCandidateEventCount: allCandidates.length,
        classificationCandidateLimit: MAX_CLASSIFICATION_CANDIDATES,
        selectedEventCount: ranked.length,
        totalMaterials: materials.length,
        totalCandidates: candidates.length,
        selectedCount: ranked.length,
        batchErrors,
        diagnostics,
        usedFallback: diagnostics.usedFallback,
        fallbackReason: diagnostics.fallbackReason,
      },
      categoryStats: stats,
    };

    const pool = await this.getPool();
    const briefResult = await pool.query(
      `INSERT INTO daily_briefs
        (owner_id, brief_date, title, summary, status, total_candidates, selected_count, categories, content_json)
       VALUES ($1, $2::date, $3, $4, 'completed', $5, $6, $7::jsonb, $8::jsonb)
       RETURNING *`,
      [user.id, date, title, summary, candidates.length, ranked.length, JSON.stringify(stats), JSON.stringify(contentJson)],
    );
    const brief = this.toBrief(briefResult.rows[0] as unknown as DailyAwarenessBriefRow, user.role === 'admin');
    const events = [];
    for (let index = 0; index < ranked.length; index += 1) {
      const event = ranked[index];
      const eventResult = await pool.query(
        `INSERT INTO daily_brief_events
          (brief_id, owner_id, rank_no, event_title, category, region, basic_situation, background_context,
           importance_judgement, risk_to_us, source_info, related_material_ids, importance_score, risk_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)
         RETURNING *`,
        [
          brief.briefId,
          user.id,
          index + 1,
          this.text(event.eventTitle, 512),
          this.text(event.category || '其他', 128),
          this.text(event.region, 128),
          this.text(event.basicSituation, 4000),
          this.text(event.backgroundContext, 4000),
          this.text(event.importanceJudgement, 3000),
          this.text(event.riskToUs, 3000),
          JSON.stringify(this.normalizeSources(event.sourceInfo)),
          JSON.stringify(Array.isArray(event.relatedMaterialIds) ? event.relatedMaterialIds : []),
          clampScore(event.importanceScore),
          clampScore(event.riskScore),
        ],
      );
      events.push(this.toEvent(eventResult.rows[0] as unknown as DailyAwarenessEventRow));
    }
    return { brief, events };
  }

  async listBriefs(query: { page?: unknown; pageSize?: unknown; date?: unknown }, user: AuthUser) {
    const page = this.clampNumber(query.page, 1, 1, 100000);
    const pageSize = this.clampNumber(query.pageSize, 20, 1, 100);
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [];
    const where: string[] = [];
    if (user.role !== 'admin') {
      params.push(user.id);
      where.push(`b.owner_id = $${params.length}`);
    }
    const date = String(query.date || '').trim();
    if (date) {
      params.push(this.requiredDate(date));
      where.push(`b.brief_date = $${params.length}::date`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pool = await this.getPool();
    const countResult = await pool.query(`SELECT count(*)::int AS count FROM daily_briefs b ${whereSql}`, params);
    const rows = await pool.query(
      `SELECT b.*, u.username AS owner_username
         FROM daily_briefs b
         LEFT JOIN users u ON u.id = b.owner_id
         ${whereSql}
        ORDER BY b.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    return {
      items: rows.rows.map((row) => this.toBrief(row as unknown as DailyAwarenessBriefRow, user.role === 'admin')),
      page,
      pageSize,
      total: Number(countResult.rows[0]?.count || 0),
    };
  }

  async getBrief(briefId: string, user: AuthUser) {
    const brief = await this.loadBriefForUser(briefId, user);
    const events = await this.loadEventsForBrief(brief.briefId, user, {});
    return { brief, events };
  }

  async listEvents(briefId: string, query: { page?: unknown; pageSize?: unknown; category?: unknown }, user: AuthUser) {
    const brief = await this.loadBriefForUser(briefId, user);
    return this.loadEventsForBrief(brief.briefId, user, query);
  }

  async importEventToDraft(itemId: string, user: AuthUser) {
    if (user.role === 'viewer') throw new ForbiddenException({ error: 'Viewer cannot import daily events to Draft Assistant' });
    const pool = await this.getPool();
    const rows = await pool.query(
      `SELECT e.*, b.brief_date
         FROM daily_brief_events e
         JOIN daily_briefs b ON b.brief_id = e.brief_id
        WHERE e.item_id = $1`,
      [this.requiredId(itemId, 'itemId')],
    );
    const row = rows.rows[0] as unknown as (DailyAwarenessEventRow & { brief_date?: string }) | undefined;
    if (!row) throw new NotFoundException({ error: 'Daily event not found' });
    if (user.role !== 'admin' && String(row.owner_id) !== user.id) {
      throw new ForbiddenException({ error: 'No permission to import this daily event' });
    }
    const rawInput = {
      source: 'daily_awareness',
      briefId: row.brief_id,
      itemId: row.item_id,
      briefDate: row.brief_date,
      title: row.event_title,
      category: row.category,
      region: row.region,
      basicSituation: row.basic_situation,
      backgroundContext: row.background_context,
      importanceJudgement: row.importance_judgement,
      riskToUs: row.risk_to_us,
      sourceInfo: this.asArray(row.source_info),
      relatedMaterialIds: this.asArray(row.related_material_ids),
    };
    const eventResult = await pool.query(
      `INSERT INTO events (owner_id, title, summary, category, region, raw_input, analysis_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
       RETURNING event_id`,
      [
        user.id,
        row.event_title,
        row.basic_situation || row.background_context || '',
        row.category,
        row.region,
        JSON.stringify(rawInput),
        JSON.stringify({
          oneSentenceSummary: row.basic_situation || '',
          basicSituation: row.basic_situation || '',
          background: row.background_context || '',
          importanceJudgement: row.importance_judgement || '',
          riskToUs: row.risk_to_us ? [row.risk_to_us] : [],
          suggestedAngles: ['基于每日动态感知事件继续生成拟稿提纲'],
        }),
      ],
    );
    const eventId = String(eventResult.rows[0]?.event_id || '');
    for (const source of this.normalizeSources(this.asArray(row.source_info))) {
      await pool.query(
        `INSERT INTO event_sources
          (event_id, owner_id, source_title, source_url, publisher, author, published_at, content_text,
           source_summary, relevance_reason, supported_facts, supported_attitudes, credibility_score)
         VALUES ($1,$2,$3,$4,$5,'',$6,$7,$8,$9,'[]'::jsonb,'[]'::jsonb,$10)`,
        [
          eventId,
          user.id,
          source.title || row.event_title,
          source.url || null,
          source.publisher || '',
          this.nullableDate(source.publishedAt),
          '',
          source.title || '',
          '每日动态感知入选事件来源',
          0.75,
        ],
      );
    }
    return { eventId };
  }

  private async classifyBatch(candidates: Array<{ candidateId: string; title: string; summaryText: string; sources: DailyAwarenessSourceInfo[]; relatedMaterialIds: string[] }>, categories: string[]) {
    const client = this.getLlm();
    const categoryList = (categories.length ? [...categories, '其他'] : DEFAULT_CATEGORIES).join('、');
    const completion = await client.chat.completions.create({
      model: this.model(),
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            '你是每日动态感知分析员。请只输出 JSON。',
            '必须为每条候选事件分类、摘要、评分，并保留 candidateId。',
            'importanceScore 和 riskScore 范围均为 0 到 100。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            categories: categoryList,
            outputSchema: {
              events: [{
                candidateId: '',
                eventTitle: '',
                category: '',
                region: '',
                basicSituation: '',
                backgroundContext: '',
                importanceJudgement: '',
                riskToUs: '',
                importanceScore: 0,
                riskScore: 0,
                sourceInfo: [{ title: '', publisher: '', publishedAt: '', url: '' }],
              }],
            },
            candidates,
          }),
        },
      ],
    });
    const content = completion.choices[0]?.message?.content || '{}';
    const parsed = extractJsonObject(content) as { events?: unknown[] };
    const byCandidate = new Map(candidates.map((item) => [item.candidateId, item]));
    return (Array.isArray(parsed.events) ? parsed.events : []).map((item) => {
      const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const candidateId = this.text(raw.candidateId, 128);
      const candidate = byCandidate.get(candidateId);
      return {
        candidateId,
        eventTitle: this.text(raw.eventTitle, 512) || candidate?.title || '未命名事件',
        category: this.text(raw.category, 128) || '其他',
        region: this.text(raw.region, 128),
        basicSituation: this.text(raw.basicSituation, 4000),
        backgroundContext: this.text(raw.backgroundContext, 4000),
        importanceJudgement: this.text(raw.importanceJudgement, 3000),
        riskToUs: this.text(raw.riskToUs, 3000),
        importanceScore: clampScore(raw.importanceScore),
        riskScore: clampScore(raw.riskScore),
        sourceInfo: this.normalizeSources(Array.isArray(raw.sourceInfo) ? raw.sourceInfo : candidate?.sources || []),
        relatedMaterialIds: candidate?.relatedMaterialIds || [],
      };
    }).filter((event) => event.eventTitle);
  }

  private async generateSummary(date: string, events: DailyAwarenessScoredEvent[], stats: Array<{ category: string; count: number }>) {
    const client = this.getLlm();
    const completion = await client.chat.completions.create({
      model: this.model(),
      temperature: 0.2,
      messages: [
        { role: 'system', content: '你是每日动态简报编辑。请用中文输出一段 300 字以内的总体摘要，不要输出 JSON。' },
        { role: 'user', content: JSON.stringify({ date, categoryStats: stats, topEvents: events.slice(0, 12) }) },
      ],
    });
    return this.text(completion.choices[0]?.message?.content || '', 1200);
  }

  private async loadBriefForUser(briefId: string, user: AuthUser) {
    const pool = await this.getPool();
    const rows = await pool.query(
      `SELECT b.*, u.username AS owner_username
         FROM daily_briefs b
         LEFT JOIN users u ON u.id = b.owner_id
        WHERE b.brief_id = $1`,
      [this.requiredId(briefId, 'briefId')],
    );
    const row = rows.rows[0] as unknown as DailyAwarenessBriefRow | undefined;
    if (!row) throw new NotFoundException({ error: 'Daily brief not found' });
    if (user.role !== 'admin' && String(row.owner_id) !== user.id) {
      throw new ForbiddenException({ error: 'No permission to access this daily brief' });
    }
    return this.toBrief(row, user.role === 'admin');
  }

  private async loadEventsForBrief(briefId: string, user: AuthUser, query: { page?: unknown; pageSize?: unknown; category?: unknown }) {
    const page = this.clampNumber(query.page, 1, 1, 100000);
    const pageSize = this.clampNumber(query.pageSize, 100, 1, 200);
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [briefId];
    const where = ['brief_id = $1'];
    if (user.role !== 'admin') {
      params.push(user.id);
      where.push(`owner_id = $${params.length}`);
    }
    const category = this.text(query.category, 128);
    if (category) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    const pool = await this.getPool();
    const countResult = await pool.query(`SELECT count(*)::int AS count FROM daily_brief_events WHERE ${where.join(' AND ')}`, params);
    const rows = await pool.query(
      `SELECT * FROM daily_brief_events
        WHERE ${where.join(' AND ')}
        ORDER BY rank_no ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    return {
      items: rows.rows.map((row) => this.toEvent(row as unknown as DailyAwarenessEventRow)),
      page,
      pageSize,
      total: Number(countResult.rows[0]?.count || 0),
    };
  }

  private toBrief(row: DailyAwarenessBriefRow, includeOwner: boolean) {
    const contentJson = this.asObject(row.content_json);
    const generation = this.asObject(contentJson.generation);
    return {
      briefId: String(row.brief_id || ''),
      ownerId: includeOwner ? String(row.owner_id || '') : undefined,
      ownerUsername: includeOwner ? String(row.owner_username || '') : undefined,
      briefDate: this.dateOnly(row.brief_date),
      title: String(row.title || ''),
      summary: String(row.summary || ''),
      status: String(row.status || ''),
      totalCandidates: Number(row.total_candidates || 0),
      selectedCount: Number(row.selected_count || 0),
      categories: this.asArray(row.categories),
      contentJson,
      candidateMaterialCount: Number(generation.candidateMaterialCount || 0),
      candidateEventCount: Number(generation.candidateEventCount || row.total_candidates || 0),
      selectedEventCount: Number(row.selected_count || 0),
      usedFallback: Boolean(generation.usedFallback),
      fallbackReason: String(generation.fallbackReason || ''),
      createdAt: this.dateString(row.created_at),
      updatedAt: this.dateString(row.updated_at),
    };
  }

  private toEvent(row: DailyAwarenessEventRow) {
    return {
      itemId: String(row.item_id || ''),
      briefId: String(row.brief_id || ''),
      rankNo: Number(row.rank_no || 0),
      eventTitle: String(row.event_title || ''),
      category: String(row.category || '其他'),
      region: String(row.region || ''),
      basicSituation: String(row.basic_situation || ''),
      backgroundContext: String(row.background_context || ''),
      importanceJudgement: String(row.importance_judgement || ''),
      riskToUs: String(row.risk_to_us || ''),
      sourceInfo: this.normalizeSources(this.asArray(row.source_info)),
      relatedMaterialIds: this.asArray(row.related_material_ids),
      importanceScore: Number(row.importance_score || 0),
      riskScore: Number(row.risk_score || 0),
      createdAt: this.dateString(row.created_at),
    };
  }

  private getLlm(): OpenAI {
    const apiKey = REPORT_AGENT_API_KEY || DIRECT_QA_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException({ error: 'LLM api key is not configured' });
    if (!this.llm) {
      this.llm = new OpenAI({
        apiKey,
        baseURL: REPORT_AGENT_BASE_URL || DIRECT_QA_BASE_URL,
      });
    }
    return this.llm;
  }

  private model(): string {
    return REPORT_AGENT_MODEL || DIRECT_QA_MODEL;
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }

  private normalizeSources(value: unknown): DailyAwarenessSourceInfo[] {
    return this.asArray(value).slice(0, 8).map((item) => {
      const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        title: this.text(raw.title, 512),
        publisher: this.text(raw.publisher, 256),
        publishedAt: this.text(raw.publishedAt, 128),
        url: this.text(raw.url, 2048),
      };
    });
  }

  private asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => this.text(item, 128)).filter(Boolean) : [];
  }

  private requiredDate(value: unknown): string {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BadRequestException({ error: 'date must be formatted as YYYY-MM-DD' });
    return text;
  }

  private requiredId(value: unknown, label: string): string {
    const text = String(value || '').trim();
    if (!text) throw new BadRequestException({ error: `${label} is required` });
    return text.slice(0, 120);
  }

  private text(value: unknown, limit: number): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  private clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
  }

  private nullableDate(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  private dateOnly(value: unknown): string {
    const date = value instanceof Date ? value : new Date(String(value || ''));
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  }

  private dateString(value: unknown): string {
    const date = value instanceof Date ? value : new Date(String(value || ''));
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }

  private safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
      .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://***@')
      .replace(/api[_-]?key[=:]\s*[^,\s]+/gi, 'api_key=***')
      .slice(0, 300);
  }
}
