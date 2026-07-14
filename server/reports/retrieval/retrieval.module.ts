import { Module } from '@nestjs/common';
import { ResearchKeysService } from '../../research-keys.service.js';
import { VectorSourceService } from '../../vector-source.service.js';
import { ReportsRetrievalAdapter } from '../reports-retrieval.adapter.js';
import { RetrievalAuditService } from './audit/retrieval-audit.service.js';
import { RrfFusionService } from './fusion/rrf-fusion.service.js';
import { CandidatePolicyService } from './policy/candidate-policy.service.js';
import { EntityMatchService } from './policy/entity-match.service.js';
import { FallbackPolicyService } from './policy/fallback-policy.service.js';
import { EntityAliasService } from './query/entity-alias.service.js';
import { QueryParserService } from './query/query-parser.service.js';
import { QueryPolicyValidatorService } from './query/query-policy-validator.service.js';
import { RuleQueryAnalysisService } from './query/rule-query-analysis.service.js';
import { CandidateRerankerService } from './rerank/candidate-reranker.service.js';
import { DEFAULT_RETRIEVAL_CONFIG } from './retrieval.config.js';
import { RetrievalOrchestratorService } from './retrieval-orchestrator.service.js';
import { QUERY_EMBEDDING_PROVIDER, RETRIEVAL_CONFIG, RETRIEVAL_DB } from './retrieval.tokens.js';
import { EntityRetrieverService } from './retrievers/entity-retriever.service.js';
import { FulltextRetrieverService } from './retrievers/fulltext-retriever.service.js';
import { TitleRetrieverService } from './retrievers/title-retriever.service.js';
import { VectorRetrieverService } from './retrievers/vector-retriever.service.js';

@Module({
  providers: [
    ResearchKeysService,
    VectorSourceService,
    { provide: RETRIEVAL_DB, useExisting: VectorSourceService },
    { provide: QUERY_EMBEDDING_PROVIDER, useExisting: VectorSourceService },
    { provide: RETRIEVAL_CONFIG, useValue: DEFAULT_RETRIEVAL_CONFIG },
    EntityAliasService,
    QueryPolicyValidatorService,
    RuleQueryAnalysisService,
    QueryParserService,
    VectorRetrieverService,
    FulltextRetrieverService,
    TitleRetrieverService,
    EntityRetrieverService,
    RrfFusionService,
    CandidateRerankerService,
    EntityMatchService,
    CandidatePolicyService,
    FallbackPolicyService,
    RetrievalAuditService,
    RetrievalOrchestratorService,
    ReportsRetrievalAdapter,
  ],
  exports: [ResearchKeysService, VectorSourceService, ReportsRetrievalAdapter],
})
export class RetrievalModule {}
