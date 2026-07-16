import type {
  DailyAwarenessDataStatus,
  DailyAwarenessGeneratedByType,
  DailyAwarenessGenerationStatus,
  DailyAwarenessMessageCode,
  DailyAwarenessQualityStatus,
} from './daily-awareness.constants.js';
import type { DailyAwarenessCandidate, DailyAwarenessMaterial } from './daily-awareness.types.js';

export interface DailyDataFinishedEvent {
  eventId: string;
  eventType: 'DAILY_DATA_FINISHED';
  businessDate: string;
  batchId: string;
  completedAt: string;
  totalCount?: number;
}

export interface DailyDataFinishedAcceptedResponse {
  accepted: true;
  duplicate: boolean;
  eventId: string;
}

export interface DailyAwarenessConfig {
  lookbackHours: number;
  maxArticles: number;
  categoryScope: string[];
  maxRetryCount: number;
  retryIntervalSeconds: number;
  summaryMaxChars: number;
  version: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface DailyAwarenessPreparedMaterials {
  materials: DailyAwarenessMaterial[];
  candidates: DailyAwarenessCandidate[];
  sourceCount: number;
  summaryCount: number;
  titleOnlyCount: number;
  skippedCount: number;
  qualityStatus: DailyAwarenessQualityStatus | null;
  diagnostics: Record<string, unknown>;
}

export interface DailyAwarenessDisplayedBrief {
  briefId: string;
  businessDate: string;
  title: string;
  contentMarkdown: string;
  qualityStatus: DailyAwarenessQualityStatus;
  generatedAt: string;
  generatedByType: DailyAwarenessGeneratedByType;
  categories: unknown[];
  categoryDistribution: Record<string, unknown>;
  events: unknown[];
}

export interface DailyAwarenessCurrentResponse {
  businessDate: string;
  dataStatus: DailyAwarenessDataStatus;
  generationStatus: DailyAwarenessGenerationStatus;
  qualityStatus: DailyAwarenessQualityStatus | null;
  messageCode: DailyAwarenessMessageCode;
  displayedBrief: DailyAwarenessDisplayedBrief | null;
}
