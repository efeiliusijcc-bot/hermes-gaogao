import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createRequire } from 'node:module';
import OpenAI from 'openai';
import { DEFAULT_RETRIEVAL_CONFIG } from './reports/retrieval/retrieval.config.js';
import type { RetrievalDb } from './reports/retrieval/retrieval.tokens.js';

type QueryResult = { rows: unknown[]; rowCount?: number | null };
type Client = { query(sql: string, params?: unknown[]): Promise<QueryResult>; release(): void };
type Pool = Client & { connect(): Promise<Client>; end(): Promise<void>; on(event: string, listener: () => void): void };

export const SOURCE_RECALL_POOL_OPTIONS = {
  max: 2,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10000,
  statement_timeout: 5000,
  options: '-c default_transaction_read_only=on -c max_parallel_workers_per_gather=0 -c work_mem=4MB',
  application_name: 'hermes-source-recall',
};

@Injectable()
export class SourceRecallRuntimeService implements RetrievalDb, OnModuleDestroy {
  private readonly logger = new Logger(SourceRecallRuntimeService.name);
  private pool?: Pool;

  retrievalProfile() {
    const { sourceTable, embeddingModel, embeddingDimensions } = DEFAULT_RETRIEVAL_CONFIG;
    return { sourceTable, embeddingModel, embeddingDimensions };
  }

  private getPool(): Pool {
    if (!this.pool) {
      const connectionString = process.env.SOURCE_RECALL_DATABASE_URL;
      if (!connectionString) throw new Error('Source recall database is not configured');
      const { Pool: PgPool } = createRequire(import.meta.url)('pg') as {
        Pool: new (options: Record<string, unknown>) => Pool;
      };
      this.pool = new PgPool({ connectionString, ...SOURCE_RECALL_POOL_OPTIONS });
      this.pool.on('error', () => this.logger.warn('Source recall idle database connection lost'));
    }
    return this.pool;
  }

  async query<T>(sql: string, params: readonly unknown[] = []) {
    const result = await this.getPool().query(sql, [...params]);
    return { ...result, rows: result.rows as T[] };
  }

  async queryWithHnswEfSearch<T>(efSearch: number, sql: string, params: readonly unknown[] = []) {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL hnsw.ef_search = ${Math.max(40, Math.min(400, Math.floor(efSearch)))}`);
      const result = await client.query(sql, [...params]);
      await client.query('COMMIT');
      return { ...result, rows: result.rows as T[] };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    const apiKey = process.env.SOURCE_RECALL_EMBEDDING_API_KEY;
    if (!apiKey) throw new Error('Source recall embedding key is not configured');
    const client = new OpenAI({
      apiKey,
      baseURL: process.env.PGVECTOR_EMBEDDING_BASE_URL,
      timeout: 10000,
      maxRetries: 0,
    });
    const { embeddingModel, embeddingDimensions } = this.retrievalProfile();
    const response = await client.embeddings.create({
      model: embeddingModel,
      dimensions: embeddingDimensions,
      input: text.slice(0, 6000),
    });
    const vector = response.data[0]?.embedding || [];
    if (vector.length !== embeddingDimensions || vector.some((value) => !Number.isFinite(value))) {
      throw new Error('Source recall embedding dimensions or values are invalid');
    }
    return vector;
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}
