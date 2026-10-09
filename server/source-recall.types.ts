import type {
  CandidateRanks,
  CandidateScores,
  EntityType,
  RetrievalDiagnostics,
  RetrievalSource,
} from './reports/retrieval/retrieval.types.js';

export interface SourceRecallEntityInput {
  name?: unknown;
  aliases?: unknown;
  type?: unknown;
  required?: unknown;
}

export interface SourceRecallRequest {
  topic?: unknown;
  supplement?: unknown;
  explicitEntities?: unknown;
  lookbackDays?: unknown;
  timeRange?: unknown;
  limit?: unknown;
}

export interface ValidatedSourceRecallRequest {
  topic: string;
  supplement: string;
  explicitEntities: Array<{
    name: string;
    aliases: string[];
    type?: EntityType;
    required: boolean;
  }>;
  timeRange: { start?: string; end?: string };
  limit: number;
}

export type SourceRecallStatus = 'hit' | 'empty' | 'fallback' | 'unavailable';

export interface PublicRetrieverError {
  source: RetrievalSource | 'embedding';
  message: string;
}

export interface SourceRecallResponse {
  status: SourceRecallStatus;
  requestId: string;
  retrievalMode: 'hybrid';
  sources: Array<{
    documentId: string;
    title: string;
    url?: string;
    summary?: string;
    excerpt?: string;
    sourceName?: string;
    publishedAt?: string;
    retrievalSources: RetrievalSource[];
    ranks: CandidateRanks;
    scores: CandidateScores;
  }>;
  totalHits: number;
  diagnostics: Omit<RetrievalDiagnostics, 'retrieverErrors'> & {
    retrieverErrors: PublicRetrieverError[];
  };
  updatedAt: string;
}
