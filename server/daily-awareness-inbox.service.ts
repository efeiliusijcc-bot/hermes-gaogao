import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createAuthPool, type PgPool } from './auth-database.js';
import {
  dailyAwarenessInboxMaxAttempts,
  dailyAwarenessRetryIntervalSeconds,
} from './config.js';
import type {
  DailyAwarenessInboxProcessor,
  DailyAwarenessInboxRecord,
  DailyAwarenessTerminalResult,
  DailyDataFinishedAcceptedResponse,
  DailyDataFinishedEvent,
} from './daily-awareness.contracts.js';

@Injectable()
export class DailyAwarenessInboxService implements OnModuleDestroy {
  private pool: PgPool | null = null;
  private readonly wakeHandlers = new Set<() => void>();
  private processor: DailyAwarenessInboxProcessor | null = null;

  async accept(event: DailyDataFinishedEvent): Promise<DailyDataFinishedAcceptedResponse> {
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
        JSON.stringify(event),
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
