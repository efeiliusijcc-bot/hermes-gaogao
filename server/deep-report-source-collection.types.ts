import type { ServerEvent } from './types.js';

export type DeepReportSourceCollectionStage = 'source_collection';

export interface DeepReportSourceCollectionInput {
  workflow: 'deep_report';
  deepReportEnabled: true;
  stage: DeepReportSourceCollectionStage;
  planningSessionId: string;
  topic: string;
  plan?: Record<string, unknown>;
  requestUser?: string;
  onEvent?: (event: ServerEvent) => void;
}

export interface DeepReportCollectedSource {
  title?: string;
  url?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface DeepReportSourceCollectionResult {
  status: 'completed' | 'partial';
  acceptedSources: DeepReportCollectedSource[];
  uncertainSources: DeepReportCollectedSource[];
  coveredGaps: unknown[];
  uncoveredGaps: unknown[];
  summary: string;
}

export interface DeepReportSourceCollectionUnavailable {
  status: 'not_available';
  reason: 'This skill is only available after Deep Report is enabled.';
}

export type DeepReportSourceCollectionResponse =
  | DeepReportSourceCollectionResult
  | DeepReportSourceCollectionUnavailable;
