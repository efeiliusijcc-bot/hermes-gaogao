import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createAuthPool, type PgPool } from './auth-database.js';
import {
  dailyAwarenessInboxMaxAttempts,
  dailyAwarenessDataRetryMinutes,
  dailyAwarenessRetryIntervalSeconds,
} from './config.js';
import type {
  DailyAwarenessInboxProcessor,
  DailyAwarenessInboxRecord,
  DailyAwarenessTerminalResult,
  DailyDataFinishedAcceptedResponse,
  DailyDataFinishedEvent,
} from './daily-awareness.contracts.js';

export interface DailyAwarenessInboxFailureDisposition {
  status: 'RETRY_PENDING' | 'DEAD_LETTER';
  nextAttemptAt: string | null;
  errorCode: string;
}

export function dailyAwarenessInboxFailureDisposition(
  item: DailyAwarenessInboxRecord,
  error: unknown,
  now = new Date(),
): DailyAwarenessInboxFailureDisposition | null {
  const code = String((error as { code?: unknown })?.code || '');
  const deadline = new Date(String(item.payload.dataWaitDeadline || ''));
  if (code !== 'DAILY_AWARENESS_MYSQL_TABLE_NOT_FOUND'
    || item.payload.triggerSource !== 'AUTO_SCHEDULER'
    || !Number.isFinite(deadline.getTime())) return null;
  if (now.getTime() >= deadline.getTime()) {
    return {
      status: 'DEAD_LETTER',
      nextAttemptAt: null,
      errorCode: 'DAILY_AWARENESS_SOURCE_WAIT_DEADLINE_EXCEEDED',
    };
  }
  const retryAt = Math.min(
    deadline.getTime(),
    now.getTime() + dailyAwarenessDataRetryMinutes() * 60_000,
  );
  return {
    status: 'RETRY_PENDING',
    nextAttemptAt: new Date(retryAt).toISOString(),
    errorCode: 'DAILY_AWARENESS_SOURCE_TABLE_WAITING',
  };
}

@Injectable()
export class DailyAwarenessInboxService implements OnModuleDestroy {
  private pool: PgPool | null = null;
  private readonly wakeHandlers = new Set<() => void>();
  private processor: DailyAwarenessInboxProcessor | null = null;

  async accept(event: DailyDataFinishedEvent): Promise<DailyDataFinishedAcceptedResponse> {
    return this.acceptWithPayload(event, { ...event });
  }

  async acceptScheduled(
    event: DailyDataFinishedEvent,
    metadata: Record<string, unknown>,
  ): Promise<DailyDataFinishedAcceptedResponse> {
    return this.acceptWithPayload(event, { ...event, ...metadata });
  }

