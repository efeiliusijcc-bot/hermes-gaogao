import { Inject, Injectable } from '@nestjs/common';
import type { RetrievalDb } from '../retrieval.tokens.js';
import { RETRIEVAL_DB } from '../retrieval.tokens.js';
import type {
  CandidateDecision,
  CleanRetrievalInput,
  QueryProfile,
  RetrievalDiagnostics,
} from '../retrieval.types.js';

@Injectable()
export class RetrievalAuditService {
  constructor(@Inject(RETRIEVAL_DB) private readonly db: RetrievalDb) {}

  async persist(input: {
    runId: string;
    request: CleanRetrievalInput;
    profile: QueryProfile;
    diagnostics: RetrievalDiagnostics;
    decisions: CandidateDecision[];
  }): Promise<void> {
    const runParams: unknown[] = [
      input.runId,
      input.request.reportJobId,
      input.request.topic,
      JSON.stringify(input.request),
      JSON.stringify(input.profile),
      JSON.stringify({
        vector: input.diagnostics.vectorCandidateCount,
        fulltext: input.diagnostics.fulltextCandidateCount,
        title: input.diagnostics.titleCandidateCount,
        entity: input.diagnostics.entityCandidateCount,
      }),
      input.diagnostics.mergedCandidateCount,
      input.diagnostics.acceptedCount,
      input.diagnostics.fallbackLevel,
      input.diagnostics.suspiciousEntityPolicy,
      input.diagnostics.durationMs,
      JSON.stringify(input.diagnostics.retrieverErrors),
      input.diagnostics.acceptedCount ? 'completed' : 'empty',
    ];
    if (!input.decisions.length) {
      await this.db.query(`
        INSERT INTO hybrid_retrieval_runs (
          id, report_job_id, topic, clean_query_input, query_profile,
          retriever_candidate_counts, merged_candidate_count, accepted_count,
          fallback_level, suspicious_entity_policy, duration_ms, retriever_errors, status
        ) VALUES ($1::uuid,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13)
      `, runParams);
      return;
    }

    const candidateParams = input.decisions.flatMap((decision) => [
      decision.candidate.documentId,
      decision.candidate.title,
      JSON.stringify(decision.candidate.retrievalSources),
      JSON.stringify(decision.candidate.ranks),
      JSON.stringify(decision.candidate.scores),
      decision.accepted ? 'accepted' : 'rejected',
      decision.reason,
    ]);
    const candidateValues = input.decisions.map((_, index) => {
      const start = 14 + index * 7;
      return `($${start},$${start + 1},$${start + 2}::jsonb,$${start + 3}::jsonb,$${start + 4}::jsonb,$${start + 5},$${start + 6})`;
    }).join(',');
    await this.db.query(`
      WITH inserted_run AS (
        INSERT INTO hybrid_retrieval_runs (
          id, report_job_id, topic, clean_query_input, query_profile,
          retriever_candidate_counts, merged_candidate_count, accepted_count,
          fallback_level, suspicious_entity_policy, duration_ms, retriever_errors, status
        ) VALUES ($1::uuid,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13)
        RETURNING id
      ), candidate (
        document_id, title, retrieval_sources, ranks, scores, decision, decision_reason
      ) AS (VALUES ${candidateValues})
          INSERT INTO hybrid_retrieval_candidates (
            retrieval_run_id, document_id, title, retrieval_sources, ranks, scores, decision, decision_reason
          )
          SELECT inserted_run.id, candidate.document_id, candidate.title,
                 candidate.retrieval_sources, candidate.ranks, candidate.scores,
                 candidate.decision, candidate.decision_reason
            FROM inserted_run CROSS JOIN candidate
    `, [...runParams, ...candidateParams]);
  }
}
