import { Controller, Get, Logger, Module } from '@nestjs/common';
import { SourceRecallAccessService } from './source-recall-access.service.js';
import { SourceRecallController } from './source-recall.controller.js';
import { SourceRecallGuard } from './source-recall.guard.js';
import { SourceRecallService } from './source-recall.service.js';
import { SourceRecallRuntimeService } from './source-recall-runtime.service.js';
import { RetrievalAuditService } from './reports/retrieval/audit/retrieval-audit.service.js';
import { RrfFusionService } from './reports/retrieval/fusion/rrf-fusion.service.js';
import { CandidatePolicyService } from './reports/retrieval/policy/candidate-policy.service.js';
import { EntityMatchService } from './reports/retrieval/policy/entity-match.service.js';
import { FallbackPolicyService } from './reports/retrieval/policy/fallback-policy.service.js';
import { EntityAliasService } from './reports/retrieval/query/entity-alias.service.js';
import { QueryParserService } from './reports/retrieval/query/query-parser.service.js';
import { QueryPolicyValidatorService } from './reports/retrieval/query/query-policy-validator.service.js';
import { RuleQueryAnalysisService } from './reports/retrieval/query/rule-query-analysis.service.js';
import { CandidateRerankerService } from './reports/retrieval/rerank/candidate-reranker.service.js';
import { DEFAULT_RETRIEVAL_CONFIG } from './reports/retrieval/retrieval.config.js';
import { RetrievalOrchestratorService } from './reports/retrieval/retrieval-orchestrator.service.js';
import { QUERY_EMBEDDING_PROVIDER, RETRIEVAL_CONFIG, RETRIEVAL_DB } from './reports/retrieval/retrieval.tokens.js';
import { EntityRetrieverService } from './reports/retrieval/retrievers/entity-retriever.service.js';
import { FulltextRetrieverService } from './reports/retrieval/retrievers/fulltext-retriever.service.js';
import { TitleRetrieverService } from './reports/retrieval/retrievers/title-retriever.service.js';
import { VectorRetrieverService } from './reports/retrieval/retrievers/vector-retriever.service.js';

@Controller('/healthz')
class SourceRecallHealthController {
  @Get()
  health() { return { ok: true, service: 'hermes-source-recall' }; }
}

const auditLogger = new Logger('SourceRecallAudit');

// Load retrieval providers only: no report workers, indexing timers or schema migrations.
@Module({
  controllers: [SourceRecallController, SourceRecallHealthController],
  providers: [
    SourceRecallAccessService, SourceRecallGuard, SourceRecallService, SourceRecallRuntimeService,
    { provide: RETRIEVAL_DB, useExisting: SourceRecallRuntimeService },
    { provide: QUERY_EMBEDDING_PROVIDER, useExisting: SourceRecallRuntimeService },
    { provide: RETRIEVAL_CONFIG, useValue: DEFAULT_RETRIEVAL_CONFIG },
    EntityAliasService, QueryPolicyValidatorService, RuleQueryAnalysisService, QueryParserService,
    VectorRetrieverService, FulltextRetrieverService, TitleRetrieverService, EntityRetrieverService,
    RrfFusionService, CandidateRerankerService, EntityMatchService, CandidatePolicyService,
    FallbackPolicyService, RetrievalOrchestratorService,
    {
      provide: RetrievalAuditService,
      useValue: {
        async persist(input: Parameters<RetrievalAuditService['persist']>[0]) {
          auditLogger.log(JSON.stringify({
            event: 'external_source_recall_result', requestId: input.runId,
            durationMs: input.diagnostics.durationMs, hits: input.diagnostics.acceptedCount,
            failedRetrievers: input.diagnostics.retrieverErrors.map((error) => error.source),
          }));
        },
      },
    },
  ],
})
export class SourceRecallModule {}
