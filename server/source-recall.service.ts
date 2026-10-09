import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RetrievalOrchestratorService } from './reports/retrieval/retrieval-orchestrator.service.js';
import type { EntityType, RetrievalDiagnostics } from './reports/retrieval/retrieval.types.js';
import { SourceRecallAccessService } from './source-recall-access.service.js';
import type {
  SourceRecallRequest,
  SourceRecallResponse,
  SourceRecallStatus,
  ValidatedSourceRecallRequest,
} from './source-recall.types.js';

const ENTITY_TYPES = new Set<EntityType>(['country', 'organization', 'region', 'person', 'location', 'event']);

@Injectable()
export class SourceRecallService {
  private readonly logger = new Logger(SourceRecallService.name);

  constructor(
    @Inject(RetrievalOrchestratorService) private readonly orchestrator: RetrievalOrchestratorService,
    @Inject(SourceRecallAccessService) private readonly access: SourceRecallAccessService,
  ) {}

  async recall(body: SourceRecallRequest, clientId: string, ip: string): Promise<SourceRecallResponse> {
    const input = this.validate(body);
    const traceId = `external:${this.safeClientId(clientId)}:${randomUUID()}`;
    const startedAt = Date.now();
    let response: SourceRecallResponse;
    try {
      response = await this.access.withConcurrency(async () => {
        try {
          const result = await this.orchestrator.retrieve({
            reportJobId: traceId,
            topic: input.topic,
            supplement: input.supplement,
            explicitEntities: input.explicitEntities,
            explicitTimeRange: input.timeRange,
          }, { finalLimit: input.limit, auditMode: 'metadata-only' });
          const status = this.status(result.sources.length, result.diagnostics);
          return {
            status,
            requestId: result.runId,
            retrievalMode: 'hybrid',
            sources: result.sources.slice(0, input.limit).map((source) => ({
              documentId: source.documentId,
              title: source.title,
              url: source.url,
              summary: source.summary,
              excerpt: source.content,
              sourceName: source.sourceName,
              publishedAt: source.publishedAt,
              retrievalSources: source.retrievalSources,
              ranks: source.ranks,
              scores: source.scores,
            })),
            totalHits: result.diagnostics.mergedCandidateCount,
            diagnostics: {
              ...result.diagnostics,
              retrieverErrors: result.diagnostics.retrieverErrors.map((error) => ({
                source: error.source,
                message: `${error.source} retrieval unavailable`,
              })),
            },
            updatedAt: new Date().toISOString(),
          };
        } catch {
          return this.unavailableResponse(traceId, Date.now() - startedAt);
        }
      });
    } catch (error) {
      this.logAudit(clientId, ip, input.topic.length, Date.now() - startedAt, 0, 'unavailable');
      throw error;
    }
    this.logAudit(clientId, ip, input.topic.length, Date.now() - startedAt, response.sources.length, response.status);
    return response;
  }

  validate(body: SourceRecallRequest): ValidatedSourceRecallRequest {
    if (!body || typeof body !== 'object' || Array.isArray(body)) this.invalid('Request body must be an object');
    const topic = this.requiredString(body.topic, 'topic', 500);
    const supplement = this.optionalString(body.supplement, 'supplement', 5000);
    const explicitEntities = this.entities(body.explicitEntities);
    const hasLookback = body.lookbackDays !== undefined && body.lookbackDays !== null;
    const hasTimeRange = body.timeRange !== undefined && body.timeRange !== null;
    if (hasLookback && hasTimeRange) this.invalid('lookbackDays and timeRange cannot be used together');
    const timeRange = hasTimeRange ? this.timeRange(body.timeRange) : this.lookback(body.lookbackDays);
    const limit = body.limit === undefined ? 20 : this.integer(body.limit, 'limit', 1, 50);
    return { topic, supplement, explicitEntities, timeRange, limit };
  }

