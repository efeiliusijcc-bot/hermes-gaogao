import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createAuthPool, type PgPool } from './auth-database.js';
import {
  DAILY_AWARENESS_DATA_STATUSES,
  DAILY_AWARENESS_GENERATION_STATUSES,
  DAILY_AWARENESS_QUALITY_STATUSES,
  type DailyAwarenessDataStatus,
  type DailyAwarenessGenerationStatus,
  type DailyAwarenessMessageCode,
  type DailyAwarenessQualityStatus,
} from './daily-awareness.constants.js';
import type {
  DailyAwarenessCurrentResponse,
  DailyAwarenessDisplayedBrief,
} from './daily-awareness.contracts.js';

@Injectable()
export class DailyAwarenessQueryService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  async current(businessDate: string): Promise<DailyAwarenessCurrentResponse> {
    const date = this.requiredDate(businessDate);
    const pool = await this.getPool();
    const statusResult = await pool.query(
      'SELECT * FROM daily_awareness_day_status WHERE business_date = $1::date',
      [date],
    );
    const status = statusResult.rows[0] || {};
    const dataStatus = this.dataStatus(status.data_status);
    const generationStatus = this.generationStatus(status.generation_status);
    const qualityStatus = this.qualityStatus(status.quality_status);

    let briefRow: Record<string, unknown> | null = null;
    const currentBriefId = String(status.current_brief_id || '');
    if (generationStatus === 'SUCCESS' && currentBriefId) {
      briefRow = await this.findBriefById(currentBriefId);
    }
    if (!briefRow) briefRow = await this.findLatestSuccessful(date);
    const displayedBrief = briefRow ? await this.toDisplayedBrief(briefRow) : null;

