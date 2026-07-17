import type {
  DailyAwarenessDataStatus,
  DailyAwarenessGeneratedByType,
  DailyAwarenessGenerationStatus,
  DailyAwarenessMessageCode,
  DailyAwarenessQualityStatus,
  DailyAwarenessInboxStatus,
} from './daily-awareness.constants.js';
import type {
  DailyAwarenessCandidate,
  DailyAwarenessMaterial,
  DailyAwarenessScoredEvent,
} from './daily-awareness.types.js';

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

export interface DailyAwarenessInboxRecord {
  eventId: string;
  eventType: 'DAILY_DATA_FINISHED';
  businessDate: string;
  batchId: string;
  completedAt: string;
  totalCount?: number;
  payload: Record<string, unknown>;
  status: DailyAwarenessInboxStatus;
  attemptCount: number;
}

export interface DailyAwarenessTerminalResult {
  terminal: true;
  generationStatus: DailyAwarenessGenerationStatus;
}

export type DailyAwarenessInboxProcessor = (
  item: DailyAwarenessInboxRecord,
) => Promise<DailyAwarenessTerminalResult>;

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

export interface DailyAwarenessComposedBrief {
  title: string;
  summary: string;
  reportMarkdown: string;
  contentJson: Record<string, unknown>;
  categoryStats: Array<{ category: string; count: number }>;
  events: DailyAwarenessScoredEvent[];
}

export interface DailyAwarenessDisplayedBrief {
  briefId: string;
  businessDate: string;
  title: string;
  contentMarkdown: string;
  qualityStatus: DailyAwarenessQualityStatus;
  generatedAt: string;
  generatedByType: DailyAwarenessGeneratedByType;
  sourceBusinessDate: string;
  sourceTable: string;
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
