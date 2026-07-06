export type CrawlerTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type CrawlerMode = 'auto' | 'manual' | 'hybrid';

export interface CrawlerDirection {
  name: string;
  enabled: boolean;
  description: string;
  queries: string[];
  targetDomains: string[];
}

export interface CrawlerPlan {
  enabled: boolean;
  mode: CrawlerMode;
  goal: string;
  autoGapFilling: boolean;
  directions: CrawlerDirection[];
  manualUrls: string[];
  manualDomains: string[];
  manualKeywords: string[];
  maxPages: number;
  maxDepth: number;
  lookbackHours: number | null;
  language: string;
  executePhase: 'planning' | 'research';
  alreadyExecuted?: boolean;
  allowFurtherCollectionInResearch?: boolean;
  planningSessionId?: string;
  sourcePhase?: 'planning' | 'research';
  reportTitle?: string;
}

export interface CreateCrawlerTaskInput {
  jobId?: unknown;
  ownerId?: unknown;
  ownerUsername?: unknown;
  planningSessionId?: unknown;
  sourcePhase?: unknown;
  reportTitle?: unknown;
  title?: unknown;
  goal?: unknown;
  crawlerPlan?: unknown;
  maxPages?: unknown;
  maxDepth?: unknown;
}

export interface CrawlerTaskResponse {
  taskId: string;
  ownerId: string | null;
  ownerUsername: string;
  jobId: string;
  title: string;
  goal: string;
  status: string;
  crawlerPlan: CrawlerPlan;
  maxPages: number;
  maxDepth: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CrawlerItemResponse {
  itemId: string;
  taskId: string;
  ownerId: string | null;
  jobId: string;
  url: string;
  title: string;
  publisher: string;
  publishedAt: string | null;
  fetchedAt: string;
  contentText: string;
  contentSummary: string;
  metadata: Record<string, unknown>;
  relevanceScore: number | null;
  credibilityScore: number | null;
  sourceType: 'crawler';
  createdAt: string;
}
