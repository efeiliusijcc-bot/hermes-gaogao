import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
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
  HERMES_API_KEY,
  HERMES_BASE_URL,
  HERMES_MODEL,
  REPORT_AGENT_API_KEY,
  REPORT_AGENT_BASE_URL,
  REPORT_AGENT_MODEL,
} from './config.js';
import type {
  DraftAnalysisJson,
  DraftAnalyzeInput,
  DraftAttitude,
  DraftEventSummary,
  DraftOutlineInput,
  DraftOutlineJson,
  DraftOutlineManualInput,
  DraftOutlineRefineInput,
  DraftSourceResponse,
} from './draft-assistant.types.js';
import type { VectorSourceItem } from './vector-source.service.js';
import { VectorSourceService } from './vector-source.service.js';

const OUTLINE_KEYS: Array<keyof DraftOutlineJson> = [
  'reportTitle',
  'reportTheme',
  'coreJudgement',
  'mainContentPlan',
  'attitudesPlan',
  'riskPlan',
  'trendPlan',
  'sourceRequirements',
  'writingConstraints',
  'uncertaintiesToVerify',
];

const DEFAULT_ANALYSIS: DraftAnalysisJson = {
  oneSentenceSummary: '',
  basicSituation: '',
  background: '',
  timeline: [],
  keyActors: [],
  mainFacts: [],
  attitudes: [],
  riskToUs: [],
  importanceJudgement: '',
  uncertainties: [],
  suggestedAngles: [],
};

@Injectable()
export class DraftAssistantService implements OnModuleDestroy {
  private pool: PgPool | null = null;
  private llm: OpenAI | null = null;

  constructor(private readonly vectorSources: VectorSourceService) {}

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async analyze(input: DraftAnalyzeInput, user: AuthUser) {
    const title = this.requiredText(input.title, 'title', 512);
    const materials = this.text(input.materials, 20000);
    const category = this.text(input.category, 128);
    const region = this.text(input.region, 128);
    const links = this.normalizeLinks(input.links);
    const maxRows = this.clampNumber(input.maxRows, 12, 1, 30);
    const lookbackDays = this.clampNumber(input.lookbackDays, 365, 0, 3650);
    const pool = await this.getPool();

    const eventResult = await pool.query(
      `INSERT INTO events (owner_id, title, category, region, raw_input)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING event_id`,
      [user.id, title, category || null, region || null, JSON.stringify({ title, materials, links, category, region })],
    );
    const eventId = String(eventResult.rows[0]?.event_id || '');

    const vectorResult = await this.vectorSources.search({
      topic: title,
      knownContext: { materials, links, category, region },
      maxRows,
      lookbackDays,
    });
    await this.insertVectorSources(eventId, user.id, vectorResult.sources);
    await this.insertLinkSources(eventId, user.id, links);

    try {
      const sources = await this.listSources(eventId);
      const analysis = await this.generateAnalysis({ title, materials, category, region, sources });
      const normalizedAnalysis = this.normalizeAnalysis(analysis);
      await this.updateEventAnalysis(eventId, normalizedAnalysis);
      await this.replaceAttitudes(eventId, user.id, normalizedAnalysis.attitudes);

      return {
        eventId,
        analysis: normalizedAnalysis,
        sources: await this.listSources(eventId),
      };
    } catch (error) {
      await this.deleteEventQuietly(eventId);
      throw error;
    }
  }

