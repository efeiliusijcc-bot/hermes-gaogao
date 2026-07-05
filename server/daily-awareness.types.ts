export interface DailyAwarenessMaterial {
  id: string;
  title: string;
  content: string;
  url: string;
  publisher: string;
  publishedAt: string;
  fetchedAt?: string;
  metadata: Record<string, unknown>;
}

export interface DailyAwarenessSourceInfo {
  title: string;
  publisher: string;
  publishedAt: string;
  url: string;
}

export interface DailyAwarenessCandidate {
  candidateId: string;
  title: string;
  summaryText: string;
  sources: DailyAwarenessSourceInfo[];
  relatedMaterialIds: string[];
  sourceCount: number;
}

export interface DailyAwarenessScoredEvent {
  candidateId: string;
  eventTitle: string;
  category: string;
  region: string;
  basicSituation: string;
  backgroundContext: string;
  importanceJudgement: string;
  riskToUs: string;
  importanceScore: number;
  riskScore: number;
  sourceInfo: DailyAwarenessSourceInfo[];
  relatedMaterialIds: string[];
}

export interface DailyAwarenessGenerateInput {
  date?: string;
  maxItems?: number;
  maxEvents?: number;
  categories?: string[];
  region?: string;
  keyword?: string;
  lookbackHours?: number;
}

export interface DailyAwarenessMaterialDiagnostics {
  targetDate: string;
  lookbackHours: number;
  sourceTable: string;
  queryStart: string;
  queryEnd: string;
  fallbackStart: string;
  fallbackEnd: string;
  exactMaterialCount: number;
  fallbackMaterialCount: number;
  returnedMaterialCount: number;
  usedFallback: boolean;
  fallbackReason: string;
}

export interface DailyAwarenessBriefRow {
  brief_id: string;
  owner_id: string;
  brief_date: string;
  title: string | null;
  summary: string | null;
  status: string;
  total_candidates: number;
  selected_count: number;
  categories: unknown;
  content_json: unknown;
  created_at: string;
  updated_at: string;
  owner_username?: string | null;
}

export interface DailyAwarenessEventRow {
  item_id: string;
  brief_id: string;
  owner_id: string;
  rank_no: number;
  event_title: string;
  category: string | null;
  region: string | null;
  basic_situation: string | null;
  background_context: string | null;
  importance_judgement: string | null;
  risk_to_us: string | null;
  source_info: unknown;
  related_material_ids: unknown;
  importance_score: string | number | null;
  risk_score: string | number | null;
  created_at: string;
}
