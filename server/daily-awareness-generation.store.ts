import { ConflictException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createAuthPool, type PgClient, type PgPool } from './auth-database.js';
import { DAILY_AWARENESS_PROMPT_VERSION } from './daily-awareness.constants.js';
import type {
  DailyAwarenessComposedBrief,
  DailyAwarenessConfig,
  DailyAwarenessInboxRecord,
  DailyAwarenessPreparedMaterials,
} from './daily-awareness.contracts.js';
import type { DailyAwarenessTriggerType } from './daily-awareness.constants.js';
import type { DailyAwarenessSourceContext } from './daily-awareness-date.js';

@Injectable()
export class DailyAwarenessGenerationStore implements OnModuleDestroy {
  private pool: PgPool | null = null;

  async loadConfig(): Promise<DailyAwarenessConfig> {
    const result = await (await this.getPool()).query('SELECT * FROM daily_awareness_config WHERE id = 1');
    const row = result.rows[0] || {};
    return {
      lookbackHours: this.integer(row.lookback_hours, 24),
      maxArticles: this.integer(row.max_articles, 50),
      categoryScope: this.stringArray(row.category_scope),
      maxRetryCount: this.integer(row.max_retry_count, 3),
      retryIntervalSeconds: this.integer(row.retry_interval_seconds, 30),
      summaryMaxChars: this.integer(row.summary_max_chars, 1200),
      version: this.integer(row.version, 1),
      updatedAt: this.dateString(row.updated_at),
      updatedBy: String(row.updated_by || ''),
    };
  }

  async hasSuccessfulGlobalBrief(businessDate: string): Promise<boolean> {
    const result = await (await this.getPool()).query(
      `SELECT brief_id
         FROM daily_briefs
        WHERE brief_date = $1::date
          AND publication_scope = 'GLOBAL'
          AND lower(status) IN ('completed', 'success')
        LIMIT 1`,
      [businessDate],
    );
    return result.rows.length > 0;
  }

  async startRun(item: DailyAwarenessInboxRecord, triggerType: DailyAwarenessTriggerType, attemptNo: number): Promise<string> {
    const runId = randomUUID();
    const source = this.sourceMetadata(item);
    await this.transaction(async (client) => {
      await client.query(
        `INSERT INTO daily_awareness_runs
          (id, business_date, trigger_type, trigger_ref, status, attempt_no, prompt_version, started_at,
           source_business_date, source_table, data_wait_deadline)
         VALUES ($1, $2::date, $3, $4, 'RUNNING', $5, $6, now(), $7::date, $8, $9::timestamptz)`,
        [runId, item.businessDate, triggerType, item.eventId, attemptNo, DAILY_AWARENESS_PROMPT_VERSION,
          source.sourceBusinessDate, source.sourceTable, source.dataWaitDeadline],
      );
      await client.query(
        `INSERT INTO daily_awareness_day_status
          (business_date, data_status, generation_status, batch_id, data_completed_at, last_run_id, updated_at)
         VALUES ($1::date, 'WAITING', 'GENERATING', $2, $3::timestamptz, $4, now())
         ON CONFLICT (business_date) DO UPDATE SET
           generation_status = 'GENERATING',
           batch_id = EXCLUDED.batch_id,
           data_completed_at = EXCLUDED.data_completed_at,
           last_run_id = EXCLUDED.last_run_id,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = now()`,
        [item.businessDate, item.batchId, item.completedAt, runId],
      );
    });
    return runId;
  }

  async queueManualRun(
    businessDate: string,
    reason: string,
    requestedBy: string,
    source: DailyAwarenessSourceContext,
  ): Promise<string> {
    const runId = randomUUID();
    await this.transaction(async (client) => {
      const lock = await client.query(
        `SELECT pg_try_advisory_xact_lock(
           hashtext('daily-awareness'),
           hashtext($1)
         ) AS acquired`,
        [businessDate],
      );
      if (lock.rows[0]?.acquired !== true) {
        throw new ConflictException({ error: 'Daily awareness generation is already running', code: 'DAILY_AWARENESS_ALREADY_RUNNING' });
      }
      const active = await client.query(
        `SELECT id FROM daily_awareness_runs
          WHERE business_date = $1::date
            AND status IN ('QUEUED', 'RUNNING')
          LIMIT 1`,
        [businessDate],
      );
      if (active.rows.length) {
        throw new ConflictException({ error: 'Daily awareness generation is already running', code: 'DAILY_AWARENESS_ALREADY_RUNNING' });
      }
      await client.query(
        `INSERT INTO daily_awareness_runs
          (id, business_date, trigger_type, status, attempt_no, prompt_version, requested_by, manual_reason,
           source_business_date, source_table, data_wait_deadline)
         VALUES ($1, $2::date, 'MANUAL', 'QUEUED', 1, $3, $4, $5, $6::date, $7, $8::timestamptz)`,
        [runId, businessDate, DAILY_AWARENESS_PROMPT_VERSION, requestedBy, reason,
          source.sourceBusinessDate, source.sourceTable, source.dataWaitDeadline],
      );
      await client.query(
        `INSERT INTO daily_awareness_day_status (business_date, data_status, generation_status, last_run_id, updated_at)
         VALUES ($1::date, 'WAITING', 'PENDING', $2, now())
         ON CONFLICT (business_date) DO UPDATE SET
           generation_status = 'PENDING', last_run_id = EXCLUDED.last_run_id, updated_at = now()`,
        [businessDate, runId],
      );
    });
    return runId;
  }