  async listEvents(user: AuthUser, pageInput?: unknown, pageSizeInput?: unknown): Promise<{ items: DraftEventSummary[]; page: number; pageSize: number; total: number }> {
    const page = this.clampNumber(pageInput, 1, 1, 100000);
    const pageSize = this.clampNumber(pageSizeInput, 20, 1, 100);
    const offset = (page - 1) * pageSize;
    const pool = await this.getPool();
    const params: unknown[] = [];
    const where = user.role === 'admin' ? '' : 'WHERE e.owner_id = $1';
    if (user.role !== 'admin') params.push(user.id);
    const countResult = await pool.query(`SELECT count(*)::int AS count FROM events e ${where}`, params);
    const rows = await pool.query(
      `SELECT e.event_id, e.title, e.summary, e.category, e.region, e.importance_score, e.risk_score,
              e.created_at, u.username AS owner_username
         FROM events e
         LEFT JOIN users u ON u.id = e.owner_id
         ${where}
        ORDER BY e.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    return {
      items: rows.rows.map((row) => this.toEventSummary(row, user.role === 'admin')),
      page,
      pageSize,
      total: Number(countResult.rows[0]?.count || 0),
    };
  }

  async getEvent(eventId: string, user: AuthUser) {
    const event = await this.loadEventForUser(eventId, user);
    const sources = await this.listSources(event.eventId);
    const attitudes = await this.listAttitudes(event.eventId);
    const outlines = await this.listOutlines(event.eventId, user);
    return {
      event,
      sources,
      attitudes,
      latestOutline: outlines[0] || null,
    };
  }

  async generateOutline(input: DraftOutlineInput, user: AuthUser) {
    const eventId = this.requiredText(input.eventId, 'eventId', 80);
    const event = await this.loadEventForUser(eventId, user);
    const sources = await this.listSources(eventId);
    const attitudes = await this.listAttitudes(eventId);
    const outline = this.normalizeOutline(await this.generateOutlineJson({
      mode: 'create',
      event,
      sources,
      attitudes,
      preference: this.text(input.outlinePreference, 4000),
    }));
    return this.insertOutline(eventId, event.ownerId, outline, {
      editType: 'ai',
      userFeedback: this.text(input.outlinePreference, 4000),
      parentOutlineId: null,
    });
  }

  async refineOutline(input: DraftOutlineRefineInput, user: AuthUser) {
    const outlineId = this.requiredText(input.outlineId, 'outlineId', 80);
    const feedback = this.requiredText(input.userFeedback, 'userFeedback', 4000);
    const current = await this.loadOutlineForUser(outlineId, user);
    const event = await this.loadEventForUser(current.eventId, user);
    const sources = await this.listSources(current.eventId);
    const attitudes = await this.listAttitudes(current.eventId);
    const outline = this.normalizeOutline(await this.generateOutlineJson({
      mode: 'refine',
      event,
      sources,
      attitudes,
      currentOutline: current.outline,
      preference: feedback,
    }));
    return this.insertOutline(current.eventId, current.ownerId, outline, {
      editType: 'ai_refine',
      userFeedback: feedback,
      parentOutlineId: current.outlineId,
    });
  }

  async manualUpdateOutline(input: DraftOutlineManualInput, user: AuthUser) {
    const outlineId = this.requiredText(input.outlineId, 'outlineId', 80);
    const current = await this.loadOutlineForUser(outlineId, user);
    const outline = this.normalizeOutline(input.outline || {});
    return this.insertOutline(current.eventId, current.ownerId, outline, {
      editType: 'manual',
      userFeedback: this.text(input.editNote, 4000),
      parentOutlineId: current.outlineId,
    });
  }

  async getOutline(outlineId: string, user: AuthUser) {
    const outline = await this.loadOutlineForUser(outlineId, user);
    const event = await this.loadEventForUser(outline.eventId, user);
    return {
      ...outline,
      event: {
        eventId: event.eventId,
        title: event.title,
        summary: event.summary,
        category: event.category,
        region: event.region,
      },
    };
  }

  async listOutlines(eventId: string, user: AuthUser) {
    await this.loadEventForUser(eventId, user);
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT outline_id, event_id, owner_id, version_no, title, outline_json, user_feedback, edit_type,
              parent_outline_id, created_at
         FROM report_outlines
        WHERE event_id = $1
        ORDER BY version_no DESC, created_at DESC`,
      [eventId],
    );
    return result.rows.map((row) => this.toOutlineResponse(row));
  }