  private async acceptWithPayload(
    event: DailyDataFinishedEvent,
    payload: Record<string, unknown>,
  ): Promise<DailyDataFinishedAcceptedResponse> {
    const pool = await this.getPool();
    const result = await pool.query(
      `INSERT INTO daily_awareness_event_inbox
        (event_id, event_type, business_date, batch_id, completed_at, total_count, payload, status)
       VALUES ($1, $2, $3::date, $4, $5::timestamptz, $6, $7::jsonb, 'RECEIVED')
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [
        event.eventId,
        event.eventType,
        event.businessDate,
        event.batchId,
        event.completedAt,
        event.totalCount ?? null,
        JSON.stringify(payload),
      ],
    );
    const duplicate = result.rows.length === 0;
    this.wake();
    return { accepted: true, duplicate, eventId: event.eventId };
  }

  registerWakeHandler(handler: () => void): () => void {
    this.wakeHandlers.add(handler);
    return () => this.wakeHandlers.delete(handler);
  }

  registerProcessor(processor: DailyAwarenessInboxProcessor): () => void {
    this.processor = processor;
    return () => {
      if (this.processor === processor) this.processor = null;
    };
  }

  async process(item: DailyAwarenessInboxRecord): Promise<DailyAwarenessTerminalResult> {
    if (!this.processor) throw new Error('Daily awareness Inbox processor is not registered');
    return this.processor(item);
  }

  async recoverStaleProcessing(leaseSeconds: number): Promise<number> {
    const result = await (await this.getPool()).query(
      `UPDATE daily_awareness_event_inbox
          SET status = 'RETRY_PENDING',
              next_attempt_at = now(),
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
        WHERE status = 'PROCESSING'
          AND locked_at < now() - ($1::int * interval '1 second')
      RETURNING event_id`,
      [leaseSeconds],
    );
    return result.rows.length;
  }

  async claimNext(workerId: string): Promise<DailyAwarenessInboxRecord | null> {
    const result = await (await this.getPool()).query(
      `WITH candidate AS (
         SELECT event_id
           FROM daily_awareness_event_inbox
          WHERE status IN ('RECEIVED', 'RETRY_PENDING')
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE daily_awareness_event_inbox inbox
          SET status = 'PROCESSING',
              attempt_count = inbox.attempt_count + 1,
              locked_at = now(),
              locked_by = $1,
              updated_at = now()
         FROM candidate
        WHERE inbox.event_id = candidate.event_id
      RETURNING inbox.*`,
      [workerId],
    );
    return result.rows[0] ? this.toRecord(result.rows[0]) : null;
  }

  async markProcessed(eventId: string): Promise<void> {
    await (await this.getPool()).query(
      `UPDATE daily_awareness_event_inbox
          SET status = 'PROCESSED',
              processed_at = now(),
              next_attempt_at = NULL,
              locked_at = NULL,
              locked_by = NULL,
              last_error_code = NULL,
              last_error_message = NULL,
              updated_at = now()
        WHERE event_id = $1`,
      [eventId],
    );
  }

  async markInfrastructureFailure(item: DailyAwarenessInboxRecord, error: unknown): Promise<void> {
    const scheduled = dailyAwarenessInboxFailureDisposition(item, error);
    if (scheduled) {
      const pool = await this.getPool();
      await pool.query(
        `UPDATE daily_awareness_event_inbox
            SET status = $2,
                next_attempt_at = $3::timestamptz,
                locked_at = NULL,
                locked_by = NULL,
                last_error_code = $4,
                last_error_message = $5,
                updated_at = now()
          WHERE event_id = $1`,
        [item.eventId, scheduled.status, scheduled.nextAttemptAt, scheduled.errorCode, this.safeError(error)],
      );
      if (scheduled.status === 'DEAD_LETTER') {
        await pool.query(
          `UPDATE daily_awareness_day_status
              SET data_status = 'WAITING', generation_status = 'GENERATION_FAILED',
                  last_error_code = $2, last_error_message = $3, updated_at = now()
            WHERE business_date = $1::date`,
          [item.businessDate, scheduled.errorCode, this.safeError(error)],
        );
      }
      return;
    }
    const maxAttempts = dailyAwarenessInboxMaxAttempts();
    const deadLetter = item.attemptCount >= maxAttempts;
    const baseSeconds = dailyAwarenessRetryIntervalSeconds();
    const delaySeconds = Math.min(3600, baseSeconds * (2 ** Math.max(0, item.attemptCount - 1)));
    const nextAttemptAt = deadLetter ? null : new Date(Date.now() + delaySeconds * 1000).toISOString();
    await (await this.getPool()).query(
      `UPDATE daily_awareness_event_inbox
          SET status = $2,
              next_attempt_at = $3::timestamptz,
              locked_at = NULL,
              locked_by = NULL,
              last_error_code = $4,
              last_error_message = $5,
              updated_at = now()
        WHERE event_id = $1`,
      [
        item.eventId,
        deadLetter ? 'DEAD_LETTER' : 'RETRY_PENDING',
        nextAttemptAt,
        deadLetter ? 'DAILY_AWARENESS_INBOX_DEAD_LETTER' : 'DAILY_AWARENESS_INFRASTRUCTURE_RETRY',
        this.safeError(error),
      ],
    );
  }

  async list(query: { page?: unknown; pageSize?: unknown; status?: unknown }) {
    const page = this.integer(query.page, 1, 1, 100_000);
    const pageSize = this.integer(query.pageSize, 20, 1, 100);
    const params: unknown[] = [];
    const where: string[] = [];
    const status = String(query.status || '').trim();
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pool = await this.getPool();
    const count = await pool.query(`SELECT count(*)::int AS count FROM daily_awareness_event_inbox ${whereSql}`, params);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await pool.query(
      `SELECT event_id, event_type, business_date, batch_id, completed_at, total_count,
              status, attempt_count, next_attempt_at, processed_at, last_error_code,
              last_error_message, created_at, updated_at
         FROM daily_awareness_event_inbox
         ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows.map((row) => this.adminRecord(row)), page, pageSize, total: Number(count.rows[0]?.count || 0) };
  }

  async reprocess(eventId: string, actorId: string) {
    const pool = await this.getPool();
    const found = await pool.query(
      `SELECT inbox.*,
              EXISTS (
                SELECT 1 FROM daily_briefs brief
                 WHERE brief.brief_date = inbox.business_date
                   AND brief.publication_scope = 'GLOBAL'
                   AND lower(brief.status) IN ('completed', 'success')
              ) AS has_success
         FROM daily_awareness_event_inbox inbox
        WHERE inbox.event_id = $1`,
      [eventId],
    );
    const row = found.rows[0];
    if (!row) throw new NotFoundException({ error: 'Inbox event not found', code: 'DAILY_AWARENESS_INVALID_EVENT' });
    if (row.has_success === true) {
      throw new ConflictException({
        error: 'A successful global brief already exists for this business date',
        code: 'DAILY_AWARENESS_SUCCESS_ALREADY_EXISTS',
      });
    }
    if (String(row.status) !== 'DEAD_LETTER') {
      throw new BadRequestException({ error: 'Only dead-letter events can be reprocessed', code: 'DAILY_AWARENESS_INVALID_EVENT' });
    }
    const updated = await pool.query(
      `UPDATE daily_awareness_event_inbox
          SET status = 'RETRY_PENDING',
              attempt_count = 0,
              next_attempt_at = now(),
              locked_at = NULL,
              locked_by = NULL,
              processed_at = NULL,
              last_error_code = NULL,
              last_error_message = NULL,
              payload = payload || jsonb_build_object('reprocessRequested', true, 'reprocessRequestedBy', $2),
              updated_at = now()
        WHERE event_id = $1
      RETURNING event_id`,
      [eventId, actorId],
    );
    if (!updated.rows[0]) throw new NotFoundException({ error: 'Inbox event not found', code: 'DAILY_AWARENESS_INVALID_EVENT' });
    this.wake();
    return { accepted: true, eventId, status: 'RETRY_PENDING' };
  }

  wake(): void {
    for (const handler of this.wakeHandlers) {
      queueMicrotask(() => {
        try {
          handler();
        } catch {
          // The polling worker remains the durable recovery path.
        }
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  private async getPool(): Promise<PgPool> {
    if (!this.pool) this.pool = createAuthPool();
    return this.pool;
  }

  private toRecord(row: Record<string, unknown>): DailyAwarenessInboxRecord {
    const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? row.payload as Record<string, unknown>
      : {};
    return {
      eventId: String(row.event_id || ''),
      eventType: 'DAILY_DATA_FINISHED',
      businessDate: this.dateOnly(row.business_date),
      batchId: String(row.batch_id || ''),
      completedAt: this.dateString(row.completed_at),
      totalCount: row.total_count === null || row.total_count === undefined ? undefined : Number(row.total_count),
      payload,
      status: String(row.status || 'PROCESSING') as DailyAwarenessInboxRecord['status'],
      attemptCount: Number(row.attempt_count || 0),
    };
  }

  private adminRecord(row: Record<string, unknown>) {
    return {
      eventId: String(row.event_id || ''),
      eventType: String(row.event_type || ''),
      businessDate: this.dateOnly(row.business_date),
      batchId: String(row.batch_id || ''),
      completedAt: this.dateString(row.completed_at),
      totalCount: row.total_count === null || row.total_count === undefined ? null : Number(row.total_count),
      status: String(row.status || ''),
      attemptCount: Number(row.attempt_count || 0),
      nextAttemptAt: this.dateString(row.next_attempt_at),
      processedAt: this.dateString(row.processed_at),
      errorCode: String(row.last_error_code || ''),
      errorMessage: this.safeError(row.last_error_message || ''),
      createdAt: this.dateString(row.created_at),
      updatedAt: this.dateString(row.updated_at),
    };
  }

  private integer(value: unknown, fallback: number, min: number, max: number): number {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  private dateOnly(value: unknown): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value || '').slice(0, 10);
  }

  private dateString(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    const date = new Date(String(value || ''));
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }

  private safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
      .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://***@')
      .replace(/api[_-]?key[=:]\s*[^,\s]+/gi, 'api_key=***')
      .replace(/x-hermes-internal-key[=:]\s*[^,\s]+/gi, 'x-hermes-internal-key=***')
      .slice(0, 500);
  }
}
