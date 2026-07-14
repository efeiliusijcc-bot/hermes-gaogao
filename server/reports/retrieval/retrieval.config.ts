import type { QueryProfile } from './retrieval.types.js';
import type { RetrievalConfig } from './retrieval.tokens.js';

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  sourceTable: process.env.PGVECTOR_NEWS_TABLE || 'vector_materials_text_embedding_v4',
  embeddingModel: process.env.PGVECTOR_EMBEDDING_MODEL || 'text-embedding-v4',
  embeddingDimensions: Math.max(1, Number(process.env.PGVECTOR_EMBEDDING_DIMENSIONS || 1024)),
  vectorTopK: 100,
  fulltextTopK: 100,
  titleTopK: 50,
  entityTopK: 100,
  fusionTopK: 50,
  finalTopK: 12,
  rrfK: 60,
  minimumCandidateCountForFallback: 10,
  minimumFinalScore: 0.28,
  emergencyMinimumFinalScore: 0.16,
  expandedTopKMultiplier: 2,
  freshnessHalfLifeDays: 90,
  sourceQualityDefault: 0.5,
  queryEmbeddingText: (profile: QueryProfile) => [
    profile.originalQuery,
    profile.supplement,
    ...profile.queryVariants.slice(1, 4),
  ].filter(Boolean).join('\n').replace(/\s+/g, ' ').trim(),
};

export function mergeRetrievalConfig(overrides?: Partial<RetrievalConfig>): RetrievalConfig {
  return { ...DEFAULT_RETRIEVAL_CONFIG, ...overrides };
}
