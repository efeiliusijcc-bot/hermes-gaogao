import type { QueryProfile, RetrievalCandidate, RetrievalSource } from '../retrieval.types.js';

export interface RetrieverRequest {
  profile: QueryProfile;
  queryEmbedding: number[];
  limit: number;
}

export interface CandidateRetriever {
  readonly source: RetrievalSource;
  retrieve(request: RetrieverRequest): Promise<RetrievalCandidate[]>;
}
