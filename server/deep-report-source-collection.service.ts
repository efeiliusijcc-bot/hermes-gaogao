import { Inject, Injectable } from '@nestjs/common';
import { HermesService } from './hermes.service.js';
import type {
  DeepReportCollectedSource,
  DeepReportSourceCollectionInput,
  DeepReportSourceCollectionResponse,
  DeepReportSourceCollectionResult,
} from './deep-report-source-collection.types.js';

const NOT_AVAILABLE = {
  status: 'not_available',
  reason: 'This skill is only available after Deep Report is enabled.',
} as const;

type DeepReportSkillRunner = Pick<HermesService, 'runDeepReportSourceCollectionSkill'>;

@Injectable()
export class DeepReportSourceCollectionService {
  constructor(@Inject(HermesService) private readonly hermes: DeepReportSkillRunner) {}

  async execute(input: DeepReportSourceCollectionInput): Promise<DeepReportSourceCollectionResponse> {
    if (!this.isAvailable(input)) return NOT_AVAILABLE;

    const raw = await this.hermes.runDeepReportSourceCollectionSkill(input);
    if (raw?.status === 'not_available') return NOT_AVAILABLE;
    return this.normalizeResult(raw);
  }

  private isAvailable(input: DeepReportSourceCollectionInput): boolean {
    return input?.workflow === 'deep_report'
      && input?.deepReportEnabled === true
      && input?.stage === 'source_collection'
      && typeof input?.planningSessionId === 'string'
      && input.planningSessionId.trim().length > 0
      && typeof input?.topic === 'string'
      && input.topic.trim().length > 0;
  }

  private normalizeResult(raw: Record<string, unknown>): DeepReportSourceCollectionResult {
    if (raw?.status === 'failed') {
      throw new Error(this.cleanText(raw.summary, 500) || 'Deep Report source collection failed.');
    }
    if (
      !Array.isArray(raw?.acceptedSources)
      || !Array.isArray(raw?.uncertainSources)
      || !Array.isArray(raw?.coveredGaps)
      || !Array.isArray(raw?.uncoveredGaps)
      || typeof raw?.summary !== 'string'
    ) {
      throw new Error('Deep Report source collection returned invalid structured output.');
    }

    const acceptedSources = this.sourceArray(raw?.acceptedSources);
    const uncertainSources = this.sourceArray(raw?.uncertainSources);
    const coveredGaps = this.jsonArray(raw?.coveredGaps);
    const uncoveredGaps = this.jsonArray(raw?.uncoveredGaps);
    const summary = this.cleanText(raw?.summary, 2000);
    return {
      status: raw?.status === 'partial' || uncoveredGaps.length > 0 ? 'partial' : 'completed',
      acceptedSources,
      uncertainSources,
      coveredGaps,
      uncoveredGaps,
      summary,
    };
  }

  private sourceArray(value: unknown): DeepReportCollectedSource[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .slice(0, 100)
      .map((item) => this.sanitizeObject(item));
  }

  private jsonArray(value: unknown): unknown[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).map((item) => this.sanitizeValue(item, 0));
  }

  private sanitizeObject(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, item]) => [key, this.sanitizeValue(item, 0)]),
    );
  }

  private sanitizeValue(value: unknown, depth: number): unknown {
    if (typeof value === 'string') return this.cleanText(value, 30_000);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean' || value === null) return value;
    if (depth >= 3) return null;
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => this.sanitizeValue(item, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .slice(0, 40)
          .map(([key, item]) => [key, this.sanitizeValue(item, depth + 1)]),
      );
    }
    return null;
  }

  private cleanText(value: unknown, limit: number): string {
    return typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, limit) : '';
  }
}
