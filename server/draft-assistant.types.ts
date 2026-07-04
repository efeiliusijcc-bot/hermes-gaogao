import type { UserRole } from './auth-user.interface.js';

export interface DraftAnalyzeInput {
  title?: string;
  materials?: string;
  links?: string[];
  category?: string;
  region?: string;
  maxRows?: number;
  lookbackDays?: number;
}

export interface DraftOutlineInput {
  eventId?: string;
  outlinePreference?: string;
}

export interface DraftOutlineRefineInput {
  outlineId?: string;
  userFeedback?: string;
}

export interface DraftOutlineManualInput {
  outlineId?: string;
  outline?: DraftOutlineJson;
  editNote?: string;
}

export interface DraftOutlineImportInput {
  outlineId?: string;
}

export interface DraftSourceResponse {
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string | null;
  publisher: string;
  author: string;
  publishedAt: string | null;
  contentText: string;
  sourceSummary: string;
  relevanceReason: string;
  supportedFacts: unknown[];
  supportedAttitudes: unknown[];
  credibilityScore: number;
  createdAt: string;
}

export interface DraftAttitude {
  actor: string;
  actorType: string | null;
  statementTime: string | null;
  media: string | null;
  sourceUrl: string | null;
  attitudeSummary: string;
  polarity: string;
  confidence: number;
}

export interface DraftAnalysisJson {
  oneSentenceSummary: string;
  basicSituation: string;
  background: string;
  timeline: unknown[];
  keyActors: unknown[];
  mainFacts: unknown[];
  attitudes: DraftAttitude[];
  riskToUs: unknown[];
  importanceJudgement: string;
  uncertainties: unknown[];
  suggestedAngles: unknown[];
}

export interface DraftOutlineItem {
  level: 1 | 2;
  title: string;
  summary: string;
  children?: DraftOutlineItem[];
}

export interface DraftOutlineJson {
  reportTitle: string;
  reportTheme: string;
  coreArgument: string;
  outlineItems: DraftOutlineItem[];
  writingFocus: unknown[];
  sourceRequirements: unknown[];
  uncertaintiesToVerify: unknown[];
  coreJudgement?: string;
  mainContentPlan?: unknown[];
  attitudesPlan?: unknown[];
  riskPlan?: unknown[];
  trendPlan?: unknown[];
  writingConstraints?: unknown[];
}

export interface DraftEventSummary {
  eventId: string;
  title: string;
  summary: string;
  category: string;
  region: string;
  importanceScore: number;
  riskScore: number;
  createdAt: string;
  ownerUsername?: string;
}

export interface DraftReportPlanSection {
  sectionId: string;
  sectionTitle: string;
  sectionGoal: string;
  outlineTitle?: string;
  outlineSummary?: string;
  requiredFacts?: unknown[];
  requiredSources?: unknown[];
  attitudeSources?: unknown[];
  riskPoints?: unknown[];
  writingInstructions?: unknown[];
}

export interface DraftReportPlanJson {
  reportTitle: string;
  reportTheme: string;
  coreArgument: string;
  outlineVersion: {
    outlineId: string;
    versionNo: number;
    editType: string;
  };
  eventBrief: {
    eventId: string;
    title: string;
    summary: string;
    category: string;
    region: string;
  };
  sections: DraftReportPlanSection[];
  writingFocus: unknown[];
  sourceRequirements: unknown[];
  uncertaintiesToVerify: unknown[];
  globalWritingConstraints: string[];
}

export interface DraftCurrentUser {
  id: string;
  username: string;
  role: UserRole;
}
