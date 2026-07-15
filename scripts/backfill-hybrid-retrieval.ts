import { createRequire } from 'node:module';
import {
  assertHybridSidecarSourceTable,
  extractHybridEntityIds,
  tokenizeHybridSearchText,
} from '../server/reports/retrieval/indexing/hybrid-indexing.js';

interface SourceRow {
  id: number;
  ch_title: string | null;
  entitle: string | null;
  summary: string | null;
  content_excerpt: string | null;
  content_hash: string | null;
}

interface PgPool {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as { Pool: new (config: Record<string, unknown>) => PgPool };

function cliNumber(name: string, fallback: number): number {
  const argument = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  const value = Number(argument?.slice(name.length + 3) || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Invalid PGVECTOR_NEWS_TABLE');
  return `"${value}"`;
}

async function main() {
  const connectionString = process.env.PGVECTOR_DATABASE_URL || process.env.POSTGRES_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('PGVECTOR_DATABASE_URL is not configured');
  const tableName = process.env.PGVECTOR_NEWS_TABLE || 'vector_materials_text_embedding_v4';
  assertHybridSidecarSourceTable(tableName);
  const table = quoteIdentifier(tableName);
  const batchSize = Math.min(2000, cliNumber('batch-size', 500));
  const maxRows = cliNumber('max-rows', Number.MAX_SAFE_INTEGER);
  const pool = new Pool({ connectionString, max: 2 });
  let processed = 0;
  let lastId = 0;

  try {
    while (processed < maxRows) {
      const remaining = Math.min(batchSize, maxRows - processed);
      const result = await pool.query<SourceRow>(`
        SELECT d.id, d.ch_title, d.entitle, d.summary, d.content_excerpt, d.content_hash
          FROM ${table} d
          LEFT JOIN hybrid_retrieval_search_documents s ON s.document_id = d.id
         WHERE d.id > $2
           AND (s.document_id IS NULL OR s.content_hash IS DISTINCT FROM d.content_hash)
         ORDER BY d.id
         LIMIT $1
      `, [remaining, lastId]);
      if (!result.rows.length) break;
      lastId = result.rows[result.rows.length - 1]?.id || lastId;

      await pool.query('BEGIN');
      try {
        await pool.query('SET LOCAL enable_seqscan = off');
        const updates = result.rows.map((row) => {
          const text = [row.ch_title, row.entitle, row.summary, row.content_excerpt]
            .filter(Boolean)
            .join('\n')
            .slice(0, 4000);
          return {
            id: row.id,
            searchTokens: tokenizeHybridSearchText(text) || 'empty_document',
            contentHash: row.content_hash,
            entityIds: extractHybridEntityIds(text),
          };
        });
        const updateParams = updates.flatMap((item) => [item.id, item.contentHash, item.searchTokens]);
        const updateValues = updates.map((_, index) =>
          `($${index * 3 + 1}::integer,$${index * 3 + 2}::text,$${index * 3 + 3}::text,now())`,
        ).join(',');
        await pool.query(`
          INSERT INTO hybrid_retrieval_search_documents
            (document_id, content_hash, search_tokens, updated_at)
          VALUES ${updateValues}
          ON CONFLICT (document_id) DO UPDATE SET
            content_hash = EXCLUDED.content_hash,
            search_tokens = EXCLUDED.search_tokens,
            updated_at = now()
        `, updateParams);

        const documentIds = updates.map((item) => item.id);
        await pool.query(
          'DELETE FROM hybrid_retrieval_document_entities WHERE document_id = ANY($1::integer[])',
          [documentIds],
        );
        const entityRows = updates.flatMap((item) =>
          item.entityIds.map((entityId) => ({ documentId: item.id, entityId })),
        );
        if (entityRows.length) {
          const entityParams = entityRows.flatMap((item) => [item.documentId, item.entityId]);
          const entityValues = entityRows.map((_, index) =>
            `($${index * 2 + 1}::integer,$${index * 2 + 2}::text,1,1,now())`,
          ).join(',');
          await pool.query(`
            INSERT INTO hybrid_retrieval_document_entities
              (document_id, entity_id, mention_count, confidence, updated_at)
            VALUES ${entityValues}
            ON CONFLICT (document_id, entity_id) DO UPDATE SET updated_at = now()
          `, entityParams);
        }
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
      processed += result.rows.length;
      console.error(JSON.stringify({ status: 'progress', processed, table: tableName }));
    }
    console.log(JSON.stringify({ status: 'ok', processed, table: tableName }, null, 2));
  } finally {
    await pool.end();
  }
}

await main();
