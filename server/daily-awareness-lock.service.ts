import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createAuthPool, type PgPool } from './auth-database.js';
import type { DailyAwarenessTriggerType } from './daily-awareness.constants.js';

export interface DailyAwarenessLockResult<T> {
  acquired: boolean;
  value?: T;
}

@Injectable()
export class DailyAwarenessLockService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  async withBusinessDateLock<T>(
    businessDate: string,
    _mode: DailyAwarenessTriggerType,
    work: () => Promise<T>,
  ): Promise<DailyAwarenessLockResult<T>> {
    const pool = await this.getPool();
    const client = await pool.connect();
    let acquired = false;
    try {
      const result = await client.query(
        `SELECT pg_try_advisory_lock(
           hashtext('daily-awareness'),
           hashtext($1)
         ) AS acquired`,
        [businessDate],
      );
      acquired = result.rows[0]?.acquired === true;
      if (!acquired) return { acquired: false };
      return { acquired: true, value: await work() };
    } finally {
      if (acquired) {
        try {
          await client.query(
            `SELECT pg_advisory_unlock(
               hashtext('daily-awareness'),
               hashtext($1)
             ) AS unlocked`,
            [businessDate],
          );
        } finally {
          client.release();
        }
      } else {
        client.release();
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  private async getPool(): Promise<PgPool> {
    if (!this.pool) this.pool = createAuthPool({ max: 2 });
    return this.pool;
  }
}
