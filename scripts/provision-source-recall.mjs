// Run once through the existing API container's Node runtime; capture stdout to a 0600 env file.
// This creates one restricted login and never starts the report application.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
const require = createRequire('/app/package.json');
const { Client } = require('pg');
const { ResearchKeysService } = await import('/app/dist-server/server/research-keys.service.js');
const env = process.env;
const databaseUrl = env.PGVECTOR_DATABASE_URL || env.DATABASE_URL;
const db = new Client({ connectionString: databaseUrl, application_name: 'source-recall-provision', statement_timeout: 5000 });
const qi = (value) => '"' + String(value).replaceAll('"', '""') + '"';
const role = 'hermes_source_recall';
try {
  const embeddingKey = await new ResearchKeysService().getEffectiveKey('openaiEmbeddingApiKey');
  if (!embeddingKey) throw new Error('Embedding key unavailable');
  await db.connect();
  const existing = await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
  if (existing.rowCount) throw new Error('Recall role already exists; preserve its existing credential file');
  const password = randomBytes(32).toString('hex');
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  const table = env.PGVECTOR_NEWS_TABLE || 'vector_materials_text_embedding_v4';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error('Unexpected source table');
  await db.query('BEGIN');
  await db.query(`CREATE ROLE ${qi(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2`);
  await db.query(`ALTER ROLE ${qi(role)} SET default_transaction_read_only = on`);
  await db.query(`ALTER ROLE ${qi(role)} SET statement_timeout = '5s'`);
  await db.query(`ALTER ROLE ${qi(role)} SET idle_in_transaction_session_timeout = '10s'`);
  await db.query(`GRANT CONNECT ON DATABASE ${qi(database)} TO ${qi(role)}`);
  await db.query(`GRANT USAGE ON SCHEMA public TO ${qi(role)}`);
  await db.query(`GRANT SELECT ON TABLE public.${qi(table)}, public.hybrid_retrieval_search_documents, public.hybrid_retrieval_document_entities TO ${qi(role)}`);
  await db.query('COMMIT');
  url.username = role;
  url.password = password;
  const config = {
    NODE_ENV: 'production', PORT: '1555',
    SOURCE_RECALL_API_ENABLED: 'true',
    SOURCE_RECALL_API_KEY: env.SOURCE_RECALL_API_KEY || randomBytes(32).toString('hex'),
    SOURCE_RECALL_CLIENT_ID: 'external-agent',
    SOURCE_RECALL_RATE_LIMIT_PER_MINUTE: '10',
    SOURCE_RECALL_MAX_CONCURRENCY: '1',
    SOURCE_RECALL_DATABASE_URL: url.toString(),
    SOURCE_RECALL_EMBEDDING_API_KEY: embeddingKey,
    PGVECTOR_NEWS_TABLE: table,
    PGVECTOR_EMBEDDING_MODEL: env.PGVECTOR_EMBEDDING_MODEL || 'text-embedding-v4',
    PGVECTOR_EMBEDDING_DIMENSIONS: env.PGVECTOR_EMBEDDING_DIMENSIONS || '1024',
    PGVECTOR_EMBEDDING_BASE_URL: env.PGVECTOR_EMBEDDING_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  };
  process.stdout.write(Object.entries(config).map(([key, value]) => {
    if (/[\r\n]/.test(value)) throw new Error('Multiline environment value rejected');
    return `${key}=${value}`;
  }).join('\n') + '\n');
} catch {
  await db.query('ROLLBACK').catch(() => undefined);
  console.error('Source recall provisioning failed; inspect role existence and database access without printing credentials.');
  process.exitCode = 1;
} finally {
  await db.end();
}
