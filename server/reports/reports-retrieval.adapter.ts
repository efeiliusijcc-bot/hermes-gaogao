import { Injectable } from '@nestjs/common';
import type { VectorSourceItem } from '../vector-source.service.js';
import { buildCleanRetrievalInput } from './retrieval/query/clean-query-input.js';
import { RetrievalOrchestratorService } from './retrieval/retrieval-orchestrator.service.js';
import type { RetrievalResult } from './retrieval/retrieval.types.js';

interface ExistingReportPayload {
  topic?: unknown;
  known_context?: unknown;
}

interface ExistingPayloadContext {
  supplement?: unknown;
  entities?: unknown;
  explicitEntities?: unknown;
  timeRange?: unknown;
  explicitTimeRange?: unknown;
}

export interface ReportsRetrievalAdapterResult {
  result: RetrievalResult;
  sources: VectorSourceItem[];
}

@Injectable()
export class ReportsRetrievalAdapter {
  constructor(private readonly retrieval: RetrievalOrchestratorService) {}

  async retrieveDatabaseSources(input: {
    reportJobId: string;
    payload: ExistingReportPayload;
    payloadContext: ExistingPayloadContext;
  }): Promise<ReportsRetrievalAdapterResult> {
    const cleanInput = buildCleanRetrievalInput({
      reportJobId: input.reportJobId,
      topic: String(input.payload.topic || ''),
      supplement: input.payloadContext.supplement,
      explicitEntities: input.payloadContext.explicitEntities,
      explicitTimeRange: input.payloadContext.explicitTimeRange,
      knownContext: input.payload.known_context,
    });
    const result = await this.retrieval.retrieve(cleanInput);
    return {
      result,
      sources: result.sources.map((source) => ({
        title: source.title,
        url: source.url || '',
        summary: source.summary || '',
        contentExcerpt: source.content || '',
        websiteName: source.sourceName || '',
        publishTime: source.publishedAt || '',
        similarity: source.scores.vector || 0,
        relevanceScore: source.scores.final || 0,
        retrievalMode: 'hybrid',
        documentId: source.documentId,
        retrievalSources: source.retrievalSources,
        retrievalRanks: source.ranks,
        retrievalScores: source.scores,
        retrievalRunId: result.runId,
      })),
    };
  }
}