  private async generateAnalysis(input: { title: string; materials: string; category: string; region: string; sources: DraftSourceResponse[] }): Promise<unknown> {
    const sourcePackage = input.sources.slice(0, 20).map((source, index) => ({
      index: index + 1,
      title: source.sourceTitle,
      url: source.sourceUrl,
      publisher: source.publisher,
      publishedAt: source.publishedAt,
      summary: source.sourceSummary,
      excerpt: source.contentText,
      relevanceReason: source.relevanceReason,
    }));
    const content = await this.callJsonLlm([
      {
        role: 'system',
        content:
          '你是一名开源情报分析师。你的任务不是直接撰写正式编报，而是对事件进行事实梳理、来源核查、各方态度归纳和涉我风险研判。不能仅根据标题推断事实，必须基于用户材料和数据库召回证据分析。不确定信息要标注待核实。只输出结构化 JSON。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'event_analysis',
          requiredShape: DEFAULT_ANALYSIS,
          attitudeShape: {
            actor: '',
            actorType: '',
            statementTime: null,
            media: null,
            sourceUrl: null,
            attitudeSummary: '',
            polarity: '',
            confidence: 0,
          },
          riskShape: {
            riskType: '',
            riskLevel: '',
            description: '',
            basis: '',
            uncertainty: '',
          },
          eventInput: {
            title: input.title,
            materials: input.materials,
            category: input.category,
            region: input.region,
          },
          evidencePackage: sourcePackage,
        }),
      },
    ]);
    return content;
  }

  private async generateOutlineJson(input: {
    mode: 'create' | 'refine';
    event: Record<string, unknown>;
    sources: DraftSourceResponse[];
    attitudes: DraftAttitude[];
    currentOutline?: DraftOutlineJson;
    preference?: string;
  }): Promise<unknown> {
    return this.callJsonLlm([
      {
        role: 'system',
        content:
          '你是一名开源情报编报策划员。基于事件分析、来源和各方态度生成编报提纲。不要写成稿，只输出 JSON，必须包含 reportTitle、reportTheme、coreJudgement、mainContentPlan、attitudesPlan、riskPlan、trendPlan、sourceRequirements、writingConstraints、uncertaintiesToVerify。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: input.mode === 'create' ? 'create_report_outline' : 'refine_report_outline',
          requiredKeys: OUTLINE_KEYS,
          event: input.event,
          sources: input.sources.slice(0, 20),
          attitudes: input.attitudes,
          currentOutline: input.currentOutline || null,
          userPreferenceOrFeedback: input.preference || '',
        }),
      },
    ]);
  }

  private async callJsonLlm(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<unknown> {
    const apiKey = REPORT_AGENT_API_KEY || DIRECT_QA_API_KEY || HERMES_API_KEY;
    const baseURL = REPORT_AGENT_API_KEY || DIRECT_QA_API_KEY
      ? (REPORT_AGENT_BASE_URL || DIRECT_QA_BASE_URL)
      : HERMES_BASE_URL;
    const model = REPORT_AGENT_API_KEY || DIRECT_QA_API_KEY
      ? (REPORT_AGENT_MODEL || DIRECT_QA_MODEL)
      : HERMES_MODEL;
    if (!apiKey) {
      throw new ServiceUnavailableException({ error: 'LLM API key is not configured' });
    }
    if (!this.llm) this.llm = new OpenAI({ apiKey, baseURL });
    const completion = await this.callChatCompletion({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages,
    });
    const text = completion.choices[0]?.message?.content || '';
    try {
      return this.parseJsonText(text);
    } catch {
      const repaired = await this.repairJson(text);
      try {
        return this.parseJsonText(repaired);
      } catch {
        throw new InternalServerErrorException({ error: 'LLM returned invalid JSON and repair failed' });
      }
    }
  }

  private async repairJson(text: string): Promise<string> {
    if (!this.llm) throw new InternalServerErrorException({ error: 'LLM client is not initialized' });
    const model = REPORT_AGENT_MODEL || DIRECT_QA_MODEL;
    const completion = await this.callChatCompletion({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你只负责把输入修复为合法 JSON。不要解释，不要添加 Markdown。' },
        { role: 'user', content: text.slice(0, 60000) },
      ],
    });
    return completion.choices[0]?.message?.content || '';
  }

  private async callChatCompletion(options: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming) {
    if (!this.llm) throw new ServiceUnavailableException({ error: 'LLM client is not initialized' });
    try {
      return await this.llm.chat.completions.create(options);
    } catch (error) {
      throw new ServiceUnavailableException({ error: this.llmErrorMessage(error) });
    }
  }

  private llmErrorMessage(error: unknown): string {
    const status = this.errorField(error, 'status');
    const code = this.errorField(error, 'code');
    const message = this.errorField(error, 'message') || this.errorField(this.errorField(error, 'error'), 'message');
    const text = [status, code, message].filter(Boolean).join(' ');
    if (/insufficient balance|余额不足/i.test(text)) {
      return '模型服务余额不足，拟稿助手暂时无法生成分析。请为 Hermes 上游模型账号充值，或配置可用的 REPORT_AGENT_API_KEY。';
    }
    if (/invalid api key|invalid_key|401|api key 无效/i.test(text)) {
      return '模型服务 API Key 无效，拟稿助手暂时无法生成分析。请配置可用的 REPORT_AGENT_API_KEY。';
    }
    if (/timeout|timed out/i.test(text)) {
      return '模型服务请求超时，请稍后重试。';
    }
    return `模型服务调用失败：${message || '未知错误'}`;
  }

  private errorField(source: unknown, field: string): string {
    if (!source || typeof source !== 'object' || !(field in source)) return '';
    const value = (source as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return '';
  }

  private parseJsonText(text: string): unknown {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('empty JSON');
    try {
      return JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('JSON object not found');
      return JSON.parse(match[0]);
    }
  }

  private normalizeAnalysis(value: unknown): DraftAnalysisJson {
    const raw = this.objectValue(value);
    return {
      oneSentenceSummary: this.text(raw.oneSentenceSummary, 2000),
      basicSituation: this.text(raw.basicSituation, 8000),
      background: this.text(raw.background, 8000),
      timeline: this.arrayValue(raw.timeline),
      keyActors: this.arrayValue(raw.keyActors),
      mainFacts: this.arrayValue(raw.mainFacts),
      attitudes: this.arrayValue(raw.attitudes).map((item) => this.normalizeAttitude(item)).filter((item) => item.actor && item.attitudeSummary),
      riskToUs: this.arrayValue(raw.riskToUs),
      importanceJudgement: this.text(raw.importanceJudgement, 4000),
      uncertainties: this.arrayValue(raw.uncertainties),
      suggestedAngles: this.arrayValue(raw.suggestedAngles),
    };
  }

  private normalizeAttitude(value: unknown): DraftAttitude {
    const raw = this.objectValue(value);
    return {
      actor: this.text(raw.actor, 255),
      actorType: this.nullableText(raw.actorType, 128),
      statementTime: this.nullableDate(raw.statementTime),
      media: this.nullableText(raw.media, 255),
      sourceUrl: this.nullableText(raw.sourceUrl, 2048),
      attitudeSummary: this.text(raw.attitudeSummary, 4000),
      polarity: this.text(raw.polarity, 64),
      confidence: this.clampNumber(raw.confidence, 0, 0, 1),
    };
  }

  private normalizeOutline(value: unknown): DraftOutlineJson {
    const raw = this.objectValue(value);
    const missing = OUTLINE_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(raw, key));
    if (missing.length) throw new BadRequestException({ error: `outline missing required keys: ${missing.join(', ')}` });
    return {
      reportTitle: this.requiredText(raw.reportTitle, 'reportTitle', 512),
      reportTheme: this.text(raw.reportTheme, 4000),
      coreJudgement: this.text(raw.coreJudgement, 4000),
      mainContentPlan: this.arrayValue(raw.mainContentPlan),
      attitudesPlan: this.arrayValue(raw.attitudesPlan),
      riskPlan: this.arrayValue(raw.riskPlan),
      trendPlan: this.arrayValue(raw.trendPlan),
      sourceRequirements: this.arrayValue(raw.sourceRequirements),
      writingConstraints: this.arrayValue(raw.writingConstraints),
      uncertaintiesToVerify: this.arrayValue(raw.uncertaintiesToVerify),
    };
  }

  private async updateEventAnalysis(eventId: string, analysis: DraftAnalysisJson) {
    const pool = await this.getPool();
    await pool.query(
      `UPDATE events
          SET summary = $2,
              basic_facts = $3::jsonb,
              timeline = $4::jsonb,
              actors = $5::jsonb,
              importance_score = $6,
              risk_score = $7,
              analysis_json = $8::jsonb,
              updated_at = now()
        WHERE event_id = $1`,
      [
        eventId,
        analysis.oneSentenceSummary || analysis.basicSituation,
        JSON.stringify(analysis.mainFacts),
        JSON.stringify(analysis.timeline),
        JSON.stringify(analysis.keyActors),
        this.scoreFromAnalysis(analysis.importanceJudgement),
        this.scoreFromRisk(analysis.riskToUs),
        JSON.stringify(analysis),
      ],
    );
  }

  private async replaceAttitudes(eventId: string, ownerId: string, attitudes: DraftAttitude[]) {
    const pool = await this.getPool();
    await pool.query('DELETE FROM event_attitudes WHERE event_id = $1', [eventId]);
    for (const attitude of attitudes) {
      await pool.query(
        `INSERT INTO event_attitudes
          (event_id, owner_id, actor, actor_type, statement_time, media, source_url, attitude_summary, attitude_polarity, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          eventId,
          ownerId,
          attitude.actor,
          attitude.actorType,
          attitude.statementTime,
          attitude.media,
          attitude.sourceUrl,
          attitude.attitudeSummary,
          attitude.polarity,
          attitude.confidence,
        ],
      );
    }
  }

  private async insertVectorSources(eventId: string, ownerId: string, sources: VectorSourceItem[]) {
    for (const source of sources) {
      await this.insertSource(eventId, ownerId, {
        sourceTitle: source.title,
        sourceUrl: source.url || null,
        publisher: source.websiteName,
        author: '',
        publishedAt: this.nullableDate(source.publishTime),
        contentText: source.contentExcerpt || source.summary || source.embeddingText || '',
        sourceSummary: source.summary || source.contentExcerpt || '',
        relevanceReason: `PG/pgvector 召回，相似度 ${source.similarity.toFixed(3)}，综合相关度 ${source.relevanceScore.toFixed(3)}`,
        supportedFacts: [],
        supportedAttitudes: [],
        credibilityScore: this.clampNumber(source.relevanceScore, 0, 0, 1),
      });
    }
  }

  private async insertLinkSources(eventId: string, ownerId: string, links: string[]) {
    for (const link of links) {
      await this.insertSource(eventId, ownerId, {
        sourceTitle: link,
        sourceUrl: link,
        publisher: '',
        author: '',
        publishedAt: null,
        contentText: '',
        sourceSummary: '链接内容待核实',
        relevanceReason: '用户提供相关链接，本阶段不自动抓取网页内容，链接内容待核实。',
        supportedFacts: [],
        supportedAttitudes: [],
        credibilityScore: 0,
      });
    }
  }

  private async insertSource(eventId: string, ownerId: string, source: Omit<DraftSourceResponse, 'sourceId' | 'createdAt'>) {
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO event_sources
        (event_id, owner_id, source_title, source_url, publisher, author, published_at, content_text,
         source_summary, relevance_reason, supported_facts, supported_attitudes, credibility_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)`,
      [
        eventId,
        ownerId,
        source.sourceTitle,
        source.sourceUrl,
        source.publisher,
        source.author,
        source.publishedAt,
        source.contentText,
        source.sourceSummary,
        source.relevanceReason,
        JSON.stringify(source.supportedFacts),
        JSON.stringify(source.supportedAttitudes),
        source.credibilityScore,
      ],
    );
  }

  private async insertOutline(
    eventId: string,
    ownerId: string,
    outline: DraftOutlineJson,
    options: { editType: 'ai' | 'ai_refine' | 'manual'; userFeedback: string; parentOutlineId: string | null },
  ) {
    const pool = await this.getPool();
    const result = await pool.query(
      `WITH next_version AS (
         SELECT COALESCE(max(version_no), 0) + 1 AS version_no
           FROM report_outlines
          WHERE event_id = $1
       )
       INSERT INTO report_outlines
        (event_id, owner_id, version_no, title, outline_json, user_feedback, edit_type, parent_outline_id)
       SELECT $1, $2, next_version.version_no, $3, $4::jsonb, $5, $6, $7
         FROM next_version
       RETURNING outline_id, event_id, owner_id, version_no, title, outline_json, user_feedback, edit_type,
                 parent_outline_id, created_at`,
      [
        eventId,
        ownerId,
        outline.reportTitle,
        JSON.stringify(outline),
        options.userFeedback || null,
        options.editType,
        options.parentOutlineId,
      ],
    );
    return this.toOutlineResponse(result.rows[0]);
  }

  private async deleteEventQuietly(eventId: string) {
    try {
      const pool = await this.getPool();
      await pool.query('DELETE FROM events WHERE event_id = $1', [eventId]);
    } catch {
      // Best effort cleanup. The original model error is more useful to callers.
    }
  }

  private async listSources(eventId: string): Promise<DraftSourceResponse[]> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT source_id, source_title, source_url, publisher, author, published_at, content_text,
              source_summary, relevance_reason, supported_facts, supported_attitudes, credibility_score, created_at
         FROM event_sources
        WHERE event_id = $1
        ORDER BY created_at ASC`,
      [eventId],
    );
    return result.rows.map((row) => this.toSourceResponse(row));
  }

  private async listAttitudes(eventId: string): Promise<DraftAttitude[]> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT actor, actor_type, statement_time, media, source_url, attitude_summary, attitude_polarity, confidence
         FROM event_attitudes
        WHERE event_id = $1
        ORDER BY created_at ASC`,
      [eventId],
    );
    return result.rows.map((row) => ({
      actor: String(row.actor || ''),
      actorType: row.actor_type ? String(row.actor_type) : null,
      statementTime: this.dateString(row.statement_time) || null,
      media: row.media ? String(row.media) : null,
      sourceUrl: row.source_url ? String(row.source_url) : null,
      attitudeSummary: String(row.attitude_summary || ''),
      polarity: String(row.attitude_polarity || ''),
      confidence: Number(row.confidence || 0),
    }));
  }

  private async loadEventForUser(eventId: string, user: AuthUser) {
    const id = this.requiredText(eventId, 'eventId', 80);
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT e.event_id, e.owner_id, e.title, e.summary, e.basic_facts, e.timeline, e.actors,
              e.category, e.region, e.importance_score, e.risk_score, e.raw_input, e.analysis_json,
              e.created_at, e.updated_at, u.username AS owner_username
         FROM events e
         LEFT JOIN users u ON u.id = e.owner_id
        WHERE e.event_id = $1
        LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ error: 'Event not found' });
    if (user.role !== 'admin' && String(row.owner_id) !== user.id) {
      throw new NotFoundException({ error: 'Event not found' });
    }
    return this.toEventDetail(row);
  }

  private async loadOutlineForUser(outlineId: string, user: AuthUser) {
    const id = this.requiredText(outlineId, 'outlineId', 80);
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT outline_id, event_id, owner_id, version_no, title, outline_json, user_feedback, edit_type,
              parent_outline_id, created_at
         FROM report_outlines
        WHERE outline_id = $1
        LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ error: 'Outline not found' });
    if (user.role !== 'admin' && String(row.owner_id) !== user.id) {
      throw new NotFoundException({ error: 'Outline not found' });
    }
    return this.toOutlineResponse(row);
  }

  private toEventSummary(row: Record<string, unknown>, includeOwner: boolean): DraftEventSummary {
    return {
      eventId: String(row.event_id || ''),
      title: String(row.title || ''),
      summary: String(row.summary || ''),
      category: String(row.category || ''),
      region: String(row.region || ''),
      importanceScore: Number(row.importance_score || 0),
      riskScore: Number(row.risk_score || 0),
      createdAt: this.dateString(row.created_at),
      ...(includeOwner ? { ownerUsername: String(row.owner_username || '') } : {}),
    };
  }

  private toEventDetail(row: Record<string, unknown>) {
    return {
      eventId: String(row.event_id || ''),
      ownerId: String(row.owner_id || ''),
      ownerUsername: String(row.owner_username || ''),
      title: String(row.title || ''),
      summary: String(row.summary || ''),
      basicFacts: this.arrayValue(row.basic_facts),
      timeline: this.arrayValue(row.timeline),
      actors: this.arrayValue(row.actors),
      category: String(row.category || ''),
      region: String(row.region || ''),
      importanceScore: Number(row.importance_score || 0),
      riskScore: Number(row.risk_score || 0),
      rawInput: this.objectValue(row.raw_input),
      analysis: this.normalizeAnalysis(row.analysis_json || {}),
      createdAt: this.dateString(row.created_at),
      updatedAt: this.dateString(row.updated_at),
    };
  }

  private toSourceResponse(row: Record<string, unknown>): DraftSourceResponse {
    return {
      sourceId: String(row.source_id || ''),
      sourceTitle: String(row.source_title || ''),
      sourceUrl: row.source_url ? String(row.source_url) : null,
      publisher: String(row.publisher || ''),
      author: String(row.author || ''),
      publishedAt: this.dateString(row.published_at) || null,
      contentText: String(row.content_text || ''),
      sourceSummary: String(row.source_summary || ''),
      relevanceReason: String(row.relevance_reason || ''),
      supportedFacts: this.arrayValue(row.supported_facts),
      supportedAttitudes: this.arrayValue(row.supported_attitudes),
      credibilityScore: Number(row.credibility_score || 0),
      createdAt: this.dateString(row.created_at),
    };
  }

  private toOutlineResponse(row: Record<string, unknown>) {
    return {
      outlineId: String(row.outline_id || ''),
      eventId: String(row.event_id || ''),
      ownerId: String(row.owner_id || ''),
      versionNo: Number(row.version_no || 0),
      title: String(row.title || ''),
      outline: this.normalizeOutline(row.outline_json || {}),
      userFeedback: String(row.user_feedback || ''),
      editType: String(row.edit_type || ''),
      parentOutlineId: row.parent_outline_id ? String(row.parent_outline_id) : null,
      createdAt: this.dateString(row.created_at),
    };
  }

  private normalizeLinks(value: unknown): string[] {
    const items = Array.isArray(value) ? value : [];
    return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 20);
  }

  private requiredText(value: unknown, field: string, maxLength: number): string {
    const text = this.text(value, maxLength);
    if (!text) throw new BadRequestException({ error: `${field} is required` });
    return text;
  }

  private text(value: unknown, maxLength: number): string {
    return String(value || '').trim().slice(0, maxLength);
  }

  private nullableText(value: unknown, maxLength: number): string | null {
    const text = this.text(value, maxLength);
    return text || null;
  }

  private nullableDate(value: unknown): string | null {
    const text = String(value || '').trim();
    if (!text) return null;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private dateString(value: unknown): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  private objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private arrayValue(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  private scoreFromAnalysis(value: string): number {
    const lower = value.toLowerCase();
    if (lower.includes('高') || lower.includes('重大') || lower.includes('high')) return 0.8;
    if (lower.includes('中') || lower.includes('medium')) return 0.55;
    if (value) return 0.35;
    return 0;
  }

  private scoreFromRisk(value: unknown[]): number {
    const text = JSON.stringify(value).toLowerCase();
    if (text.includes('高') || text.includes('high')) return 0.8;
    if (text.includes('中') || text.includes('medium')) return 0.55;
    return value.length ? 0.35 : 0;
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }
}
