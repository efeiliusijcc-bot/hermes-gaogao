import type { RetrievalCandidate, RetrievalSource } from '../retrieval.types.js';
import type { RetrievalConfig, RetrievalDb, RetrievalStorageProfile } from '../retrieval.tokens.js';

export interface RetrievalDocumentRow {
  document_id: string | number;
  title: string | null;
  summary: string | null;
  content: string | null;
  url: string | null;
  published_at: string | Date | null;
  source_name: string | null;
  score: string | number | null;
}

export function mapRowsToCandidates(
  rows: RetrievalDocumentRow[],
  source: RetrievalSource,
): RetrievalCandidate[] {
  return rows.map((row, index) => {
    const rawScore = row.score === null || row.score === undefined ? undefined : Number(row.score);
    const score = rawScore !== undefined && Number.isFinite(rawScore) ? rawScore : undefined;
    return {
      documentId: String(row.document_id),
      title: String(row.title || ''),
      summary: row.summary || undefined,
      content: row.content || undefined,
      url: row.url || undefined,
      publishedAt: row.published_at instanceof Date ? row.published_at.toISOString() : row.published_at || undefined,
      sourceName: row.source_name || undefined,
      retrievalSources: [source],
      ranks: { [source]: index + 1 },
      scores: score === undefined ? {} : { [source]: score },
    };
  });
}

export function quoteRetrievalTable(table: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('Invalid retrieval source table');
  return `"${table}"`;
}

export function resolveRetrievalProfile(
  db: RetrievalDb,
  config: RetrievalConfig,
): RetrievalStorageProfile {
  return db.retrievalProfile?.() || {
    sourceTable: config.sourceTable,
    embeddingModel: config.embeddingModel,
    embeddingDimensions: config.embeddingDimensions,
  };
}