  async startQueuedRun(runId: string, item: DailyAwarenessInboxRecord): Promise<string> {
    const source = this.sourceMetadata(item);
    await this.transaction(async (client) => {
      await client.query(
        `UPDATE daily_awareness_runs
            SET status = 'RUNNING', started_at = now(), source_business_date = $2::date,
                source_table = $3, data_wait_deadline = $4::timestamptz
          WHERE id = $1 AND status = 'QUEUED'`,
        [runId, source.sourceBusinessDate, source.sourceTable, source.dataWaitDeadline],
      );
      await client.query(
        `UPDATE daily_awareness_day_status
            SET generation_status = 'GENERATING', batch_id = $2, data_completed_at = $3::timestamptz,
                last_run_id = $4, last_error_code = NULL, last_error_message = NULL, updated_at = now()
          WHERE business_date = $1::date`,
        [item.businessDate, item.batchId, item.completedAt, runId],
      );
    });
    return runId;
  }

  async recordIgnored(item: DailyAwarenessInboxRecord, triggerType: DailyAwarenessTriggerType): Promise<void> {
    const source = this.sourceMetadata(item);
    await (await this.getPool()).query(
      `INSERT INTO daily_awareness_runs
        (business_date, trigger_type, trigger_ref, status, attempt_no, prompt_version, started_at, finished_at,
         source_business_date, source_table, data_wait_deadline)
       VALUES ($1::date, $2, $3, 'IGNORED_DUPLICATE', 1, $4, now(), now(), $5::date, $6, $7::timestamptz)`,
      [item.businessDate, triggerType, item.eventId, DAILY_AWARENESS_PROMPT_VERSION,
        source.sourceBusinessDate, source.sourceTable, source.dataWaitDeadline],
    );
  }

