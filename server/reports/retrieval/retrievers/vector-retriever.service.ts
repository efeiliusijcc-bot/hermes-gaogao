import { Inject, Injectable } from '@nestjs/common';
import type { RetrievalConfig, RetrievalDb } from '../retrieval.tokens.js';
import { RETRIEVAL_CONFIG, RETRIEVAL_DB } from '../retrieval.tokens.js';
import type { RetrievalCandidate } from '../retrieval.types.js';
import { mapRowsToCandidates, quoteRetrievalTable, resolveRetrievalProfile, type RetrievalDocumentRow } from './candidate-mapper.js';
import type { CandidateRetriever, RetrieverRequest } from './retriever.interface.js';

@Injectable()
export class VectorRetrieverService implements CandidateRetriever {
  readonly source = 'vector' as const;

  constructor(
    @Inject(RETRIEVAL_DB) private readonly db: RetrievalDb,
    @Inject(RETRIEVAL_CONFIG) private readonly config: RetrievalConfig,
  ) {}

  async retrieve(request: RetrieverRequest): Promise<RetrievalCandidate[]> {
    const profile = resolveRetrievalProfile(this.db, this.config);
    if (request.queryEmbedding.length !== profile.embeddingDimensions || request.limit <= 0) return [];
    const table = quoteRetrievalTable(profile.sourceTable);
    const vector = `[${request.queryEmbedding.map((value) => Number(value).toFixed(8)).join(',')}]`;
    const sql = `
      SELECT id::text AS document_id,
             COALESCE(NULLIF(ch_title, ''), entitle, '') AS title,
             summary,
             LEFT(content, 4000) AS content,
             data_source_url AS url,
             publish_time AS published_at,
             website_name AS source_name,
             1 - (embedding_vector <=> $1::vector) AS score
        FROM ${table}
       WHERE embedding_vector IS NOT NULL
         AND embedding_model = $2
         AND ($3::timestamptz IS NULL OR publish_time >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR publish_time <= $4::timestamptz)
       ORDER BY embedding_vector <=> $1::vector
       LIMIT $5
    `;
    const params = [
      vector,
      profile.embeddingModel,
      request.profile.timeRange?.start || null,
      request.profile.timeRange?.end || null,
      request.limit,
    ];
    const result = this.db.queryWithHnswEfSearch
      ? await this.db.queryWithHnswEfSearch<RetrievalDocumentRow>(200, sql, params)
      : await this.db.query<RetrievalDocumentRow>(sql, params);
    return mapRowsToCandidates(result.rows, this.source);
  }
}
