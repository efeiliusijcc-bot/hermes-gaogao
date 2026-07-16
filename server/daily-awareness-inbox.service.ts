import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createAuthPool, type PgPool } from './auth-database.js';
import type { DailyDataFinishedAcceptedResponse, DailyDataFinishedEvent } from './daily-awareness.contracts.js';

@Injectable()
export class DailyAwarenessInboxService implements OnModuleDestroy {
  private pool: PgPool | null = null;
  private readonly wakeHandlers = new Set<() => void>();

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
}
