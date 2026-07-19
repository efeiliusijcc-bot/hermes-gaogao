import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import {
  DAILY_AWARENESS_MYSQL_DATABASE,
  DAILY_AWARENESS_MYSQL_HOST,
  DAILY_AWARENESS_MYSQL_PASSWORD,
  DAILY_AWARENESS_MYSQL_PORT,
  DAILY_AWARENESS_MYSQL_TABLE_PREFIX,
  DAILY_AWARENESS_MYSQL_USER,
} from './config.js';

export interface DailyAwarenessMysqlRow {
  id: string;
  title: string;
  summary: string;
  designatedTag: string;
  tag: string;
  publishedAt: string;
  publisher: string;
  url: string;
  dataType: string;
}

interface DailyAwarenessMysqlRawRow extends RowDataPacket {
  id?: number | string | null;
  ch_title?: string | null;
  entitle?: string | null;
  summary?: string | null;
  designated_tag?: string | null;
  tag?: string | null;
  publish_time?: string | Date | null;
  website_name?: string | null;
  data_source_url?: string | null;
  data_type?: string | null;
}

export interface DailyAwarenessMysqlQuery {
  text: string;
  values: string[];
}

export function deriveDailyMysqlTableName(businessDate: string): string {
  const value = String(businessDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('businessDate must be YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('businessDate must be a valid date');
  }
  return `${DAILY_AWARENESS_MYSQL_TABLE_PREFIX}${value.replaceAll('-', '')}`;
}

export function normalizeDailyAwarenessMysqlRow(row: DailyAwarenessMysqlRawRow | Record<string, unknown>): DailyAwarenessMysqlRow {
  const value = row as Record<string, unknown>;
  const title = String(value.ch_title || value.entitle || '').trim();
  const designatedTag = String(value.designated_tag || '').trim() || '其他';
  const publishedAt = value.publish_time instanceof Date
    ? (Number.isNaN(value.publish_time.getTime()) ? '' : value.publish_time.toISOString())
    : String(value.publish_time || '').trim();
  return {
    id: String(value.id || '').trim(),
    title,
    summary: String(value.summary || '').trim(),
    designatedTag,
    tag: String(value.tag || '').trim(),
    publishedAt,
    publisher: String(value.website_name || '').trim(),
    url: String(value.data_source_url || '').trim(),
    dataType: String(value.data_type || '').trim(),
  };
}

export function buildDailyAwarenessMysqlQuery(tableName: string, categoryScope: string[]): DailyAwarenessMysqlQuery {
  if (!/^data_\d{8}$/.test(tableName)) throw new Error('Invalid daily MySQL table name');
  const categories = Array.from(new Set(categoryScope.map((item) => String(item || '').trim()).filter(Boolean)));
  const categoryClause = categories.length
    ? `\n  AND COALESCE(NULLIF(TRIM(designated_tag), ''), '其他') IN (${categories.map(() => '?').join(',')})`
    : '';
  return {
    text: `SELECT id, ch_title, entitle, summary, designated_tag, tag, publish_time, website_name, data_source_url, data_type
FROM \`${tableName}\`
WHERE NULLIF(TRIM(COALESCE(ch_title, entitle, '')), '') IS NOT NULL
  AND NULLIF(TRIM(COALESCE(summary, '')), '') IS NOT NULL${categoryClause}
ORDER BY publish_time DESC, id DESC`,
    values: categories,
  };
}

@Injectable()
export class DailyAwarenessMysqlService implements OnModuleDestroy {
  private pool: Pool | null = null;

  async listForBusinessDate(businessDate: string, categoryScope: string[]): Promise<DailyAwarenessMysqlRow[]> {
    const tableName = deriveDailyMysqlTableName(businessDate);
    const query = buildDailyAwarenessMysqlQuery(tableName, categoryScope);
    try {
      const [rows] = await this.getPool().query<DailyAwarenessMysqlRawRow[]>(query.text, query.values);
      return rows.map((row) => normalizeDailyAwarenessMysqlRow(row));
    } catch (error) {
      if (String((error as { code?: unknown })?.code || '') === 'ER_NO_SUCH_TABLE') {
        throw Object.assign(new Error(`Daily Awareness MySQL table does not exist: ${tableName}`), {
          code: 'DAILY_AWARENESS_MYSQL_TABLE_NOT_FOUND',
        });
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = createPool({
        host: DAILY_AWARENESS_MYSQL_HOST,
        port: DAILY_AWARENESS_MYSQL_PORT,
        database: DAILY_AWARENESS_MYSQL_DATABASE,
        user: DAILY_AWARENESS_MYSQL_USER,
        password: DAILY_AWARENESS_MYSQL_PASSWORD,
        waitForConnections: true,
        connectionLimit: 4,
        queueLimit: 0,
        charset: 'utf8mb4',
      });
    }
    return this.pool;
  }
}
