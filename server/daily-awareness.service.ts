import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
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
import type {
  DailyAwarenessComposedBrief,
  DailyAwarenessConfig,
  DailyAwarenessPreparedMaterials,
} from './daily-awareness.contracts.js';
import {
  dailyAwarenessClassificationSystemPrompt,
  dailyAwarenessSummarySystemPrompt,
} from './daily-awareness-prompt.js';
import {
  buildDailyReportJson,
  buildDailyReportMarkdown,
  buildDailyAwarenessScoringPayload,
  applyDailyAwarenessScores,
  buildEventCandidates,
  categoryStats,
  clampScore,
  dailyReportTitle,
  dedupeMaterials,
  extractJsonObject,
  formatPublishedDate,
  rankDailyEvents,
  sanitizeSourceText,
  selectClassificationCandidates,
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
const CLASSIFICATION_BATCH_SIZE = 40;
const CLASSIFICATION_CONCURRENCY = 3;
const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

@Injectable()
export class DailyAwarenessService implements OnModuleDestroy {
  private pool: PgPool | null = null;
  private llm: OpenAI | null = null;

  constructor(private readonly vectorSources: VectorSourceService) {}

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async generate(input: DailyAwarenessGenerateInput, user: AuthUser) {
    if (!this.hasPermission(user, 'daily_awareness:create')) throw new ForbiddenException({ error: 'Insufficient daily awareness create permissions' });
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
    const classificationSelection = selectClassificationCandidates(allCandidates, maxItems);
    const candidates = classificationSelection.items;
    if (!candidates.length) {
      throw new BadRequestException({
        error: '信源库中未检索到可用于每日动态感知的材料，请检查 PGVector 信源库是否有数据，或扩大回溯范围。',
        diagnostics,
      });
    }

    const batchErrors: string[] = [];
    const scoredEvents: DailyAwarenessScoredEvent[] = [];
    await this.classifyBatches(candidates, categories, scoredEvents, batchErrors);
    if (!scoredEvents.length) {
      throw new ServiceUnavailableException({ error: '每日简报生成失败：模型未返回可用事件', batchErrors });
    }

    const ranked = rankDailyEvents(scoredEvents, maxItems);
    const stats = categoryStats(ranked);
    const summary = await this.generateSummary(date, ranked, stats).catch(() => {
      return `${date} 每日动态简报共筛选 ${ranked.length} 条重点新闻，涉及 ${stats.map((item) => item.category).join('、') || '多个'}领域。`;
    });
    const title = dailyReportTitle(date, diagnostics.usedFallback);
    const reportJson = buildDailyReportJson(ranked);
    const reportMarkdown = buildDailyReportMarkdown({
      date,
      title,
      summary,
      materialCount: materials.length,
      selectedCount: ranked.length,
      categoryStats: stats,
      events: ranked,
      usedFallback: diagnostics.usedFallback,
    });
    const categoryDistribution = Object.fromEntries(stats.map((item) => [item.category, item.count]));
    const contentJson = {
      briefDate: date,
      title,
      summary,
      reportMarkdown,
      reportJson,
      categoryDistribution,
      generation: {
        lookbackHours,
        keyword,
        region,
        requestedCategories: categories,
        candidateMaterialCount: materials.length,
        dedupedMaterialCount: deduped.length,
        candidateEventCount: candidates.length,
        totalCandidateEventCount: allCandidates.length,
        classificationCandidateLimit: classificationSelection.limit,
        classificationBatchSize: CLASSIFICATION_BATCH_SIZE,
        classificationConcurrency: CLASSIFICATION_CONCURRENCY,
        selectedEventCount: ranked.length,
        selectedNewsCount: ranked.length,
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
    const brief = this.toBrief(briefResult.rows[0] as unknown as DailyAwarenessBriefRow, this.isAdmin(user));
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

  async composeGlobalBrief(
    date: string,
    prepared: DailyAwarenessPreparedMaterials,
    config: DailyAwarenessConfig,
  ): Promise<DailyAwarenessComposedBrief> {
    const maxItems = Math.max(1, Math.min(50, config.maxArticles || 50));
    const selection = { items: prepared.candidates, limit: prepared.candidates.length };
    if (!selection.items.length) throw new ServiceUnavailableException({ error: 'No usable daily awareness candidates' });
    const batchErrors: string[] = [];
    const scoredEvents: DailyAwarenessScoredEvent[] = [];
    const titleOnly = true;
    await this.classifyBatches(selection.items, config.categoryScope, scoredEvents, batchErrors, titleOnly);
    if (!scoredEvents.length) {
      throw new ServiceUnavailableException({ error: 'Daily awareness model returned no usable events', batchErrors });
    }
    const events = rankDailyEvents(scoredEvents, maxItems);
    const stats = categoryStats(events);
    const summary = await this.generateSummary(date, events, stats, titleOnly);
    const title = dailyReportTitle(date, false);
    const reportJson = buildDailyReportJson(events);
    const reportMarkdown = buildDailyReportMarkdown({
      date,
      title,
      summary,
      materialCount: prepared.sourceCount,
      selectedCount: events.length,
      categoryStats: stats,
      events,
      usedFallback: false,
    });
    return {
      title,
      summary,
      reportMarkdown,
      contentJson: {
        briefDate: date,
        title,
        summary,
        reportMarkdown,
        reportJson,
        categoryDistribution: Object.fromEntries(stats.map((item) => [item.category, item.count])),
        categoryStats: stats,
        generation: {
          qualityStatus: prepared.qualityStatus,
          sourceCount: prepared.sourceCount,
          summaryCount: prepared.summaryCount,
          titleOnlyCount: prepared.titleOnlyCount,
          skippedCount: prepared.skippedCount,
          selectedCount: events.length,
          diagnostics: prepared.diagnostics,
          batchErrors,
        },
      },
      categoryStats: stats,
      events,
    };
  }

  async listBriefs(query: { page?: unknown; pageSize?: unknown; date?: unknown }, user: AuthUser) {
    const page = this.clampNumber(query.page, 1, 1, 100000);
    const pageSize = this.clampNumber(query.pageSize, 20, 1, 100);
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [];
    const where: string[] = [];
    if (!this.isAdmin(user)) {
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
      items: rows.rows.map((row) => this.toBrief(row as unknown as DailyAwarenessBriefRow, this.isAdmin(user))),
      page,
      pageSize,
      total: Number(countResult.rows[0]?.count || 0),
    };
  }

  async getBrief(briefId: string, user: AuthUser) {
    const brief = await this.loadBriefForUser(briefId, user);
    const events = await this.loadEventsForBrief(brief.briefId, user, {}, brief.publicationScope === 'GLOBAL');
    return { brief, events };
  }

  async listEvents(briefId: string, query: { page?: unknown; pageSize?: unknown; category?: unknown }, user: AuthUser) {
    const brief = await this.loadBriefForUser(briefId, user);
    return this.loadEventsForBrief(brief.briefId, user, query, brief.publicationScope === 'GLOBAL');
  }

  async downloadBrief(briefId: string, user: AuthUser, format = 'docx') {
    const normalizedFormat = String(format || 'docx').toLowerCase();
    if (normalizedFormat === 'pdf') {
      throw new BadRequestException({ error: 'PDF export is not supported yet. Please use format=docx.' });
    }
    if (normalizedFormat !== 'docx') {
      throw new BadRequestException({ error: 'Unsupported download format. Use format=docx.' });
    }

    const brief = await this.loadBriefForUser(briefId, user);
    const eventResult = await this.loadEventsForBrief(brief.briefId, user, { page: 1, pageSize: 200 }, brief.publicationScope === 'GLOBAL');
    const events = eventResult.items as Array<Record<string, unknown>>;
    const buffer = await this.buildBriefDocx(brief, events);
    return {
      buffer,
      contentType: DOCX_CONTENT_TYPE,
      filename: `${this.safeFilename(`${brief.briefDate || 'daily'}-每日动态简报`)}.docx`,
    };
  }

  async importEventToDraft(itemId: string, user: AuthUser) {
    if (!this.hasPermission(user, 'daily-awareness:view') || !this.hasPermission(user, 'draft_assistant:create')) {
      throw new ForbiddenException({ error: 'Insufficient daily awareness import permissions' });
    }
    const pool = await this.getPool();
    const rows = await pool.query(
      `SELECT e.*, b.brief_date, b.publication_scope
         FROM daily_brief_events e
         JOIN daily_briefs b ON b.brief_id = e.brief_id
        WHERE e.item_id = $1`,
      [this.requiredId(itemId, 'itemId')],
    );
    const row = rows.rows[0] as unknown as (DailyAwarenessEventRow & { brief_date?: string; publication_scope?: string }) | undefined;
    if (!row) throw new NotFoundException({ error: 'Daily event not found' });
    if (String(row.publication_scope || 'LEGACY') !== 'GLOBAL' && !this.isAdmin(user) && String(row.owner_id) !== user.id) {
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
      briefContent: row.basic_situation,
      publisher: this.normalizeSources(this.asArray(row.source_info))[0]?.publisher || '',
      sourceUrl: this.normalizeSources(this.asArray(row.source_info))[0]?.url || '',
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
          suggestedAngles: ['基于每日动态简报入选新闻继续生成拟稿提纲'],
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
          '每日动态简报入选新闻来源',
          0.75,
        ],
      );
    }
    return { eventId };
  }

  private async classifyBatches(
    candidates: Array<{ candidateId: string; title: string; summaryText: string; category: string; tag: string; sources: DailyAwarenessSourceInfo[]; relatedMaterialIds: string[] }>,
    categories: string[],
    output: DailyAwarenessScoredEvent[],
    batchErrors: string[],
    titleOnly = false,
  ) {
    const batches: Array<{ index: number; items: typeof candidates }> = [];
    for (let index = 0; index < candidates.length; index += CLASSIFICATION_BATCH_SIZE) {
      batches.push({ index: Math.floor(index / CLASSIFICATION_BATCH_SIZE) + 1, items: candidates.slice(index, index + CLASSIFICATION_BATCH_SIZE) });
    }
    for (let index = 0; index < batches.length; index += CLASSIFICATION_CONCURRENCY) {
      const group = batches.slice(index, index + CLASSIFICATION_CONCURRENCY);
      const results = await Promise.allSettled(group.map((batch) => this.classifyBatch(batch.items, categories, titleOnly)));
      results.forEach((result, resultIndex) => {
        const batch = group[resultIndex];
        if (result.status === 'fulfilled') output.push(...result.value);
        else batchErrors.push(`batch ${batch.index}: ${this.safeError(result.reason)}`);
      });
    }
  }

  private async classifyBatch(candidates: Array<{ candidateId: string; title: string; summaryText: string; category: string; tag: string; sources: DailyAwarenessSourceInfo[]; relatedMaterialIds: string[] }>, categories: string[], titleOnly = false) {
    const client = this.getLlm();
    const categoryList = (categories.length ? [...categories, '其他'] : DEFAULT_CATEGORIES).join('、');
    const completion = await client.chat.completions.create({
      model: this.model(),
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: dailyAwarenessClassificationSystemPrompt(titleOnly),
        },
        {
          role: 'user',
          content: JSON.stringify({
            categories: categoryList,
            outputSchema: { scores: [{ candidateId: '', importanceScore: 0, riskScore: 0 }] },
            candidates: buildDailyAwarenessScoringPayload(candidates),
          }),
        },
      ],
    });
    const content = completion.choices[0]?.message?.content || '{}';
    const parsed = extractJsonObject(content) as { scores?: unknown[]; topNews?: unknown[]; events?: unknown[] };
    const items = Array.isArray(parsed.scores) ? parsed.scores : Array.isArray(parsed.topNews) ? parsed.topNews : Array.isArray(parsed.events) ? parsed.events : [];
    return applyDailyAwarenessScores(candidates, items.map((item) => item && typeof item === 'object' ? item as Record<string, unknown> : {}));
  }

  private async generateSummary(date: string, events: DailyAwarenessScoredEvent[], stats: Array<{ category: string; count: number }>, titleOnly = false) {
    const client = this.getLlm();
    const completion = await client.chat.completions.create({
      model: this.model(),
      temperature: 0.2,
      messages: [
        { role: 'system', content: dailyAwarenessSummarySystemPrompt(titleOnly) },
        { role: 'user', content: JSON.stringify({ date, categoryStats: stats, topNews: events.slice(0, 12) }) },
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
    if (String(row.publication_scope || 'LEGACY') !== 'GLOBAL' && !this.isAdmin(user) && String(row.owner_id) !== user.id) {
      throw new ForbiddenException({ error: 'No permission to access this daily brief' });
    }
    return this.toBrief(row, this.isAdmin(user));
  }

  private async loadEventsForBrief(briefId: string, user: AuthUser, query: { page?: unknown; pageSize?: unknown; category?: unknown }, global = false) {
    const page = this.clampNumber(query.page, 1, 1, 100000);
    const pageSize = this.clampNumber(query.pageSize, 100, 1, 200);
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [briefId];
    const where = ['brief_id = $1'];
    if (!global && !this.isAdmin(user)) {
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
      reportMarkdown: String(contentJson.reportMarkdown || ''),
      reportJson: this.asObject(contentJson.reportJson),
      selectedNewsCount: Number(generation.selectedNewsCount || row.selected_count || 0),
      categoryDistribution: this.asObject(contentJson.categoryDistribution),
      candidateMaterialCount: Number(generation.candidateMaterialCount || 0),
      candidateEventCount: Number(generation.candidateEventCount || row.total_candidates || 0),
      selectedEventCount: Number(row.selected_count || 0),
      usedFallback: Boolean(generation.usedFallback),
      fallbackReason: String(generation.fallbackReason || ''),
      publicationScope: String(row.publication_scope || 'LEGACY'),
      qualityStatus: String(row.quality_status || ''),
      contentMarkdown: String(row.content_markdown || contentJson.reportMarkdown || ''),
      generatedAt: this.dateString(row.generated_at || row.updated_at),
      generatedByType: String(row.generated_by_type || 'SYSTEM'),
      createdAt: this.dateString(row.created_at),
      updatedAt: this.dateString(row.updated_at),
    };
  }

  private toEvent(row: DailyAwarenessEventRow) {
    const sourceInfo = this.normalizeSources(this.asArray(row.source_info));
    const primarySource = sourceInfo[0] || { title: '', publisher: '', publishedAt: '', url: '' };
    return {
      itemId: String(row.item_id || ''),
      briefId: String(row.brief_id || ''),
      rankNo: Number(row.rank_no || 0),
      rank: Number(row.rank_no || 0),
      eventTitle: String(row.event_title || ''),
      title: String(row.event_title || ''),
      category: String(row.category || '其他'),
      region: String(row.region || ''),
      basicSituation: String(row.basic_situation || ''),
      briefContent: String(row.basic_situation || ''),
      backgroundContext: String(row.background_context || ''),
      importanceJudgement: String(row.importance_judgement || ''),
      riskToUs: String(row.risk_to_us || ''),
      sourceInfo,
      publisher: primarySource.publisher || '',
      publishedAt: primarySource.publishedAt || '',
      sourceUrl: primarySource.url || '',
      sourceCount: sourceInfo.length,
      relatedMaterialIds: this.asArray(row.related_material_ids),
      importanceScore: Number(row.importance_score || 0),
      riskScore: Number(row.risk_score || 0),
      createdAt: this.dateString(row.created_at),
    };
  }

  private async buildBriefDocx(brief: Record<string, unknown>, events: Array<Record<string, unknown>>) {
    const title = this.text(brief.title || `${brief.briefDate || ''} 每日动态简报`, 256) || '每日动态简报';
    const summary = this.text(brief.summary, 3000) || this.buildFallbackSummary(brief, events);
    const categories = this.normalizeCategoryStats(brief.categories || brief.contentJson && (brief.contentJson as Record<string, unknown>).categoryStats, events);
    const children: Paragraph[] = [
      new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
      this.metaParagraph(`简报日期：${this.text(brief.briefDate, 32) || '--'}`),
      this.metaParagraph(`生成时间：${this.formatExportTime(brief.createdAt)}`),
      new Paragraph({ text: '一、今日概览', heading: HeadingLevel.HEADING_1 }),
      this.bodyParagraph(summary),
      new Paragraph({ text: '二、分类分布', heading: HeadingLevel.HEADING_1 }),
    ];

    if (categories.length) {
      for (const item of categories) children.push(this.bulletParagraph(`${item.category}：${item.count} 条`));
    } else {
      children.push(this.bodyParagraph('暂无分类统计。'));
    }

    children.push(new Paragraph({ text: '三、重点新闻列表', heading: HeadingLevel.HEADING_1 }));
    for (const event of events) {
      const source = this.primaryEventSource(event);
      const rank = Number(event.rank || event.rankNo || 0);
      const titleText = this.text(event.title || event.eventTitle, 512) || '未命名新闻';
      const category = this.text(event.category, 128) || '其他';
      const importance = Number(event.importanceScore || 0);
      const briefContent = this.text(event.briefContent || event.basicSituation, 4000) || '暂无简要内容。';
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: `${rank ? `${rank}. ` : ''}${titleText}`, bold: true })],
      }));
      children.push(this.metaParagraph(`分类：${category}｜重要性：${importance.toFixed(0)}｜来源：${source.publisher || '来源未知'}｜发布时间：${formatPublishedDate(source.publishedAt)}`));
      children.push(this.bodyParagraph(`简要内容：${briefContent}`));
      if (source.url) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: '来源链接：', bold: true }),
            new ExternalHyperlink({
              link: source.url,
              children: [new TextRun({ text: source.url, style: 'Hyperlink' })],
            }),
          ],
        }));
      }
    }

    children.push(
      new Paragraph({ text: '四、可进一步研判方向', heading: HeadingLevel.HEADING_1 }),
      this.bulletParagraph('可围绕高频分类中的重点新闻形成专题编报。'),
      this.bulletParagraph('可选择单条新闻导入拟稿助手开展深度分析。'),
      this.bulletParagraph('正式编报前建议复核关键时间、主体表态和来源链接。'),
    );

    const document = new Document({
      sections: [{ properties: {}, children }],
    });
    return Packer.toBuffer(document);
  }

  private metaParagraph(text: string) {
    return new Paragraph({
      children: [new TextRun({ text, color: '475569', size: 20 })],
      spacing: { after: 120 },
    });
  }

  private bodyParagraph(text: string) {
    return new Paragraph({
      children: [new TextRun({ text })],
      spacing: { after: 180 },
    });
  }

  private bulletParagraph(text: string) {
    return new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text })],
      spacing: { after: 100 },
    });
  }

  private buildFallbackSummary(brief: Record<string, unknown>, events: Array<Record<string, unknown>>) {
    const selected = Number(brief.selectedNewsCount || brief.selectedCount || events.length || 0);
    const materialCount = Number(brief.candidateMaterialCount || 0);
    const categories = this.normalizeCategoryStats(brief.categories, events).map((item) => item.category).slice(0, 5);
    return `今日共从 ${materialCount} 条候选新闻中筛选出 ${selected} 条重点新闻，主要集中在${categories.join('、') || '多个'}领域。`;
  }

  private normalizeCategoryStats(value: unknown, events: Array<Record<string, unknown>>): Array<{ category: string; count: number }> {
    const fromValue = this.asArray(value)
      .map((item) => {
        const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        return { category: this.text(raw.category, 128), count: Number(raw.count || 0) };
      })
      .filter((item) => item.category && item.count > 0);
    if (fromValue.length) return fromValue;
    const counts = new Map<string, number>();
    for (const event of events) {
      const category = this.text(event.category, 128) || '其他';
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    return [...counts.entries()].map(([category, count]) => ({ category, count }));
  }

  private primaryEventSource(event: Record<string, unknown>): DailyAwarenessSourceInfo {
    const sources = this.normalizeSources(this.asArray(event.sourceInfo));
    const source = sources[0] || { title: '', publisher: '', publishedAt: '', url: '' };
    return {
      title: source.title || sanitizeSourceText(this.text(event.title || event.eventTitle, 512)),
      publisher: sanitizeSourceText(this.text(event.publisher, 256)) || source.publisher,
      publishedAt: this.text(event.publishedAt, 128) || source.publishedAt,
      url: this.text(event.sourceUrl, 2048) || source.url,
    };
  }

  private formatExportTime(value: unknown) {
    const date = new Date(String(value || ''));
    return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '--';
  }

  private safeFilename(value: string) {
    return String(value || 'daily-awareness').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').slice(0, 120);
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
        title: sanitizeSourceText(this.text(raw.title, 512)),
        publisher: sanitizeSourceText(this.text(raw.publisher, 256)),
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

  private isAdmin(user: AuthUser): boolean {
    return user.role === 'admin' || user.roles?.includes('admin') === true;
  }

  private hasPermission(user: AuthUser, permission: string): boolean {
    return user.permissions?.includes(permission) === true;
  }
}