  async completeNoData(runId: string, item: DailyAwarenessInboxRecord, prepared: DailyAwarenessPreparedMaterials): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        `UPDATE daily_awareness_runs
            SET status = 'NO_DATA', source_count = $2, summary_count = $3,
                title_only_count = $4, skipped_count = $5, finished_at = now()
          WHERE id = $1`,
        [runId, prepared.sourceCount, prepared.summaryCount, prepared.titleOnlyCount, prepared.skippedCount],
      );
      await client.query(
        `UPDATE daily_awareness_day_status
            SET data_status = 'NO_DATA', generation_status = 'NOT_REQUIRED', quality_status = NULL,
                source_count = $2, summary_count = $3, title_only_count = $4, skipped_count = $5,
                current_brief_id = NULL, last_run_id = $6, last_error_code = NULL,
                last_error_message = NULL, updated_at = now()
          WHERE business_date = $1::date`,
        [item.businessDate, prepared.sourceCount, prepared.summaryCount, prepared.titleOnlyCount, prepared.skippedCount, runId],
      );
    });
  }

  async failRun(runId: string, error: unknown, terminal: boolean): Promise<void> {
    const code = this.modelErrorCode(error);
    const message = this.safeError(error);
    await this.transaction(async (client) => {
      await client.query(
        `UPDATE daily_awareness_runs
            SET status = 'FAILED', error_code = $2, error_message = $3, finished_at = now()
          WHERE id = $1`,
        [runId, code, message],
      );
      if (terminal) {
        await client.query(
          `UPDATE daily_awareness_day_status
              SET data_status = 'READY', generation_status = 'GENERATION_FAILED',
                  last_error_code = $2, last_error_message = $3, last_run_id = $4, updated_at = now()
            WHERE last_run_id = $1`,
          [runId, code, message, runId],
        );
      }
    });
  }

  async saveSuccess(
    runId: string,
    item: DailyAwarenessInboxRecord,
    prepared: DailyAwarenessPreparedMaterials,
    composed: DailyAwarenessComposedBrief,
    generatedByType: 'SYSTEM' | 'MANUAL' = 'SYSTEM',
  ): Promise<void> {
    const source = this.sourceMetadata(item);
    await this.transaction(async (client) => {
      const briefResult = await client.query(
        `INSERT INTO daily_briefs
          (owner_id, brief_date, title, summary, status, total_candidates, selected_count, categories,
           content_json, publication_scope, quality_status, content_markdown, generated_at,
           generated_by_type, generation_run_id, source_count, summary_count, title_only_count, skipped_count,
           source_business_date, source_table)
         VALUES
          (NULL, $1::date, $2, $3, 'completed', $4, $5, $6::jsonb,
           $7::jsonb, 'GLOBAL', $8, $9, now(), $10, $11, $12, $13, $14, $15, $16::date, $17)
         ON CONFLICT (brief_date) WHERE publication_scope = 'GLOBAL' DO UPDATE SET
           title = EXCLUDED.title,
           summary = EXCLUDED.summary,
           status = 'completed',
           total_candidates = EXCLUDED.total_candidates,
           selected_count = EXCLUDED.selected_count,
           categories = EXCLUDED.categories,
           content_json = EXCLUDED.content_json,
           quality_status = EXCLUDED.quality_status,
           content_markdown = EXCLUDED.content_markdown,
           generated_at = now(),
           generated_by_type = EXCLUDED.generated_by_type,
           generation_run_id = EXCLUDED.generation_run_id,
           source_count = EXCLUDED.source_count,
           summary_count = EXCLUDED.summary_count,
           title_only_count = EXCLUDED.title_only_count,
           skipped_count = EXCLUDED.skipped_count,
           source_business_date = EXCLUDED.source_business_date,
           source_table = EXCLUDED.source_table,
           updated_at = now()
         RETURNING brief_id`,
        [
          item.businessDate,
          composed.title,
          composed.summary,
          prepared.candidates.length,
          composed.events.length,
          JSON.stringify(composed.categoryStats),
          JSON.stringify(composed.contentJson),
          prepared.qualityStatus,
          composed.reportMarkdown,
          generatedByType,
          runId,
          prepared.sourceCount,
          prepared.summaryCount,
          prepared.titleOnlyCount,
          prepared.skippedCount,
          source.sourceBusinessDate,
          source.sourceTable,
        ],
      );
      const briefId = String(briefResult.rows[0]?.brief_id || '');
      await client.query('DELETE FROM daily_brief_events WHERE brief_id = $1', [briefId]);
      for (let index = 0; index < composed.events.length; index += 1) {
        const event = composed.events[index];
        await client.query(
          `INSERT INTO daily_brief_events
            (brief_id, owner_id, rank_no, event_title, category, region, basic_situation,
             background_context, importance_judgement, risk_to_us, source_info,
             related_material_ids, importance_score, risk_score)
           VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
          [
            briefId,
            index + 1,
            event.eventTitle,
            event.category || '其他',
            event.region || '',
            event.basicSituation || '',
            event.backgroundContext || '',
            event.importanceJudgement || '',
            event.riskToUs || '',
            JSON.stringify(event.sourceInfo || []),
            JSON.stringify(event.relatedMaterialIds || []),
            event.importanceScore || 0,
            event.riskScore || 0,
          ],
        );
      }
      await client.query(
        `UPDATE daily_awareness_runs
            SET status = 'SUCCESS', quality_status = $2, source_count = $3, summary_count = $4,
                title_only_count = $5, skipped_count = $6, finished_at = now()
          WHERE id = $1`,
        [runId, prepared.qualityStatus, prepared.sourceCount, prepared.summaryCount, prepared.titleOnlyCount, prepared.skippedCount],
      );
      await client.query(
        `UPDATE daily_awareness_day_status
            SET data_status = 'READY', generation_status = 'SUCCESS', quality_status = $2,
                source_count = $3, summary_count = $4, title_only_count = $5, skipped_count = $6,
                current_brief_id = $7, last_run_id = $8, last_error_code = NULL,
                last_error_message = NULL, updated_at = now()
          WHERE business_date = $1::date`,
        [item.businessDate, prepared.qualityStatus, prepared.sourceCount, prepared.summaryCount, prepared.titleOnlyCount, prepared.skippedCount, briefId, runId],
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  private async transaction(work: (client: PgClient) => Promise<void>): Promise<void> {
    const client = await (await this.getPool()).connect();
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async getPool(): Promise<PgPool> {
    if (!this.pool) this.pool = createAuthPool({ max: 4 });
    return this.pool;
  }

  private integer(value: unknown, fallback: number): number {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? number : fallback;
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
  }

  private dateString(value: unknown): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }

  private sourceMetadata(item: DailyAwarenessInboxRecord): DailyAwarenessSourceContext {
    return {
      sourceBusinessDate: String(item.payload.sourceBusinessDate || ''),
      sourceTable: String(item.payload.sourceTable || ''),
      dataWaitDeadline: String(item.payload.dataWaitDeadline || ''),
    };
  }

  private modelErrorCode(error: unknown): string {
    const status = Number((error as { status?: unknown })?.status || 0);
    if (status === 429) return 'DAILY_AWARENESS_MODEL_RATE_LIMITED';
    if (status >= 500) return 'DAILY_AWARENESS_MODEL_UNAVAILABLE';
    if (/timeout/i.test(error instanceof Error ? error.message : String(error))) return 'DAILY_AWARENESS_MODEL_TIMEOUT';
    return 'DAILY_AWARENESS_MODEL_UNAVAILABLE';
  }

  private safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
      .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://***@')
      .replace(/api[_-]?key[=:]\s*[^,\s]+/gi, 'api_key=***')
      .slice(0, 500);
  }
}
