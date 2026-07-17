import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { createAuthPool, type PgPool } from './auth-database.js';
import type { DailyAwarenessConfig } from './daily-awareness.contracts.js';

export const DAILY_AWARENESS_CATEGORIES = ['涉政', '危安', '涉华', '其他'] as const;

export function normalizeDailyAwarenessCategoryScope(value: unknown, allowLegacyEmpty = false): string[] {
  const values = Array.isArray(value) ? value : [];
  const normalized = Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
  if (!normalized.length && allowLegacyEmpty) return [...DAILY_AWARENESS_CATEGORIES];
  return normalized;
}

@Injectable()
export class DailyAwarenessConfigService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  async get(): Promise<DailyAwarenessConfig> {
    const result = await (await this.getPool()).query('SELECT * FROM daily_awareness_config WHERE id = 1');
    return this.toConfig(result.rows[0] || {});
  }

  async update(input: DailyAwarenessConfig, actorId: string): Promise<DailyAwarenessConfig> {
    const value = this.validate(input);
    const result = await (await this.getPool()).query(
      `UPDATE daily_awareness_config
          SET lookback_hours = $1,
              max_articles = $2,
              category_scope = $3::jsonb,
              max_retry_count = $4,
              retry_interval_seconds = $5,
              summary_max_chars = $6,
              version = version + 1,
              updated_by = $7,
              updated_at = now()
        WHERE id = 1
          AND version = $8
      RETURNING *`,
      [
        value.lookbackHours,
        value.maxArticles,
        JSON.stringify(value.categoryScope),
        value.maxRetryCount,
        value.retryIntervalSeconds,
        value.summaryMaxChars,
        actorId,
        value.version,
      ],
    );
    if (!result.rows[0]) {
      throw new ConflictException({
        error: 'Daily awareness configuration was updated by another user',
        code: 'DAILY_AWARENESS_CONFIG_VERSION_CONFLICT',
      });
    }
    return this.toConfig(result.rows[0]);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  private validate(input: DailyAwarenessConfig): DailyAwarenessConfig {
    const categoryScope = normalizeDailyAwarenessCategoryScope(input.categoryScope);
    const valid = Number.isInteger(input.lookbackHours) && input.lookbackHours >= 1 && input.lookbackHours <= 168
      && Number.isInteger(input.maxArticles) && input.maxArticles >= 1 && input.maxArticles <= 3000
      && Number.isInteger(input.maxRetryCount) && input.maxRetryCount >= 0 && input.maxRetryCount <= 10
      && Number.isInteger(input.retryIntervalSeconds) && input.retryIntervalSeconds >= 1 && input.retryIntervalSeconds <= 3600
      && Number.isInteger(input.summaryMaxChars) && input.summaryMaxChars >= 100 && input.summaryMaxChars <= 10_000
      && Number.isInteger(input.version) && input.version >= 1
      && categoryScope.length > 0
      && categoryScope.every((item) => DAILY_AWARENESS_CATEGORIES.includes(item as typeof DAILY_AWARENESS_CATEGORIES[number]));
    if (!valid) {
      throw new BadRequestException({
        error: 'Invalid daily awareness configuration',
        code: 'DAILY_AWARENESS_INVALID_CONFIG',
      });
    }
    return { ...input, categoryScope };
  }

  private toConfig(row: Record<string, unknown>): DailyAwarenessConfig {
    return {
      lookbackHours: Number(row.lookback_hours || 24),
      maxArticles: Number(row.max_articles || 50),
      categoryScope: normalizeDailyAwarenessCategoryScope(this.stringArray(row.category_scope), true),
      maxRetryCount: Number(row.max_retry_count ?? 3),
      retryIntervalSeconds: Number(row.retry_interval_seconds || 30),
      summaryMaxChars: Number(row.summary_max_chars || 1200),
      version: Number(row.version || 1),
      updatedBy: String(row.updated_by || ''),
      updatedAt: this.dateString(row.updated_at),
    };
  }

  private stringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private dateString(value: unknown): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }

  private async getPool(): Promise<PgPool> {
    if (!this.pool) this.pool = createAuthPool({ max: 2 });
    return this.pool;
  }
}
