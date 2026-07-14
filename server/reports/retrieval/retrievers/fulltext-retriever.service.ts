import { Inject, Injectable } from '@nestjs/common';
import type { RetrievalConfig, RetrievalDb } from '../retrieval.tokens.js';
import { RETRIEVAL_CONFIG, RETRIEVAL_DB } from '../retrieval.tokens.js';
import type { RetrievalCandidate } from '../retrieval.types.js';
import { hybridSidecarsMatchSourceTable } from '../indexing/hybrid-indexing.js';
import { mapRowsToCandidates, quoteRetrievalTable, resolveRetrievalProfile, type RetrievalDocumentRow } from './candidate-mapper.js';
import type { CandidateRetriever, RetrieverRequest } from './retriever.interface.js';

@Injectable()
export class FulltextRetrieverService implements CandidateRetriever {
  readonly source = 'fulltext' as const;

  constructor(
    @Inject(RETRIEVAL_DB) private readonly db: RetrievalDb,
    @Inject(RETRIEVAL_CONFIG) private readonly config: RetrievalConfig,
  ) {}

  async retrieve(request: RetrieverRequest): Promise<RetrievalCandidate[]> {
    const terms = this.terms(request);
    if (!terms || request.limit <= 0) return [];
    const storage = resolveRetrievalProfile(this.db, this.config);
    if (!hybridSidecarsMatchSourceTable(storage.sourceTable)) return [];
    const table = quoteRetrievalTable(storage.sourceTable);
    const result = await this.db.query<RetrievalDocumentRow>(`
      WITH query AS (SELECT websearch_to_tsquery('simple', $1) AS value)
      SELECT d.id::text AS document_id,
             COALESCE(NULLIF(d.ch_title, ''), d.entitle, '') AS title,
             d.summary,
             LEFT(d.content, 4000) AS content,
             d.data_source_url AS url,
             d.publish_time AS published_at,
             d.website_name AS source_name,
             ts_rank_cd(s.search_vector, query.value) AS score
        FROM ${table} d
        JOIN hybrid_retrieval_search_documents s ON s.document_id = d.id
        CROSS JOIN query
       WHERE s.search_vector @@ query.value
         AND ($2::timestamptz IS NULL OR d.publish_time >= $2::timestamptz)
         AND ($3::timestamptz IS NULL OR d.publish_time <= $3::timestamptz)
       ORDER BY score DESC
       LIMIT $4
    `, [
      terms,
      request.profile.timeRange?.start || null,
      request.profile.timeRange?.end || null,
      request.limit,
    ]);
    return mapRowsToCandidates(result.rows, this.source);
  }

  private terms(request: RetrieverRequest): string {
    const terms = [
      ...request.profile.coreEntities
        .filter((entity) => entity.enforcement !== 'disabled')
        .flatMap((entity) => [entity.canonicalName, ...entity.aliases]),
      ...request.profile.coreTopics,
    ].map((value) => value.trim().replace(/[^\p{L}\p{N}_-]+/gu, '')).filter((value) => value.length >= 2);
    return [...new Set(terms)].join(' OR ');
  }
}
