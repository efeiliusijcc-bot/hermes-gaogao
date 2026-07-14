export type EntityType =
  | 'country'
  | 'organization'
  | 'region'
  | 'person'
  | 'location'
  | 'event';

export type EntitySource = 'explicit' | 'topic' | 'supplement' | 'llm' | 'rule';
export type EntityEnforcement = 'hard' | 'soft' | 'disabled';

export interface TimeRange {
  start?: string;
  end?: string;
}

export interface ExplicitEntityInput {
  name: string;
  canonicalId?: string;
  type?: EntityType;
  aliases?: string[];
  required?: boolean;
}

export interface RawRetrievalRequest {
  reportJobId: string;
  topic: string;
  supplement?: unknown;
  explicitEntities?: unknown;
  explicitTimeRange?: unknown;
  knownContext?: unknown;
}

export interface CleanRetrievalInput {
  reportJobId: string;
  topic: string;
  supplement: string;
  explicitEntities: ExplicitEntityInput[];
  explicitTimeRange?: TimeRange;
}

export interface ParsedEntity {
  canonicalId: string;
  canonicalName: string;
  type: EntityType;
  aliases: string[];
  source: EntitySource;
  confidence: number;
  enforcement: EntityEnforcement;
}

export interface QueryProfile {
  originalQuery: string;
  supplement: string;
  coreEntities: ParsedEntity[];
  coreTopics: string[];
  eventType?: string;
  timeRange?: TimeRange;
  queryVariants: string[];
}

export type RetrievalSource = 'vector' | 'fulltext' | 'title' | 'entity';

export interface CandidateRanks {
  vector?: number;
  fulltext?: number;
  title?: number;
  entity?: number;
}

export interface CandidateScores {
  vector?: number;
  fulltext?: number;
  title?: number;
  entity?: number;
  rrf?: number;
  rerank?: number;
  final?: number;
  entityCoverage?: number;
  topicCoverage?: number;
  titleCoverage?: number;
  freshness?: number;
  sourceQuality?: number;
}

export interface RetrievalCandidate {
  documentId: string;
  title: string;
  summary?: string;
  content?: string;
  url?: string;
  publishedAt?: string;
  sourceName?: string;
  retrievalSources: RetrievalSource[];
  ranks: CandidateRanks;
  scores: CandidateScores;
}

export type CandidatePolicyMode = 'normal' | 'relax-derived' | 'explicit-only' | 'score-only';

export interface CandidateDecision {
  candidate: RetrievalCandidate;
  accepted: boolean;
  reason: string;
}

export interface PolicyEvaluation {
  mode: CandidatePolicyMode;
  accepted: RetrievalCandidate[];
  decisions: CandidateDecision[];
}

export interface FallbackSelection {
  accepted: RetrievalCandidate[];
  decisions: CandidateDecision[];
  fallbackLevel: 0 | 1 | 2 | 3 | 4;
  needsExpandedRetrieval: boolean;
  suspiciousEntityPolicy: boolean;
  reason: string;
}

export interface RetrievalDiagnostics {
  vectorCandidateCount: number;
  fulltextCandidateCount: number;
  titleCandidateCount: number;
  entityCandidateCount: number;
  mergedCandidateCount: number;
  acceptedCount: number;
  fallbackLevel: number;
  suspiciousEntityPolicy: boolean;
  durationMs: number;
  retrieverErrors: Array<{
    source: RetrievalSource | 'embedding';
    message: string;
  }>;
}

export interface RetrievalResult {
  runId: string;
  profile: QueryProfile;
  sources: RetrievalCandidate[];
  diagnostics: RetrievalDiagnostics;
}
