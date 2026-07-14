import { Inject, Injectable } from '@nestjs/common';
import type { RetrievalConfig, RetrievalDb } from '../retrieval.tokens.js';
import { RETRIEVAL_CONFIG, RETRIEVAL_DB } from '../retrieval.tokens.js';
import type { RetrievalCandidate } from '../retrieval.types.js';
import { hybridSidecarsMatchSourceTable } from '../indexing/hybrid-indexing.js';
import { mapRowsToCandidates, quoteRetrievalTable, resolveRetrievalProfile, type RetrievalDocumentRow } from './candidate-mapper.js';
import type { CandidateRetriever, RetrieverRequest } from './retriever.interface.js';

@Injectable()
export class TitleRetrieverService implements CandidateRetriever {
  readonly source = 'title' as const;

  constructor(
    @Inject(RETRIEVAL_DB) private readonly db: RetrievalDb,
    @Inject(RETRIEVAL_CONFIG) private readonly config: RetrievalConfig,
  ) {}

  async retrieve(request: RetrieverRequest): Promise<RetrievalCandidate[]> {
    const patterns = this.patterns(request);
    if (!patterns.length || request.limit <= 0) return [];
    const storage = resolveRetrievalProfile(this.db, this.config);
    if (!hybridSidecarsMatchSourceTable(storage.sourceTable)) return [];
    const table = quoteRetrievalTable(storage.sourceTable);
    const title = `COALESCE(NULLIF(ch_title, ''), entitle, '')`;
    const keywordMatch = patterns
      .map((_, index) => `${title} ILIKE $${index + 2}`)
      .join(' OR ');
    const timeStartParam = patterns.length + 2;
    const timeEndParam = patterns.length + 3;
    const limitParam = patterns.length + 4;
    const result = await this.db.query<RetrievalDocumentRow>(`
      SELECT id::text AS document_id,
             ${title} AS title,
             summary,
             LEFT(content, 4000) AS content,
             data_source_url AS url,
             publish_time AS published_at,
             website_name AS source_name,
             GREATEST(similarity(${title}, $1), CASE WHEN (${keywordMatch}) THEN 0.85 ELSE 0 END) AS score
        FROM ${table}
       WHERE (${title} % $1 OR ${keywordMatch})
         AND ($${timeStartParam}::timestamptz IS NULL OR publish_time >= $${timeStartParam}::timestamptz)
         AND ($${timeEndParam}::timestamptz IS NULL OR publish_time <= $${timeEndParam}::timestamptz)
       ORDER BY score DESC
       LIMIT $${limitParam}
    `, [
      request.profile.originalQuery,
      ...patterns,
      request.profile.timeRange?.start || null,
      request.profile.timeRange?.end || null,
      request.limit,
    ]);
    return mapRowsToCandidates(result.rows, this.source);
  }

  private patterns(request: RetrieverRequest): string[] {
    const values = [
      ...request.profile.coreEntities
        .filter((entity) => entity.enforcement !== 'disabled')
        .flatMap((entity) => [entity.canonicalName, ...entity.aliases]),
      ...request.profile.coreTopics,
    ].map((value) => value.trim()).filter((value) => value.length >= 3);
    const originalQuery = request.profile.originalQuery.trim();
    if (!values.length && originalQuery.length >= 3) values.push(originalQuery);
    return [...new Set(values)].map((value) => `%${value}%`);
  }
}
