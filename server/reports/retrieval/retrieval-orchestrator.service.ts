import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { QueryEmbeddingProvider, RetrievalConfig } from './retrieval.tokens.js';
import { QUERY_EMBEDDING_PROVIDER, RETRIEVAL_CONFIG } from './retrieval.tokens.js';
import type {
  CleanRetrievalInput,
  QueryProfile,
  RetrievalCandidate,
  RetrievalDiagnostics,
  RetrievalResult,
  RetrievalSource,
} from './retrieval.types.js';
import { QueryParserService } from './query/query-parser.service.js';
import { VectorRetrieverService } from './retrievers/vector-retriever.service.js';
import { FulltextRetrieverService } from './retrievers/fulltext-retriever.service.js';
import { TitleRetrieverService } from './retrievers/title-retriever.service.js';
import { EntityRetrieverService } from './retrievers/entity-retriever.service.js';
import { RrfFusionService } from './fusion/rrf-fusion.service.js';
import { CandidateRerankerService } from './rerank/candidate-reranker.service.js';
import { FallbackPolicyService } from './policy/fallback-policy.service.js';
import { RetrievalAuditService } from './audit/retrieval-audit.service.js';
import { assertHybridSidecarSourceTable } from './indexing/hybrid-indexing.js';

interface RetrievalPass {
  fused: RetrievalCandidate[];
  reranked: RetrievalCandidate[];
  counts: Record<RetrievalSource, number>;
  errors: RetrievalDiagnostics['retrieverErrors'];
}

@Injectable()
export class RetrievalOrchestratorService {
  private readonly logger = new Logger(RetrievalOrchestratorService.name);

  constructor(
    @Inject(QUERY_EMBEDDING_PROVIDER) private readonly embedding: QueryEmbeddingProvider,
    @Inject(RETRIEVAL_CONFIG) private readonly config: RetrievalConfig,
    private readonly parser: QueryParserService,
    private readonly vectorRetriever: VectorRetrieverService,
    private readonly fulltextRetriever: FulltextRetrieverService,
    private readonly titleRetriever: TitleRetrieverService,
    private readonly entityRetriever: EntityRetrieverService,
    private readonly fusion: RrfFusionService,
    private readonly reranker: CandidateRerankerService,
    private readonly fallback: FallbackPolicyService,
    private readonly audit: RetrievalAuditService,
  ) {}

  async retrieve(request: CleanRetrievalInput): Promise<RetrievalResult> {
    const storage = this.embedding.retrievalProfile?.();
    if (storage) assertHybridSidecarSourceTable(storage.sourceTable);
    const startedAt = Date.now();
    const runId = randomUUID();
    const profile = this.parser.parse(request);
    const errors: RetrievalDiagnostics['retrieverErrors'] = [];
    const queryEmbedding = await this.queryEmbedding(profile, errors);
    let pass = await this.runPass(profile, queryEmbedding, 1);
    errors.push(...pass.errors);
    let selection = this.fallback.select(pass.reranked, profile);

    if (selection.needsExpandedRetrieval) {
      pass = await this.runPass(profile, queryEmbedding, this.config.expandedTopKMultiplier);
      errors.push(...pass.errors);
      const expanded = this.fallback.select(pass.reranked, profile);
      selection = {
        ...expanded,
        fallbackLevel: 4,
        needsExpandedRetrieval: false,
        reason: `expanded-retrieval:${expanded.reason}`,
      };
    }

    const diagnostics: RetrievalDiagnostics = {
      vectorCandidateCount: pass.counts.vector,
      fulltextCandidateCount: pass.counts.fulltext,
      titleCandidateCount: pass.counts.title,
      entityCandidateCount: pass.counts.entity,
      mergedCandidateCount: pass.fused.length,
      acceptedCount: selection.accepted.length,
      fallbackLevel: selection.fallbackLevel,
      suspiciousEntityPolicy: selection.suspiciousEntityPolicy,
      durationMs: Date.now() - startedAt,
      retrieverErrors: errors,
    };

    try {
      await this.audit.persist({ runId, request, profile, diagnostics, decisions: selection.decisions });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Hybrid retrieval audit failed without blocking report: ${message.slice(0, 300)}`);
    }

    return { runId, profile, sources: selection.accepted, diagnostics };
  }

  private async queryEmbedding(
    profile: QueryProfile,
    errors: RetrievalDiagnostics['retrieverErrors'],
  ): Promise<number[]> {
    try {
      const text = this.config.queryEmbeddingText
        ? this.config.queryEmbeddingText(profile)
        : [profile.originalQuery, profile.supplement, ...profile.queryVariants].filter(Boolean).join(' ');
      return await this.embedding.embedQuery(text);
    } catch (error) {
      errors.push({ source: 'embedding', message: this.errorMessage(error) });
      return [];
    }
  }

  private async runPass(
    profile: QueryProfile,
    queryEmbedding: number[],
    multiplier: number,
  ): Promise<RetrievalPass> {
    const jobs = [
      { source: 'vector' as const, promise: this.vectorRetriever.retrieve({ profile, queryEmbedding, limit: Math.ceil(this.config.vectorTopK * multiplier) }) },
      { source: 'fulltext' as const, promise: this.fulltextRetriever.retrieve({ profile, queryEmbedding, limit: Math.ceil(this.config.fulltextTopK * multiplier) }) },
      { source: 'title' as const, promise: this.titleRetriever.retrieve({ profile, queryEmbedding, limit: Math.ceil(this.config.titleTopK * multiplier) }) },
      { source: 'entity' as const, promise: this.entityRetriever.retrieve({ profile, queryEmbedding, limit: Math.ceil(this.config.entityTopK * multiplier) }) },
    ];
    const settled = await Promise.allSettled(jobs.map((job) => job.promise));
    const resultSets: RetrievalCandidate[][] = [];
    const counts: Record<RetrievalSource, number> = { vector: 0, fulltext: 0, title: 0, entity: 0 };
    const errors: RetrievalDiagnostics['retrieverErrors'] = [];
    settled.forEach((result, index) => {
      const job = jobs[index];
      if (!job) return;
      if (result.status === 'fulfilled') {
        resultSets.push(result.value);
        counts[job.source] = result.value.length;
      } else {
        resultSets.push([]);
        errors.push({ source: job.source, message: this.errorMessage(result.reason) });
      }
    });
    const fused = this.fusion.fuse(
      resultSets,
      this.config.rrfK,
      Math.ceil(this.config.fusionTopK * multiplier),
    );
    return { fused, reranked: this.reranker.rerank(fused, profile), counts, errors };
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 300);
  }
}