    return {
      businessDate: date,
      dataStatus,
      generationStatus,
      qualityStatus,
      messageCode: displayedBrief ? this.messageCode(dataStatus, generationStatus) : 'NO_SUCCESSFUL_BRIEF',
      displayedBrief,
    };
  }

  async byDate(businessDate: string): Promise<DailyAwarenessDisplayedBrief> {
    const date = this.requiredDate(businessDate);
    const result = await (await this.getPool()).query(
      `SELECT *
         FROM daily_briefs
        WHERE brief_date = $1::date
          AND publication_scope = 'GLOBAL'
          AND lower(status) IN ('completed', 'success')
        LIMIT 1`,
      [date],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ error: 'Daily brief not found', code: 'DAILY_AWARENESS_NO_BRIEF' });
    return this.toDisplayedBrief(row);
  }

  async history(query: { page?: unknown; pageSize?: unknown; from?: unknown; to?: unknown }) {
    const page = this.integer(query.page, 1, 1, 100_000);
    const pageSize = this.integer(query.pageSize, 20, 1, 100);
    const params: unknown[] = [];
    const where = ["publication_scope = 'GLOBAL'", "lower(status) IN ('completed', 'success')"];
    const from = String(query.from || '').trim();
    const to = String(query.to || '').trim();
    if (from) {
      params.push(this.requiredDate(from));
      where.push(`brief_date >= $${params.length}::date`);
    }
    if (to) {
      params.push(this.requiredDate(to));
      where.push(`brief_date <= $${params.length}::date`);
    }
    const pool = await this.getPool();
    const count = await pool.query(`SELECT count(*)::int AS count FROM daily_briefs WHERE ${where.join(' AND ')}`, params);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await pool.query(
      `SELECT * FROM daily_briefs
        WHERE ${where.join(' AND ')}
        ORDER BY brief_date DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: rows.rows.map((row) => this.briefSummary(row)),
      page,
      pageSize,
      total: Number(count.rows[0]?.count || 0),
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  private async findBriefById(briefId: string): Promise<Record<string, unknown> | null> {
    const result = await (await this.getPool()).query(
      `SELECT * FROM daily_briefs
        WHERE brief_id = $1
          AND publication_scope = 'GLOBAL'
          AND lower(status) IN ('completed', 'success')
        LIMIT 1`,
      [briefId],
    );
    return result.rows[0] || null;
  }

  private async findLatestSuccessful(businessDate: string): Promise<Record<string, unknown> | null> {
    const result = await (await this.getPool()).query(
      `SELECT * FROM daily_briefs
        WHERE publication_scope = 'GLOBAL'
          AND lower(status) IN ('completed', 'success')
          AND brief_date <= $1::date
        ORDER BY brief_date DESC
        LIMIT 1`,
      [businessDate],
    );
    return result.rows[0] || null;
  }

  private async toDisplayedBrief(row: Record<string, unknown>): Promise<DailyAwarenessDisplayedBrief> {
    const briefId = String(row.brief_id || '');
    const eventsResult = await (await this.getPool()).query(
      'SELECT * FROM daily_brief_events WHERE brief_id = $1 ORDER BY rank_no ASC',
      [briefId],
    );
    const contentJson = this.object(row.content_json);
    return {
      briefId,
      businessDate: this.dateOnly(row.brief_date),
      title: String(row.title || ''),
      contentMarkdown: String(row.content_markdown || contentJson.reportMarkdown || ''),
      qualityStatus: this.qualityStatus(row.quality_status) || 'NORMAL',
      selectedCount: Number(row.selected_count || 0),
      generatedAt: this.dateString(row.generated_at || row.updated_at || row.created_at),
      generatedByType: String(row.generated_by_type || 'SYSTEM') === 'MANUAL' ? 'MANUAL' : 'SYSTEM',
      sourceBusinessDate: this.dateOnly(row.source_business_date),
      sourceTable: String(row.source_table || ''),
      categories: this.array(row.categories),
      categoryDistribution: this.object(contentJson.categoryDistribution),
      events: eventsResult.rows.map((event) => this.event(event)),
    };
  }

  private briefSummary(row: Record<string, unknown>) {
    return {
      briefId: String(row.brief_id || ''),
      businessDate: this.dateOnly(row.brief_date),
      title: String(row.title || ''),
      qualityStatus: this.qualityStatus(row.quality_status) || 'NORMAL',
      selectedCount: Number(row.selected_count || 0),
      generatedAt: this.dateString(row.generated_at || row.updated_at || row.created_at),
      generatedByType: String(row.generated_by_type || 'SYSTEM') === 'MANUAL' ? 'MANUAL' : 'SYSTEM',
      sourceBusinessDate: this.dateOnly(row.source_business_date),
      sourceTable: String(row.source_table || ''),
    };
  }

  private event(row: Record<string, unknown>) {
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
      sourceInfo: this.array(row.source_info),
      relatedMaterialIds: this.array(row.related_material_ids),
      importanceScore: Number(row.importance_score || 0),
      riskScore: Number(row.risk_score || 0),
    };
  }

  private messageCode(data: DailyAwarenessDataStatus, generation: DailyAwarenessGenerationStatus): DailyAwarenessMessageCode {
    if (data === 'NO_DATA') return 'TODAY_NO_DATA';
    if (generation === 'SUCCESS') return 'TODAY_READY';
    if (generation === 'GENERATION_FAILED') return 'TODAY_GENERATION_FAILED';
    if (generation === 'GENERATING' || generation === 'PENDING') return 'TODAY_GENERATING';
    return 'TODAY_WAITING';
  }

  private dataStatus(value: unknown): DailyAwarenessDataStatus {
    const status = String(value || 'WAITING') as DailyAwarenessDataStatus;
    return DAILY_AWARENESS_DATA_STATUSES.includes(status) ? status : 'WAITING';
  }

  private generationStatus(value: unknown): DailyAwarenessGenerationStatus {
    const status = String(value || 'WAITING') as DailyAwarenessGenerationStatus;
    return DAILY_AWARENESS_GENERATION_STATUSES.includes(status) ? status : 'WAITING';
  }

  private qualityStatus(value: unknown): DailyAwarenessQualityStatus | null {
    const status = String(value || '') as DailyAwarenessQualityStatus;
    return DAILY_AWARENESS_QUALITY_STATUSES.includes(status) ? status : null;
  }

  private requiredDate(value: unknown): string {
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new NotFoundException({ error: 'Daily brief not found', code: 'DAILY_AWARENESS_NO_BRIEF' });
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new NotFoundException({ error: 'Daily brief not found', code: 'DAILY_AWARENESS_NO_BRIEF' });
    }
    return date;
  }

  private integer(value: unknown, fallback: number, min: number, max: number): number {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  private object(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private array(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private dateOnly(value: unknown): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value || '').slice(0, 10);
  }

  private dateString(value: unknown): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }

  private async getPool(): Promise<PgPool> {
    if (!this.pool) this.pool = createAuthPool({ max: 4 });
    return this.pool;
  }
}
