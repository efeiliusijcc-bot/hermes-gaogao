import type { QueryProfile } from './retrieval.types.js';

export const RETRIEVAL_DB = Symbol('RETRIEVAL_DB');
export const QUERY_EMBEDDING_PROVIDER = Symbol('QUERY_EMBEDDING_PROVIDER');
export const RETRIEVAL_CONFIG = Symbol('RETRIEVAL_CONFIG');

export interface RetrievalDb {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
  queryWithHnswEfSearch?<T>(
    efSearch: number,
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
  retrievalProfile?(): RetrievalStorageProfile;
}

export interface RetrievalStorageProfile {
  sourceTable: string;
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface QueryEmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
  retrievalProfile?(): RetrievalStorageProfile;
}

export interface RetrievalConfig {
  sourceTable: string;
  embeddingModel: string;
  embeddingDimensions: number;
  vectorTopK: number;
  fulltextTopK: number;
  titleTopK: number;
  entityTopK: number;
  fusionTopK: number;
  finalTopK: number;
  rrfK: number;
  minimumCandidateCountForFallback: number;
  minimumFinalScore: number;
  emergencyMinimumFinalScore: number;
  expandedTopKMultiplier: number;
  freshnessHalfLifeDays: number;
  sourceQualityDefault: number;
  queryEmbeddingText?(profile: QueryProfile): string;
}