  private entities(value: unknown): ValidatedSourceRecallRequest['explicitEntities'] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) this.invalid('explicitEntities must be an array');
    if (value.length > 20) this.invalid('explicitEntities cannot contain more than 20 items');
    return value.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) this.invalid(`explicitEntities[${index}] must be an object`);
      const entity = raw as Record<string, unknown>;
      const name = this.requiredString(entity.name, `explicitEntities[${index}].name`, 200);
      let aliases: string[] = [];
      if (entity.aliases !== undefined) {
        if (!Array.isArray(entity.aliases) || entity.aliases.length > 20) this.invalid(`explicitEntities[${index}].aliases must contain at most 20 items`);
        aliases = entity.aliases.map((alias, aliasIndex) => this.requiredString(alias, `explicitEntities[${index}].aliases[${aliasIndex}]`, 200));
      }
      let type: EntityType | undefined;
      if (entity.type !== undefined) {
        if (typeof entity.type !== 'string' || !ENTITY_TYPES.has(entity.type as EntityType)) this.invalid(`explicitEntities[${index}].type is invalid`);
        type = entity.type as EntityType;
      }
      if (entity.required !== undefined && typeof entity.required !== 'boolean') this.invalid(`explicitEntities[${index}].required must be a boolean`);
      return { name, aliases, type, required: entity.required === true };
    });
  }

  private lookback(value: unknown): { start: string; end: string } {
    const days = value === undefined || value === null ? 365 : this.integer(value, 'lookbackDays', 1, 36_500);
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  private timeRange(value: unknown): { start?: string; end?: string } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) this.invalid('timeRange must be an object');
    const raw = value as Record<string, unknown>;
    const start = raw.start === undefined ? undefined : this.isoDate(raw.start, 'timeRange.start');
    const end = raw.end === undefined ? undefined : this.isoDate(raw.end, 'timeRange.end');
    if (!start && !end) this.invalid('timeRange must include start or end');
    if (start && end && Date.parse(start) > Date.parse(end)) this.invalid('timeRange.start cannot be later than timeRange.end');
    return { start, end };
  }

  private isoDate(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) {
      this.invalid(`${field} must be an ISO date`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const normalized = new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10);
      if (normalized !== value) this.invalid(`${field} must be a valid ISO date`);
    }
    return value;
  }

  private requiredString(value: unknown, field: string, maximum: number): string {
    if (typeof value !== 'string') this.invalid(`${field} must be a string`);
    const result = value.trim();
    if (!result) this.invalid(`${field} is required`);
    if (result.length > maximum) this.invalid(`${field} cannot exceed ${maximum} characters`);
    return result;
  }

  private optionalString(value: unknown, field: string, maximum: number): string {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') this.invalid(`${field} must be a string`);
    if (value.length > maximum) this.invalid(`${field} cannot exceed ${maximum} characters`);
    return value.trim();
  }

  private integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
      this.invalid(`${field} must be an integer from ${minimum} to ${maximum}`);
    }
    return value;
  }

  private status(sourceCount: number, diagnostics: RetrievalDiagnostics): SourceRecallStatus {
    const failed = new Set(diagnostics.retrieverErrors.map((error) => error.source));
    if (failed.has('embedding')) failed.add('vector');
    if (!sourceCount && failed.has('vector') && failed.has('fulltext') && failed.has('title') && failed.has('entity')) return 'unavailable';
    if (failed.size > 0) return 'fallback';
    return sourceCount > 0 ? 'hit' : 'empty';
  }

  private unavailableResponse(requestId: string, durationMs: number): SourceRecallResponse {
    return {
      status: 'unavailable',
      requestId,
      retrievalMode: 'hybrid',
      sources: [],
      totalHits: 0,
      diagnostics: {
        vectorCandidateCount: 0,
        fulltextCandidateCount: 0,
        titleCandidateCount: 0,
        entityCandidateCount: 0,
        mergedCandidateCount: 0,
        acceptedCount: 0,
        fallbackLevel: 0,
        suspiciousEntityPolicy: false,
        durationMs,
        retrieverErrors: [{ source: 'embedding', message: 'hybrid retrieval unavailable' }],
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private logAudit(clientId: string, ip: string, queryLength: number, durationMs: number, hits: number, status: SourceRecallStatus): void {
    this.logger.log(JSON.stringify({ event: 'external_source_recall', clientId: this.safeClientId(clientId), ip: String(ip || '').slice(0, 100), queryLength, durationMs, hits, status }));
  }

  private safeClientId(value: string): string {
    return String(value || 'other-project').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'other-project';
  }

  private invalid(message: string): never {
    throw new BadRequestException({ error: message, code: 'SOURCE_RECALL_INVALID_REQUEST' });
  }
}
