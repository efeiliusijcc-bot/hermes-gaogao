import { createRequire } from 'module';

export type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

const require = createRequire(import.meta.url);

export function getAuthDatabaseUrl(): string {
  return process.env.AUTH_DATABASE_URL
    || process.env.AUTH_POSTGRES_DATABASE_URL
    || process.env.PGVECTOR_DATABASE_URL
    || process.env.POSTGRES_DATABASE_URL
    || process.env.DATABASE_URL
    || '';
}

export function createAuthPool(config: Record<string, unknown> = {}): PgPool {
  const connectionString = getAuthDatabaseUrl();
  if (!connectionString) throw new Error('AUTH_DATABASE_URL is not configured');
  const { Pool } = require('pg') as { Pool: new (poolConfig: Record<string, unknown>) => PgPool };
  return new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5000,
    ...config,
  });
}
