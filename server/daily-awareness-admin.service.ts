import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createAuthPool, type PgPool } from './auth-database.js';

@Injectable()
export class DailyAwarenessAdminService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  async status(businessDate?: string) {
    const params: unknown[] = [];
    const where = businessDate ? 'WHERE day.business_date = $1::date' : '';
    if (businessDate) params.push(businessDate);
    const result = await (await this.getPool()).query(
      `SELECT day.*, run.source_business_date, run.source_table, run.data_wait_deadline,
              inbox.next_attempt_at
         FROM daily_awareness_day_status day
         LEFT JOIN daily_awareness_runs run ON run.id = day.last_run_id
         LEFT JOIN daily_awareness_event_inbox inbox ON inbox.event_id = run.trigger_ref
         ${where}
        ORDER BY day.business_date DESC
        LIMIT 1`,
      params,
    );
    return result.rows[0] || null;
  }

  async runs(query: { page?: unknown; pageSize?: unknown; businessDate?: unknown; status?: unknown; triggerType?: unknown }) {
    const page = this.integer(query.page, 1, 1, 100_000);
    const pageSize = this.integer(query.pageSize, 20, 1, 100);
    const params: unknown[] = [];
    const where: string[] = [];
    for (const [column, value] of [['business_date', query.businessDate], ['status', query.status], ['trigger_type', query.triggerType]] as const) {
      const text = String(value || '').trim();
      if (!text) continue;
      params.push(text);
      where.push(`${column} = $${params.length}${column === 'business_date' ? '::date' : ''}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pool = await this.getPool();
    const count = await pool.query(`SELECT count(*)::int AS count FROM daily_awareness_runs ${whereSql}`, params);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await pool.query(
      `SELECT * FROM daily_awareness_runs ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows.map((row) => this.toRun(row)), page, pageSize, total: Number(count.rows[0]?.count || 0) };
  }

  async run(id: string) {
    const result = await (await this.getPool()).query('SELECT * FROM daily_awareness_runs WHERE id = $1', [id]);
    if (!result.rows[0]) throw new NotFoundException({ error: 'Daily awareness run not found' });
    return this.toRun(result.rows[0]);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  private toRun(row: Record<string, unknown>) {
    return {
      id: String(row.id || ''),
      businessDate: String(row.business_date || '').slice(0, 10),
      triggerType: String(row.trigger_type || ''),
      status: String(row.status || ''),
      attemptNo: Number(row.attempt_no || 0),
      qualityStatus: String(row.quality_status || ''),
      sourceCount: Number(row.source_count || 0),
      sourceBusinessDate: String(row.source_business_date || '').slice(0, 10),
      sourceTable: String(row.source_table || ''),
      dataWaitDeadline: this.dateString(row.data_wait_deadline),
      summaryCount: Number(row.summary_count || 0),
      titleOnlyCount: Number(row.title_only_count || 0),
      skippedCount: Number(row.skipped_count || 0),
      modelProvider: String(row.model_provider || ''),
      modelName: String(row.model_name || ''),
      promptVersion: String(row.prompt_version || ''),
      errorCode: String(row.error_code || ''),
      errorMessage: this.safeError(row.error_message || ''),
      requestedBy: String(row.requested_by || ''),
      manualReason: String(row.manual_reason || ''),
      startedAt: this.dateString(row.started_at),
      finishedAt: this.dateString(row.finished_at),
      createdAt: this.dateString(row.created_at),
    };
  }

  private safeError(value: unknown): string {
    return String(value || '')
      .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://***@')
      .replace(/api[_-]?key[=:]\s*[^,\s]+/gi, 'api_key=***')
      .slice(0, 500);
  }

  private dateString(value: unknown): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }

  private integer(value: unknown, fallback: number, min: number, max: number): number {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  private async getPool(): Promise<PgPool> {
    if (!this.pool) this.pool = createAuthPool({ max: 2 });
    return this.pool;
  }
}
