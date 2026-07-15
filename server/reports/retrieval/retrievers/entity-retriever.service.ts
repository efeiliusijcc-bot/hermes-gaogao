import { Inject, Injectable } from '@nestjs/common';
import type { RetrievalConfig, RetrievalDb } from '../retrieval.tokens.js';
import { RETRIEVAL_CONFIG, RETRIEVAL_DB } from '../retrieval.tokens.js';
import type { RetrievalCandidate } from '../retrieval.types.js';
import { hybridSidecarsMatchSourceTable } from '../indexing/hybrid-indexing.js';
import { mapRowsToCandidates, quoteRetrievalTable, resolveRetrievalProfile, type RetrievalDocumentRow } from './candidate-mapper.js';
import type { CandidateRetriever, RetrieverRequest } from './retriever.interface.js';

interface AvailabilityRow { available: boolean }

@Injectable()
export class EntityRetrieverService implements CandidateRetriever {
  readonly source = 'entity' as const;

  constructor(
    @Inject(RETRIEVAL_DB) private readonly db: RetrievalDb,
    @Inject(RETRIEVAL_CONFIG) private readonly config: RetrievalConfig,
  ) {}

  async retrieve(request: RetrieverRequest): Promise<RetrievalCandidate[]> {
    const entityIds = request.profile.coreEntities
      .filter((entity) => entity.enforcement !== 'disabled')
      .map((entity) => entity.canonicalId);
    if (!entityIds.length || request.limit <= 0) return [];
    const storage = resolveRetrievalProfile(this.db, this.config);
    if (!hybridSidecarsMatchSourceTable(storage.sourceTable)) return [];
    const availability = await this.db.query<AvailabilityRow>(
      `SELECT to_regclass('public.hybrid_retrieval_document_entities') IS NOT NULL AS available`,
    );
    if (availability.rows[0]?.available !== true) return [];
    const table = quoteRetrievalTable(storage.sourceTable);
    const result = await this.db.query<RetrievalDocumentRow>(`
      SELECT d.id::text AS document_id,
             COALESCE(NULLIF(d.ch_title, ''), d.entitle, '') AS title,
             d.summary,
             LEFT(d.content, 4000) AS content,
             d.data_source_url AS url,
             d.publish_time AS published_at,
             d.website_name AS source_name,
             COUNT(DISTINCT e.entity_id)::float / $2::float AS score
        FROM ${table} d
        JOIN hybrid_retrieval_document_entities e ON e.document_id = d.id
       WHERE e.entity_id = ANY($1::text[])
         AND ($3::timestamptz IS NULL OR d.publish_time >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR d.publish_time <= $4::timestamptz)
       GROUP BY d.id
       ORDER BY score DESC, d.publish_time DESC NULLS LAST
       LIMIT $5
    `, [
      entityIds,
      entityIds.length,
      request.profile.timeRange?.start || null,
      request.profile.timeRange?.end || null,
      request.limit,
    ]);
    return mapRowsToCandidates(result.rows, this.source);
  }
}
