import { BadRequestException, ForbiddenException, Inject, Injectable, InternalServerErrorException, NotFoundException, OnModuleDestroy, Optional } from '@nestjs/common';
import { marked } from 'marked';
import OpenAI from 'openai';
import { Subject } from 'rxjs';
import { v4 as uuid } from 'uuid';
import { HERMES_RUN_MODE, REPORT_AGENT_API_KEY, REPORT_AGENT_BASE_URL, REPORT_AGENT_MODEL, REPORT_AGENT_PROVIDER } from './config.js';
import { CrawlerService } from './crawler.service.js';
import { ArtifactPathResolver } from './artifact-path-resolver.service.js';
import { ArtifactSyncService, type ArtifactSyncResult } from './artifact-storage/artifact-sync.service.js';
import type { CrawlerItemResponse, CrawlerTaskResponse } from './crawler.types.js';
import { HermesApprovalRequiredError, HermesService } from './hermes.service.js';
import { RemoteFileService } from './remote-file.service.js';
import { VectorSourceService, type VectorSearchResult, type VectorSourceItem } from './vector-source.service.js';
import { createAuthPool, type PgPool } from './auth-database.js';
import { UserPreferencesService } from './user-preferences.service.js';
import { buildRuleBasedEntityPolicy, parseEntityPolicy, type EntityPolicy, type ExtractEntityPolicyInput } from './entity-policy.js';
import { filterSourcesByEntityPolicy, type SourceEntityMatch, type SourceFilterDiagnostics, type SourceFilterResult } from './source-entity-guard.js';
import {
  WebSupplementService,
  assessSourceQuality,
  buildSupplementQueries,
  decideWebSupplementTrigger,
  dedupeSupplementSources,
  sourcePriority,
  WEB_SUPPLEMENT_LIMITS,
  type WebSearchSource,
} from './web-supplement.service.js';
import type { CreateJobRequest } from '../src/types/report.js';
import type { AuthUser } from './auth-user.interface.js';
import type {
  EventLogEntry,
  JobRecord,
  ReportProgressEvidence,
  ReportProgressStage,
  ReportProgressStageKey,
  ReportProgressStageStatus,
  ReportProgressState,
  RunInput,
  ServerEvent,
} from './types.js';

type JobListTypeFilter = 'all' | 'write-hb-k' | 'write-hb-hb' | 'person-intelligence-report' | 'risk-assessment-reports';
type ReportEditTargetType = 'paragraph' | 'section' | 'selected_text' | 'full_section';
type ReportEditMode = 'rewrite' | 'expand' | 'shorten' | 'polish' | 'add_sources' | 'strengthen_risk' | 'clarify_facts' | 'custom';

interface ReportEditInput {
  targetType?: unknown;
  targetPath?: unknown;
  originalText?: unknown;
  instruction?: unknown;
  editMode?: unknown;
}

interface ReportEditResponse {
  editId: string;
  jobId: string;
  ownerId: string;
  targetType: string;
  targetPath: string | null;
  originalText: string;
  instruction: string;
  editedText: string;
  editMode: string;
  modelUsed: string | null;
  status: string;
  createdAt: string;
}

interface ReportQualityReviewResponse {
  reviewId: string;
  jobId: string;
  ownerId: string | null;
  status: string;
  overallScore: number | null;
  wordCount: number | null;
  scores: {
    factualClarity: number | null;
    planAlignment: number | null;
    sourceQuality: number | null;
    attitudeTraceability: number | null;
    riskReasoning: number | null;
    writingQuality: number | null;
  };
  summary: string;
  checks: unknown[];
  issues: unknown[];
  recommendedEdits: unknown[];
  sourceUsage: Record<string, unknown>;
  reviewJson: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
}

interface JobListOptions {
  page?: string | number;
  pageSize?: string | number;
  type?: string;
  q?: string;
  mine?: string | boolean;
  trash?: string | boolean;
}

interface DatabaseSourceItem {
  title: string;
  url: string;
  summary: string;
  websiteName: string;
  publishTime: string;
  contentExcerpt?: string;
  similarity?: number;
  relevanceScore?: number;
  sourceType?: string;
  entityMatch?: SourceEntityMatch;
}

interface DatabaseQueryPlanSummary {
  tablesDiscovered: number;
  tablesChecked: number;
  strictHits: number;
  expandedHits: number;
  returnedSources: number;
  broadeningApplied: boolean;
  contentRowsRead: number;
}

interface VectorQueryPlanSummary {
  enabled: boolean;
  available: boolean;
  storageMode: string;
  embeddingModel: string;
  activeTable: string;
  indexedRows: number;
  vectorHits: number;
  keywordBoostedHits: number;
  returnedSources: number;
  broadeningApplied: boolean;
  lastIndexedAt: string | null;
  fallbackReason: string;
}

interface DatabaseSourcesResponse {
  status: 'hit' | 'empty' | 'fallback' | 'unavailable' | 'error';
  sources: DatabaseSourceItem[];
  acceptedSources?: DatabaseSourceItem[];
  uncertainSources?: DatabaseSourceItem[];
  rejectedSources?: DatabaseSourceItem[];
  diagnostics?: SourceFilterDiagnostics & { entityPolicy?: EntityPolicy };
  message?: string;
  fallbackReason: string;
  totalHits: number;
  updatedAt: string | null;
  queryPlan: DatabaseQueryPlanSummary;
  retrievalMode?: 'keyword' | 'vector' | 'hybrid';
  vectorPlan?: VectorQueryPlanSummary;
}

interface SupplementChannelResult {
  acceptedWebSources: Record<string, unknown>[];
  uncertainWebSources: Record<string, unknown>[];
  rejectedWebSources: Record<string, unknown>[];
  acceptedCrawlerSources: Record<string, unknown>[];
  uncertainCrawlerSources: Record<string, unknown>[];
  rejectedCrawlerSources: Record<string, unknown>[];
  diagnostics: {
    triggered: boolean;
    triggerReason: string;
    queries: string[];
    searchResultCount: number;
    searchValidatedCount: number;
    fetchedCount: number;
    acceptedCount: number;
    uncertainCount: number;
    rejectedCount: number;
    minimumAcceptedDatabaseSources: number;
    queryDiagnostics?: Array<Record<string, unknown>>;
    retrievalMetrics?: Record<string, unknown>;
    deduplication?: Record<string, unknown>;
  };
}

type ReportSourceListType = 'all' | 'database_recall' | 'crawler' | 'tool_search' | 'report_refs' | 'structured_sources' | 'candidate_hits' | 'extract_failed';
type ReportSourceOrigin = 'database_recall' | 'crawler' | 'tool_search';
type ReportEvidenceKind = 'report_reference' | 'structured_source' | 'research_source' | 'evidence_card' | 'crawler_source';
type ReportSourceEngine = 'exa' | 'firecrawl' | 'tavily' | 'tavily_extract' | 'pg_vector' | 'database' | 'crawler';

const PROGRESS_STAGE_DEFS: Array<Omit<ReportProgressStage, 'status' | 'evidence'>> = [
  { key: 'plan', title: '任务规划', desc: '整理编报要求、确定信源范围并拆解调研任务' },
  { key: 'database', title: '数据库检索', desc: '优先召回 PG 向量库和数据库信源' },
  { key: 'research', title: '资料采集', desc: '按规划补充公开信源并提取关键事实' },
  { key: 'consolidate', title: '素材整合', desc: '汇总信源、证据和分析要点' },
  { key: 'report', title: '报告撰写', desc: '撰写报告正文并完成校验' },
  { key: 'quality', title: '成稿自检', desc: '检查主题一致性、信源依据、风险推理和写作质量' },
];

interface ReportSourcesOptions {
  type?: string;
  page?: string | number;
  pageSize?: string | number;
}

interface ReportSourceListItem {
  id: string;
  sourceGroup: Exclude<ReportSourceListType, 'all'>;
  sourceOrigin?: ReportSourceOrigin;
  evidenceKind?: ReportEvidenceKind;
  engine?: ReportSourceEngine;
  citationNo?: number;
  title: string;
  url?: string;
  sourceName?: string;
  publishTime?: string;
  summary?: string;
  excerpt?: string;
  sourceType?: string;
  relevanceScore?: number;
  sourcePriority?: number;
  status?: string;
  method?: string;
  failedReason?: string;
  rawReferenceText?: string;
  matchStatus?: 'matched' | 'raw_only' | 'failed';
  candidateStage?: string;
  hitType?: string;
}

interface ReportSourcesResponse {
  items: ReportSourceListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  meta?: Record<string, unknown>;
}

interface ReportSourceSummary {
  databaseRecallCount: number;
  crawlerCount: number;
  toolSearchCount: number;
  reportReferenceCount: number;
  structuredSourceCount: number;
}

interface DraftAssistantPlanBundle {
  planId: string;
  outlineId: string;
  eventId: string;
  ownerId: string;
  reportPlan: Record<string, unknown>;
  event: Record<string, unknown>;
  sources: Record<string, unknown>[];
  attitudes: Record<string, unknown>[];
}

@Injectable()
export class ReportsService implements OnModuleDestroy {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly streams = new Map<string, Subject<ServerEvent>>();
  private readonly jobsReady: Promise<void>;
  private dailySequence = new Map<string, number>();
  private pool: PgPool | null = null;

  constructor(
    @Inject(HermesService) private readonly hermes: HermesService,
    @Inject(RemoteFileService) private readonly remoteFs: RemoteFileService,
    @Inject(VectorSourceService) private readonly vectorSources: VectorSourceService,
    @Optional() @Inject(UserPreferencesService) private readonly userPreferences?: UserPreferencesService,
    @Optional() @Inject(CrawlerService) private readonly crawler?: CrawlerService,
    @Optional() @Inject(WebSupplementService) private readonly webSupplement?: WebSupplementService,
    @Optional() @Inject(ArtifactPathResolver) private readonly artifactResolver?: ArtifactPathResolver,
    @Optional() @Inject(ArtifactSyncService) private readonly artifactSync?: ArtifactSyncService,
  ) {
    this.jobsReady = this.loadPersistedJobs();
  }

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async createJob(req: CreateJobRequest, user: AuthUser): Promise<{ jobId: string; status: string }> {
    if (!this.canCreateReport(user)) {
      throw new ForbiddenException({ error: 'Viewer cannot create report jobs' });
    }
    const payload = await this.enhancePayloadWithUserPreferences(req.payload as unknown as Record<string, unknown>, user);
    const planId = this.optionalId(payload.planId);
    const planBundle = planId ? await this.loadDraftAssistantPlanBundle(planId, user) : null;
    const eventId = this.optionalId(payload.eventId) || planBundle?.eventId;
    const outlineId = this.optionalId(payload.outlineId) || planBundle?.outlineId;
    if (planBundle) {
      if (eventId && eventId !== planBundle.eventId) throw new BadRequestException({ error: 'eventId does not match planId' });
      if (outlineId && outlineId !== planBundle.outlineId) throw new BadRequestException({ error: 'outlineId does not match planId' });
    }
    const jobId = uuid();
    const now = new Date().toISOString();
    const job: JobRecord = {
      jobId,
      skill: req.skill,
      payload: payload as unknown as CreateJobRequest['payload'],
      eventId,
      outlineId,
      planId,
      ownerUserId: user.id,
      ownerUsername: user.username,
      ownerRole: user.role,
      ownerRoles: this.stringArray(user.roles),
      ownerModules: this.stringArray(user.modules),
      ownerPermissions: this.stringArray(user.permissions, 200),
      status: 'queued',
      artifacts: {},
      createdAt: now,
      updatedAt: now,
      events: [],
      eventLog: [],
    };
    job.progressState = this.buildInitialProgressState(job);

    this.jobs.set(jobId, job);
    this.streams.set(jobId, new Subject<ServerEvent>());
    void this.writeJobState(job);
    setImmediate(() => {
      void this.runJob(job).catch((error) => {
        console.error('runJob unhandled failure:', error instanceof Error ? error.message : error);
      });
    });

    return { jobId, status: job.status };
  }

  async waitUntilReady(): Promise<void> {
    await this.jobsReady;
  }

  async listJobs(options: JobListOptions = {}, user: AuthUser) {
    await this.jobsReady;
    const page = this.parsePositiveInt(options.page, 1);
    const pageSize = Math.min(this.parsePositiveInt(options.pageSize, 20), 100);
    const type = this.normalizeTypeFilter(options.type);
    const query = String(options.q ?? '').trim().toLowerCase();
    const mineOnly = options.mine === true || String(options.mine || '').toLowerCase() === 'true';
    const trashOnly = options.trash === true || String(options.trash || '').toLowerCase() === 'true';

    const filtered = Array.from(this.jobs.values())
      .filter((job) => this.isDeletedJob(job) === trashOnly)
      .filter((job) => this.canListJob(job, user, mineOnly))
      .filter((job) => type === 'all' || this.jobTypeKey(job) === type)
      .filter((job) => !query || this.jobSearchText(job).includes(query))
      .sort((a, b) => {
        const createdDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (createdDiff) return createdDiff;
        return b.jobId.localeCompare(a.jobId);
      });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize).map((job) => this.serializeJob(job));

    return {
      items,
      total,
      page: safePage,
      pageSize,
      totalPages,
      statusCounts: {
        succeeded: filtered.filter((job) => job.status === 'succeeded').length,
        running: filtered.filter((job) => job.status === 'running' || job.status === 'queued').length,
      },
    };
  }

  getJob(jobId: string, user?: AuthUser): JobRecord | undefined {
    const job = this.jobs.get(jobId);
    if (job && user) this.assertCanAccessJobRecord(job, user);
    return job;
  }

  async cancelJob(jobId: string, user: AuthUser): Promise<JobRecord | undefined> {
    await this.jobsReady;
    const job = this.assertCanAccessJob(jobId, user);
    if (!this.canManageJob(job, user)) {
      throw new ForbiddenException({ error: 'Insufficient report job permissions' });
    }
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return job;

    job.status = 'cancelled';
    job.stage = 'cancelled';
    job.errorMessage = '任务已手动停止。';
    job.updatedAt = new Date().toISOString();
    this.pushEvent(job, { type: 'stage', stage: 'cancelled', message: '任务已手动停止。' });
    this.pushEvent(job, { type: 'done', jobId });
    this.streams.get(jobId)?.complete();
    this.streams.delete(jobId);
    await this.writeJobState(job);
    return job;
  }

  async deleteJob(jobId: string, user: AuthUser): Promise<JobRecord | undefined> {
    await this.jobsReady;
    if (!this.canDeleteReport(user)) {
      throw new ForbiddenException({ error: 'Only admin can delete report jobs' });
    }
    const job = this.assertCanAccessJob(jobId, user);
    job.status = job.status === 'running' || job.status === 'queued' ? 'cancelled' : job.status;
    job.stage = 'deleted';
    job.errorMessage = 'Job moved to trash by admin';
    job.updatedAt = new Date().toISOString();
    job.artifacts = {
      ...job.artifacts,
      deleted: true,
      deletedAt: job.updatedAt,
      deletedBy: user.username,
    };
    this.streams.get(jobId)?.complete();
    this.streams.delete(jobId);
    await this.writeJobState(job);
    return job;
  }

  async restoreJob(jobId: string, user: AuthUser): Promise<JobRecord | undefined> {
    await this.jobsReady;
    if (!this.canDeleteReport(user)) {
      throw new ForbiddenException({ error: 'Only admin can restore report jobs' });
    }
    const job = this.assertCanAccessJob(jobId, user);
    if (!this.isDeletedJob(job)) return job;
    const { deleted: _deleted, deletedAt: _deletedAt, deletedBy: _deletedBy, ...restArtifacts } = job.artifacts || {};
    job.artifacts = restArtifacts;
    job.stage = undefined;
    job.errorMessage = undefined;
    job.updatedAt = new Date().toISOString();
    await this.writeJobState(job);
    return job;
  }

  async permanentlyDeleteJob(jobId: string, user: AuthUser): Promise<{ jobId: string; deleted: true }> {
    await this.jobsReady;
    if (!this.canDeleteReport(user)) {
      throw new ForbiddenException({ error: 'Only admin can permanently delete report jobs' });
    }
    const job = this.assertCanAccessJob(jobId, user);
    if (!this.isDeletedJob(job)) {
      throw new ForbiddenException({ error: 'Move report job to trash before permanent deletion' });
    }
    this.streams.get(jobId)?.complete();
    this.streams.delete(jobId);
    this.jobs.delete(jobId);
    await this.removeJobArtifacts(job);
    return { jobId, deleted: true };
  }

  async createReportEdit(jobId: string, user: AuthUser, input: ReportEditInput): Promise<ReportEditResponse> {
    await this.jobsReady;
    if (!this.canUpdateReport(user)) {
      throw new ForbiddenException({ error: 'Insufficient report update permissions' });
    }
    const job = this.assertCanAccessJob(jobId, user);
    const normalized = this.normalizeReportEditInput(input);
    let generated: { editedText: string; modelUsed: string };
    try {
      generated = await this.generateReportEditText(job, normalized);
    } catch (error) {
      throw new InternalServerErrorException({
        error: '局部修改生成失败',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const editedText = String(generated.editedText || '').trim();
    if (!editedText) throw new InternalServerErrorException({ error: '局部修改生成失败', message: 'model returned empty text' });

    const result = await (await this.getPool()).query(
      `INSERT INTO report_edits (
         job_id, owner_id, target_type, target_path, original_text, instruction,
         edited_text, edit_mode, model_used, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed')
       RETURNING edit_id, job_id, owner_id, target_type, target_path, original_text,
                 instruction, edited_text, edit_mode, model_used, status, created_at`,
      [
        job.jobId,
        job.ownerUserId || user.id,
        normalized.targetType,
        normalized.targetPath,
        normalized.originalText,
        normalized.instruction,
        editedText,
        normalized.editMode,
        generated.modelUsed || REPORT_AGENT_MODEL,
      ],
    );
    return this.toReportEdit(result.rows[0]);
  }

  async listReportEdits(jobId: string, user: AuthUser): Promise<{ items: ReportEditResponse[] }> {
    await this.jobsReady;
    this.assertCanAccessJob(jobId, user);
    const result = await (await this.getPool()).query(
      `SELECT edit_id, job_id, owner_id, target_type, target_path, original_text,
              instruction, edited_text, edit_mode, model_used, status, created_at
         FROM report_edits
        WHERE job_id = $1
        ORDER BY created_at DESC`,
      [jobId],
    );
    return { items: result.rows.map((row) => this.toReportEdit(row)) };
  }

  async applyReportEdit(jobId: string, user: AuthUser, editId: string): Promise<never> {
    await this.jobsReady;
    if (!this.canUpdateReport(user)) {
      throw new ForbiddenException({ error: 'Insufficient report update permissions' });
    }
    this.assertCanAccessJob(jobId, user);
    throw new BadRequestException({
      error: 'Automatic apply is not supported in this version',
      message: '请先复制 editedText 手动替换，避免误改报告文件。',
      editId,
    });
  }

  async getQualityReview(jobId: string, user: AuthUser): Promise<ReportQualityReviewResponse | null> {
    await this.jobsReady;
    const job = this.assertCanAccessJob(jobId, user);
    const dbReview = await this.readLatestQualityReviewFromDb(job.jobId);
    if (dbReview) return dbReview;
    const artifactReview = await this.readQualityReviewArtifact(job);
    return artifactReview ? this.toQualityReview(artifactReview, job) : null;
  }

  async runQualityReview(jobId: string, user: AuthUser): Promise<ReportQualityReviewResponse> {
    await this.jobsReady;
    const job = this.assertCanAccessJob(jobId, user);
    return this.runQualityReviewForJob(job);
  }

  async runQualityReviewForJob(job: JobRecord): Promise<ReportQualityReviewResponse> {
    this.pushEvent(job, { type: 'stage', stage: 'quality_review', message: '成稿自检：开始检查报告质量。' });
    try {
      const markdown = await this.readFinalMarkdownForQualityReview(job);
      if (!markdown.trim()) throw new Error('报告正文为空，无法完成成稿自检。');
      const context = await this.collectQualityReviewContext(job);
      const reviewJson = this.buildQualityReviewJson(job, markdown, context);
      const saved = await this.saveQualityReview(job, reviewJson, 'completed', null);
      await this.writeQualityReviewArtifact(job, saved.reviewJson);
      this.pushEvent(job, { type: 'stage', stage: 'quality_review_done', message: `成稿自检：完成，综合评分 ${saved.overallScore ?? 0}。` });
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedJson = this.buildFailedQualityReviewJson(message);
      const saved = await this.saveQualityReview(job, failedJson, 'failed', message);
      await this.writeQualityReviewArtifact(job, saved.reviewJson).catch(() => undefined);
      this.pushEvent(job, { type: 'stage', stage: 'quality_review_failed', message: `成稿自检失败，可稍后重试。${this.sanitizeUserVisibleText(message, 180)}` });
      return saved;
    }
  }

  buildReportEditPayloadFromQualityIssue(issue: Record<string, unknown>): Record<string, unknown> {
    const targetText = String(issue.targetText || issue.evidence || '').trim();
    const suggestion = String(issue.suggestion || issue.problem || '').trim();
    const section = String(issue.section || '').trim();
    return {
      targetType: 'selected_text',
      targetPath: section ? `quality-review:${section}` : 'quality-review',
      originalText: targetText,
      instruction: suggestion || '请根据成稿自检建议进行局部修改，补充依据并保持表述审慎。',
      editMode: /来源|媒体|时间|主体|source/i.test(suggestion) ? 'add_sources' : 'polish',
    };
  }

  async getJobWithRecoveredReport(jobId: string, user: AuthUser): Promise<JobRecord | undefined> {
    await this.jobsReady;
    const job = this.assertCanAccessJob(jobId, user);
    if (!(job.status === 'succeeded' && job.resultPath)) {
      await this.recoverJobFromExistingReport(job, 'detail_lookup');
    }
    return job;
  }

  getStream(jobId: string): Subject<ServerEvent> | undefined {
    const existing = this.streams.get(jobId);
    if (existing) return existing;
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return undefined;
    const stream = new Subject<ServerEvent>();
    this.streams.set(jobId, stream);
    return stream;
  }

  getEventLog(jobId: string, user: AuthUser): { jobId: string; items: EventLogEntry[] } | undefined {
    const job = this.assertCanAccessJob(jobId, user);
    return { jobId, items: (job.eventLog ?? []).map((item) => this.sanitizeEventLogEntry(item)) };
  }

  async getProgressState(jobId: string, user: AuthUser): Promise<ReportProgressState | undefined> {
    const job = this.assertCanAccessJob(jobId, user);
    await this.refreshProgressState(job);
    return this.sanitizeProgressState(job.progressState);
  }

  serializeJob(job: JobRecord) {
    return {
      jobId: job.jobId,
      skill: job.skill,
      payload: job.payload,
      eventId: job.eventId,
      outlineId: job.outlineId,
      planId: job.planId,
      ownerUserId: job.ownerUserId ?? null,
      ownerUsername: job.ownerUsername ?? null,
      isDeleted: this.isDeletedJob(job),
      deletedAt: typeof job.artifacts?.deletedAt === 'string' ? job.artifacts.deletedAt : null,
      deletedBy: typeof job.artifacts?.deletedBy === 'string' ? job.artifacts.deletedBy : null,
      status: job.status,
      stage: job.stage,
      errorMessage: this.sanitizeUserVisibleText(job.errorMessage || '', 300) || undefined,
      resultPath: job.resultPath,
      progressState: this.sanitizeProgressState(job.progressState),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  isAdmin(user: AuthUser): boolean {
    return user.role === 'admin' || user.roles?.includes('admin') === true;
  }

  canCreateReport(user: AuthUser): boolean {
    return this.isAdmin(user) || user.permissions?.includes('report:create') === true;
  }

  canDeleteReport(user: AuthUser): boolean {
    return this.isAdmin(user);
  }

  canUpdateReport(user: AuthUser): boolean {
    return this.isAdmin(user) || user.permissions?.includes('report:update') === true;
  }

  private buildJobOwnerUser(job: JobRecord): AuthUser {
    const role = job.ownerRole === 'admin' ? 'admin' : job.ownerRole === 'operator' ? 'operator' : 'viewer';
    const roles = this.stringArray(job.ownerRoles);
    return {
      id: job.ownerUserId || '',
      username: job.ownerUsername || '',
      displayName: job.ownerUsername || '',
      email: '',
      role,
      roles: roles.length ? roles : [role],
      modules: this.stringArray(job.ownerModules),
      permissions: this.stringArray(job.ownerPermissions, 200),
    };
  }

  canAccessJob(job: JobRecord, user: AuthUser): boolean {
    if (this.canReadAllReports(user)) return true;
    if (!job.ownerUserId) return false;
    return job.ownerUserId === user.id;
  }

  private async loadDraftAssistantPlanBundle(planId: string, user: AuthUser): Promise<DraftAssistantPlanBundle> {
    if (!this.canCreateReport(user)) {
      throw new ForbiddenException({ error: 'Viewer cannot create report jobs' });
    }
    const pool = await this.getPool();
    const planResult = await pool.query(
      `SELECT plan_id, outline_id, event_id, owner_id, plan_json
         FROM report_plans
        WHERE plan_id = $1
        LIMIT 1`,
      [planId],
    );
    const planRow = planResult.rows[0];
    if (!planRow) throw new NotFoundException({ error: 'Report plan not found' });
    if (!this.isAdmin(user) && String(planRow.owner_id) !== user.id) {
      throw new NotFoundException({ error: 'Report plan not found' });
    }

    const eventResult = await pool.query(
      `SELECT event_id, owner_id, title, summary, basic_facts, timeline, actors, category, region,
              importance_score, risk_score, raw_input, analysis_json, created_at, updated_at
         FROM events
        WHERE event_id = $1
        LIMIT 1`,
      [String(planRow.event_id)],
    );
    const eventRow = eventResult.rows[0];
    if (!eventRow) throw new NotFoundException({ error: 'Draft event not found' });

    const sourcesResult = await pool.query(
      `SELECT source_id, source_title, source_url, publisher, author, published_at, content_text,
              source_summary, relevance_reason, supported_facts, supported_attitudes, credibility_score, created_at
         FROM event_sources
        WHERE event_id = $1
        ORDER BY created_at ASC`,
      [String(planRow.event_id)],
    );
    const attitudesResult = await pool.query(
      `SELECT attitude_id, actor, actor_type, statement_time, media, source_url,
              attitude_summary, attitude_polarity, confidence, created_at
         FROM event_attitudes
        WHERE event_id = $1
        ORDER BY created_at ASC`,
      [String(planRow.event_id)],
    );

    return {
      planId: String(planRow.plan_id),
      outlineId: String(planRow.outline_id),
      eventId: String(planRow.event_id),
      ownerId: String(planRow.owner_id),
      reportPlan: this.plainObject(planRow.plan_json),
      event: this.eventRowToDraftContext(eventRow),
      sources: sourcesResult.rows.map((row) => this.sourceRowToDraftContext(row)),
      attitudes: attitudesResult.rows.map((row) => this.attitudeRowToDraftContext(row)),
    };
  }

  private eventRowToDraftContext(row: Record<string, unknown>): Record<string, unknown> {
    return {
      eventId: String(row.event_id || ''),
      ownerId: String(row.owner_id || ''),
      title: String(row.title || ''),
      summary: String(row.summary || ''),
      basicFacts: Array.isArray(row.basic_facts) ? row.basic_facts : [],
      timeline: Array.isArray(row.timeline) ? row.timeline : [],
      actors: Array.isArray(row.actors) ? row.actors : [],
      category: String(row.category || ''),
      region: String(row.region || ''),
      importanceScore: Number(row.importance_score || 0),
      riskScore: Number(row.risk_score || 0),
      rawInput: this.plainObject(row.raw_input),
      analysis: this.plainObject(row.analysis_json),
      createdAt: this.isoString(row.created_at),
      updatedAt: this.isoString(row.updated_at),
    };
  }

  private sourceRowToDraftContext(row: Record<string, unknown>): Record<string, unknown> {
    return {
      sourceId: String(row.source_id || ''),
      sourceTitle: String(row.source_title || ''),
      sourceUrl: row.source_url ? String(row.source_url) : null,
      publisher: String(row.publisher || ''),
      author: String(row.author || ''),
      publishedAt: this.isoString(row.published_at) || null,
      contentText: String(row.content_text || ''),
      sourceSummary: String(row.source_summary || ''),
      relevanceReason: String(row.relevance_reason || ''),
      supportedFacts: Array.isArray(row.supported_facts) ? row.supported_facts : [],
      supportedAttitudes: Array.isArray(row.supported_attitudes) ? row.supported_attitudes : [],
      credibilityScore: Number(row.credibility_score || 0),
      createdAt: this.isoString(row.created_at),
    };
  }

  private attitudeRowToDraftContext(row: Record<string, unknown>): Record<string, unknown> {
    return {
      attitudeId: String(row.attitude_id || ''),
      actor: String(row.actor || ''),
      actorType: row.actor_type ? String(row.actor_type) : null,
      statementTime: this.isoString(row.statement_time) || null,
      media: row.media ? String(row.media) : null,
      sourceUrl: row.source_url ? String(row.source_url) : null,
      attitudeSummary: String(row.attitude_summary || ''),
      polarity: String(row.attitude_polarity || ''),
      confidence: Number(row.confidence || 0),
      createdAt: this.isoString(row.created_at),
    };
  }

  private optionalId(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : '';
  }

  private plainObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private stringArray(value: unknown, limit = 50): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .filter((item) => {
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
      })
      .slice(0, limit);
  }

  private isoString(value: unknown): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }

  private canReadAllReports(user: AuthUser): boolean {
    return this.isAdmin(user);
  }

  private canManageJob(job: JobRecord, user: AuthUser): boolean {
    if (this.isAdmin(user)) return true;
    if (!job.ownerUserId) return false;
    return job.ownerUserId === user.id;
  }

  assertCanAccessJob(jobId: string, user: AuthUser): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new NotFoundException({ error: 'Job not found' });
    this.assertCanAccessJobRecord(job, user);
    return job;
  }

  private assertCanAccessJobRecord(job: JobRecord, user: AuthUser): void {
    if (!this.canAccessJob(job, user)) {
      throw new ForbiddenException({ error: 'Insufficient report job permissions' });
    }
  }

  private canListJob(job: JobRecord, user: AuthUser, mineOnly = false): boolean {
    if (this.canReadAllReports(user) && !mineOnly) return true;
    if (!job.ownerUserId) return false;
    return job.ownerUserId === user.id;
  }

  private isDeletedJob(job: JobRecord): boolean {
    return job.artifacts?.deleted === true || job.stage === 'deleted';
  }

  private parsePositiveInt(value: string | number | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.floor(parsed);
  }

  private normalizeTypeFilter(value: string | undefined): JobListTypeFilter {
    const allowed = new Set<JobListTypeFilter>([
      'all',
      'write-hb-k',
      'write-hb-hb',
      'person-intelligence-report',
      'risk-assessment-reports',
    ]);
    return allowed.has(value as JobListTypeFilter) ? (value as JobListTypeFilter) : 'all';
  }

  private jobTypeKey(job: JobRecord): JobListTypeFilter {
    if (job.skill === 'write-hb') {
      const reportType = String((job.payload as { report_type?: unknown }).report_type ?? '').toLowerCase();
      return reportType.includes('hb') ? 'write-hb-hb' : 'write-hb-k';
    }
    if (job.skill === 'person-intelligence-report') return 'person-intelligence-report';
    if (job.skill === 'risk-assessment-reports') return 'risk-assessment-reports';
    return 'all';
  }

  private jobSearchText(job: JobRecord): string {
    return [
      job.jobId,
      job.skill,
      job.status,
      job.stage,
      job.errorMessage,
      job.resultPath,
      job.ownerUsername,
      this.payloadSearchText(job.payload),
    ].join(' ').toLowerCase();
  }

  private payloadSearchText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map((item) => this.payloadSearchText(item)).join(' ');
    if (typeof value === 'object') return Object.values(value).map((item) => this.payloadSearchText(item)).join(' ');
    return '';
  }

  private buildInitialProgressState(job: JobRecord): ReportProgressState {
    const now = new Date().toISOString();
    return {
      jobId: job.jobId,
      currentStage: job.status === 'queued' || job.status === 'running' ? 'plan' : null,
      updatedAt: now,
      stages: PROGRESS_STAGE_DEFS.map((stage, index) => ({
        ...stage,
        status: index === 0 && (job.status === 'queued' || job.status === 'running') ? 'running' : 'not_started',
        evidence: index === 0
          ? [{ source: 'job_status', message: `任务状态：${job.status}`, time: now }]
          : [],
      })),
    };
  }

  private async refreshProgressState(job: JobRecord, emit = false): Promise<ReportProgressState> {
    const state = await this.computeProgressState(job);
    job.progressState = state;
    if (emit) this.emitProgressState(job, state);
    else void this.writeJobState(job);
    return state;
  }

  private emitProgressState(job: JobRecord, progressState: ReportProgressState): void {
    job.events = job.events.filter((event) => event.type !== 'progress_state');
    const event: ServerEvent = { type: 'progress_state', progressState };
    job.events.push(event);
    this.streams.get(job.jobId)?.next(event);
    void this.writeJobState(job);
  }

  private async computeProgressState(job: JobRecord): Promise<ReportProgressState> {
    const evidenceByStage = new Map<ReportProgressStageKey, ReportProgressEvidence[]>();
    const statusByStage = new Map<ReportProgressStageKey, ReportProgressStageStatus>();
    const addEvidence = (
      key: ReportProgressStageKey,
      status: ReportProgressStageStatus,
      evidence: ReportProgressEvidence,
    ) => {
      evidenceByStage.set(key, [...(evidenceByStage.get(key) || []), evidence]);
      const current = statusByStage.get(key);
      if (current === 'failed') return;
      if (status === 'failed' || current !== 'done') statusByStage.set(key, status);
    };

    const now = new Date().toISOString();
    if (job.status === 'queued' || job.status === 'running') {
      addEvidence('plan', 'running', { source: 'job_status', message: `任务状态：${job.status}`, time: job.updatedAt || now });
    }

    for (const entry of job.eventLog || []) {
      const mapped = this.progressStageFromEventLog(entry);
      if (!mapped) continue;
      addEvidence(mapped.key, mapped.status, {
        source: entry.type === 'tool_start' || entry.type === 'tool_end' || entry.type === 'tool_error' ? 'tool_event' : 'event',
        message: entry.summary || entry.label || entry.phase || mapped.key,
        time: entry.time || now,
      });
    }

    const artifactEvidence =
      job.status === 'succeeded' || Boolean(job.resultPath)
        ? await this.collectTrustedProgressArtifactEvidence(job)
        : [];
    for (const item of artifactEvidence) addEvidence(item.key, item.status, item.evidence);

    if (job.status === 'succeeded') {
      for (const stage of PROGRESS_STAGE_DEFS) {
        if (stage.key === 'quality' && !job.artifacts?.qualityReview && !job.artifacts?.qualityReviewPath) continue;
        addEvidence(stage.key, 'done', {
          source: stage.key === 'report' ? 'report_file' : 'job_status',
          message: stage.key === 'report' ? '最终报告已确认生成。' : '任务已成功完成。',
          time: job.updatedAt || now,
        });
      }
    }

    if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'waiting_approval') {
      const failedKey = this.lastStartedProgressStage(statusByStage) || 'plan';
      addEvidence(failedKey, 'failed', {
        source: 'job_status',
        message: job.errorMessage || `任务状态：${job.status}`,
        time: job.updatedAt || now,
      });
    }

    const stages = this.ensureActiveProgressStage(this.normalizeProgressStageOrder(PROGRESS_STAGE_DEFS.map((stage) => ({
      ...stage,
      status: statusByStage.get(stage.key) || 'not_started',
      evidence: evidenceByStage.get(stage.key) || [],
    }))), job, now);
    const currentStage = this.currentProgressStage(stages);
    return {
      jobId: job.jobId,
      currentStage,
      updatedAt: now,
      stages,
    };
  }

  private progressStageFromEventLog(entry: EventLogEntry): { key: ReportProgressStageKey; status: ReportProgressStageStatus } | null {
    const haystack = `${entry.phase || ''} ${entry.label || ''} ${entry.summary || ''} ${entry.command || ''} ${entry.detail || ''}`.toLowerCase();
    const status: ReportProgressStageStatus =
      entry.type === 'tool_error' || entry.status === 'failed'
        ? 'failed'
        : entry.type === 'tool_end' || entry.status === 'completed' || /已完成|完成/.test(entry.summary || '')
          ? 'done'
          : 'running';

    if (/waiting_final_report|gateway_fallback|hermes:|^start$|^running$|received/.test(entry.phase || '')) return null;
    if (/context_preparing|context\.json|preparing hermes/.test(haystack)) return { key: 'plan', status };
    if (/资料采集工具|controlled-web-collector|crawler\.|crawler_source|crawlersourcecontext/.test(haystack)) return { key: 'research', status };
    if (/pg向量|pg-sources|pg_sources|vector_sources|database_sources|database_query_plan|数据库信源|数据库检索|信源检索/.test(haystack)) return { key: 'database', status };
    if (/research_planning|harness_cli\.py\s+plan|plan\.json|调研计划/.test(haystack)) return { key: 'plan', status };
    if (/synthesis_dispatch|synthesis_waiting/.test(entry.phase || '')) {
      return { key: 'consolidate', status: status === 'failed' ? 'failed' : 'running' };
    }
    if (/research_dispatch|research_waiting|research_collecting|harness_cli\.py\s+run|research_|sessions_spawn|sessions_yield|资料|调研子任务/.test(haystack)) return { key: 'research', status };
    if (/research_consolidating|consolidated\.json|素材整合|证据包/.test(haystack)) return { key: 'consolidate', status };
    if (/synthesis_writing|validate_report\.py|report_verifying|校验报告|\breport_file_recovered\b|report generation completed|report_file:\s*\/|report_file：\s*\//.test(haystack)) {
      return { key: 'report', status: status === 'failed' ? 'failed' : 'running' };
    }
    if (/quality_review|成稿自检|quality_review\.json/.test(haystack)) return { key: 'quality', status };
    return null;
  }

  private async collectProgressArtifactEvidence(job: JobRecord): Promise<Array<{ key: ReportProgressStageKey; evidence: ReportProgressEvidence }>> {
    const reportDir = this.remoteFs.remoteDir;
    const cachedJobDir = typeof job.artifacts?.hermesJobDir === 'string' ? job.artifacts.hermesJobDir : '';
    const resolvedJobDir = cachedJobDir || await this.resolveHermesJobDir(job);
    if (resolvedJobDir && resolvedJobDir !== cachedJobDir) {
      job.artifacts = { ...job.artifacts, hermesJobDir: resolvedJobDir };
    }
    const jobDir = resolvedJobDir || this.remoteFs.joinPath(reportDir, job.jobId);
    const now = new Date().toISOString();
    const result: Array<{ key: ReportProgressStageKey; evidence: ReportProgressEvidence }> = [];
    const addIfExists = async (key: ReportProgressStageKey, filePath: string, message: string) => {
      try {
        if (await this.remoteFs.exists(filePath)) {
          result.push({ key, evidence: { source: key === 'report' ? 'report_file' : 'artifact', message, time: now } });
        }
      } catch {
        // Missing artifacts are expected while a job is running.
      }
    };

    await addIfExists('plan', this.remoteFs.joinPath(jobDir, 'context.json'), '任务上下文文件已生成。');
    await addIfExists('database', this.remoteFs.joinPath(jobDir, 'database', 'database_sources.json'), '数据库信源文件已生成。');
    await addIfExists('database', this.remoteFs.joinPath(jobDir, 'database', 'vector_sources.json'), '向量信源文件已生成。');
    await addIfExists('database', this.remoteFs.joinPath(jobDir, 'database', 'database_query_plan.json'), '信源查询计划已生成。');
    await addIfExists('research', this.remoteFs.joinPath(jobDir, 'crawler', 'crawler_sources.json'), '资料采集信源文件已生成。');
    await addIfExists('plan', this.remoteFs.joinPath(jobDir, 'plan.json'), '调研计划文件已生成。');
    try {
      const groupEntries = await this.remoteFs.readdir(this.remoteFs.joinPath(jobDir, 'groups'));
      if (groupEntries.some((entry) => entry.isFile && /^group_[a-z0-9_-]+\.json$/i.test(entry.name))) {
        result.push({ key: 'plan', evidence: { source: 'artifact', message: '调研分组文件已生成。', time: now } });
      }
    } catch {
      // Group files are created later in the workflow.
    }
    try {
      const researchEntries = await this.remoteFs.readdir(this.remoteFs.joinPath(jobDir, 'research'));
      if (researchEntries.some((entry) => entry.isFile && /^research_[a-z0-9_-]+\.json$/i.test(entry.name))) {
        result.push({ key: 'research', evidence: { source: 'artifact', message: '调研结果文件已生成。', time: now } });
      }
    } catch {
      // Research files are created later in the workflow.
    }
    await addIfExists('consolidate', this.remoteFs.joinPath(jobDir, 'research', 'consolidated.json'), '综合素材文件已生成。');
    await addIfExists('report', this.remoteFs.joinPath(jobDir, 'final', 'report.md'), '最终报告文件已生成。');
    await addIfExists('quality', this.remoteFs.joinPath(jobDir, 'quality', 'quality_review.json'), '成稿自检结果已生成。');
    if (job.resultPath) await addIfExists('report', job.resultPath, '最终报告文件已登记。');
    return result;
  }

  private async collectTrustedProgressArtifactEvidence(job: JobRecord): Promise<Array<{ key: ReportProgressStageKey; status: ReportProgressStageStatus; evidence: ReportProgressEvidence }>> {
    const cachedJobDir = typeof job.artifacts?.hermesJobDir === 'string' ? job.artifacts.hermesJobDir : '';
    if (cachedJobDir && !this.hermesJobDirMatchesJob(cachedJobDir, job.jobId)) {
      const { hermesJobDir, ...restArtifacts } = job.artifacts || {};
      job.artifacts = restArtifacts;
    }

    const jobDir = await this.resolveHermesJobDir(job) || this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const now = new Date().toISOString();
    const result: Array<{ key: ReportProgressStageKey; status: ReportProgressStageStatus; evidence: ReportProgressEvidence }> = [];
    const addIfExists = async (
      key: ReportProgressStageKey,
      filePath: string,
      message: string,
      status: ReportProgressStageStatus = 'done',
    ) => {
      try {
        if (await this.remoteFs.exists(filePath)) {
          result.push({ key, status, evidence: { source: key === 'report' ? 'report_file' : 'artifact', message, time: now } });
        }
      } catch {
        // Missing artifacts are expected while a job is running.
      }
    };

    await addIfExists('plan', this.remoteFs.joinPath(jobDir, 'context.json'), '任务上下文文件已生成。');
    await addIfExists('database', this.remoteFs.joinPath(jobDir, 'database', 'database_sources.json'), '数据库信源文件已生成。');
    await addIfExists('database', this.remoteFs.joinPath(jobDir, 'database', 'vector_sources.json'), '向量信源文件已生成。');
    await addIfExists('database', this.remoteFs.joinPath(jobDir, 'database', 'database_query_plan.json'), '信源查询计划已生成。');
    await addIfExists('research', this.remoteFs.joinPath(jobDir, 'crawler', 'crawler_sources.json'), '资料采集信源文件已生成。');
    await addIfExists('plan', this.remoteFs.joinPath(jobDir, 'plan.json'), '调研计划文件已生成。');
    try {
      const groupEntries = await this.remoteFs.readdir(this.remoteFs.joinPath(jobDir, 'groups'));
      if (groupEntries.some((entry) => entry.isFile && /^group_[a-z0-9_-]+\.json$/i.test(entry.name))) {
        result.push({ key: 'plan', status: 'done', evidence: { source: 'artifact', message: '调研分组文件已生成。', time: now } });
      }
    } catch {
      // Group files are created later in the workflow.
    }
    try {
      const researchEntries = await this.remoteFs.readdir(this.remoteFs.joinPath(jobDir, 'research'));
      if (researchEntries.some((entry) => entry.isFile && /^research_[a-z0-9_-]+\.json$/i.test(entry.name))) {
        result.push({ key: 'research', status: 'done', evidence: { source: 'artifact', message: '调研结果文件已生成。', time: now } });
      }
    } catch {
      // Research files are created later in the workflow.
    }
    await addIfExists('consolidate', this.remoteFs.joinPath(jobDir, 'research', 'consolidated.json'), '综合素材文件已生成。');
    if (job.status === 'succeeded' || job.resultPath) {
      await addIfExists(
        'report',
        this.remoteFs.joinPath(jobDir, 'final', 'report.md'),
        '最终报告文件已生成。',
        'done',
      );
    }
    await addIfExists('quality', this.remoteFs.joinPath(jobDir, 'quality', 'quality_review.json'), '成稿自检结果已生成。');
    if (job.resultPath) await addIfExists('report', job.resultPath, '最终报告文件已登记。');
    return result;
  }

  private lastStartedProgressStage(statusByStage: Map<ReportProgressStageKey, ReportProgressStageStatus>): ReportProgressStageKey | null {
    let result: ReportProgressStageKey | null = null;
    for (const stage of PROGRESS_STAGE_DEFS) {
      if (statusByStage.has(stage.key)) result = stage.key;
    }
    return result;
  }

  private normalizeProgressStageOrder(stages: ReportProgressStage[]): ReportProgressStage[] {
    const failedIndex = stages.findIndex((stage) => stage.status === 'failed');
    const observableLimit = failedIndex >= 0
      ? failedIndex
      : stages.reduce((last, stage, index) => stage.status !== 'not_started' ? index : last, -1);
    if (observableLimit <= 0) return stages;

    const now = new Date().toISOString();
    return stages.map((stage, index) => {
      if (index >= observableLimit || stage.status === 'failed' || stage.status === 'done') return stage;
      return {
        ...stage,
        status: 'done',
        evidence: [
          ...stage.evidence,
          {
            source: 'artifact',
            message: `已观察到后续阶段“${stages[observableLimit].title}”的真实执行证据。`,
            time: now,
          },
        ],
      };
    });
  }

  private ensureActiveProgressStage(stages: ReportProgressStage[], job: JobRecord, now: string): ReportProgressStage[] {
    if (job.status !== 'queued' && job.status !== 'running') return stages;
    if (stages.some((stage) => stage.status === 'failed' || stage.status === 'running')) return stages;

    const lastDoneIndex = stages.reduce((last, stage, index) => stage.status === 'done' ? index : last, -1);
    const activeIndex = Math.min(Math.max(lastDoneIndex + 1, 0), stages.length - 1);
    return stages.map((stage, index) => {
      if (index !== activeIndex || stage.status !== 'not_started') return stage;
      return {
        ...stage,
        status: 'running',
        evidence: [
          ...stage.evidence,
          {
            source: 'job_status',
            message: '任务仍在运行，等待该阶段的实时执行证据。',
            time: now,
          },
        ],
      };
    });
  }

  private currentProgressStage(stages: ReportProgressStage[]): ReportProgressStageKey | null {
    const failed = stages.find((stage) => stage.status === 'failed');
    if (failed) return failed.key;
    const running = stages.find((stage) => stage.status === 'running');
    if (running) return running.key;
    for (let index = stages.length - 1; index >= 0; index -= 1) {
      if (stages[index].status === 'done') return stages[index].key;
    }
    return null;
  }

  async getResult(jobId: string, user: AuthUser) {
    const job = this.assertCanAccessJob(jobId, user);
    if (job.status !== 'succeeded') return null;
    return { html: await this.renderMarkdownToHtml(job.markdown ?? ''), artifacts: this.sanitizedArtifactMetadata(job.artifacts) };
  }

  async getResultFromDisk(jobId: string, user: AuthUser) {
    const job = this.assertCanAccessJob(jobId, user);
    if (!(job.status === 'succeeded' && job.resultPath)) {
      await this.recoverJobFromExistingReport(job, 'result_lookup');
    }
    if (job.status !== 'succeeded') return null;
    const storedMarkdown = await this.readStoredReportMarkdown(job);
    if (storedMarkdown) {
      return {
        html: await this.renderMarkdownToHtml(storedMarkdown.markdown),
        artifacts: this.sanitizedArtifactMetadata(job.artifacts),
        resultPath: this.publicResultPath(storedMarkdown.storageKey),
      };
    }

    const reportDir = this.remoteFs.remoteDir;
    const jobScopedPath = this.remoteFs.joinPath(reportDir, `${job.jobId}.md`);
    const hasJobScopedFile = await this.remoteFs.exists(jobScopedPath);

    let resultFilePath = job.resultPath ?? null;
    if (resultFilePath && !this.remoteFs.isInsideReportDir(resultFilePath)) {
      const remapped = this.remoteFs.remapToReportDir(resultFilePath);
      if (remapped && await this.remoteFs.exists(remapped)) {
        resultFilePath = remapped;
        job.resultPath = remapped;
      } else {
        resultFilePath = null;
      }
    }

    const direct = await this.readMarkdownFile(hasJobScopedFile ? jobScopedPath : resultFilePath, job.jobId);
    if (hasJobScopedFile && direct) {
      return {
        html: await this.renderMarkdownToHtml(direct.markdown),
        artifacts: this.sanitizedArtifactMetadata(job.artifacts),
        resultPath: this.publicResultPath(direct.filePath),
      };
    }

    const fallback = direct ?? (await this.findBestMarkdownFileForJob(job));
    const markdown = fallback?.markdown ?? job.markdown ?? '';

    if (fallback?.filePath && fallback.filePath !== job.resultPath) {
      job.resultPath = fallback.filePath;
      job.markdown = fallback.markdown;
      job.updatedAt = new Date().toISOString();
      await this.writeJobState(job);
    }

    return {
      html: await this.renderMarkdownToHtml(markdown),
      artifacts: this.sanitizedArtifactMetadata(job.artifacts),
      resultPath: this.publicResultPath(fallback?.filePath ?? job.resultPath),
    };
  }

  async getMarkdownFromDisk(jobId: string, user: AuthUser) {
    const job = this.assertCanAccessJob(jobId, user);
    if (!(job.status === 'succeeded' && job.resultPath)) {
      await this.recoverJobFromExistingReport(job, 'download_lookup');
    }
    if (job.status !== 'succeeded' || !job.resultPath) return null;
    const storedMarkdown = await this.readStoredReportMarkdown(job);
    if (storedMarkdown) {
      return { markdown: storedMarkdown.markdown, artifacts: job.artifacts, resultPath: storedMarkdown.storageKey, artifact: storedMarkdown.artifact };
    }

    const resolved = await this.resolveArtifactLocalPath(job, job.resultPath, 'reportMarkdown');
    if (!resolved) return null;
    const markdown = await this.remoteFs.readFile(resolved);
    return { markdown, artifacts: job.artifacts, resultPath: resolved };
  }

  async getArtifacts(jobId: string, user: AuthUser) {
    const job = this.assertCanAccessJob(jobId, user);
    return {
      jobId: job.jobId,
      status: job.status,
      artifacts: this.sanitizedArtifactMetadata(job.artifacts),
      artifactSyncStatus: this.firstString(this.plainObject(job.artifacts), ['artifactSyncStatus']) || null,
      artifactSyncDiagnostics: this.plainObject(job.artifacts?.artifactSyncDiagnostics),
      result: {
        storageKey: String(job.resultPath || '').startsWith('reports/') ? job.resultPath : null,
        ready: job.status === 'succeeded' && Boolean(job.resultPath),
      },
    };
  }

  private async readStoredReportMarkdown(job: JobRecord): Promise<{ markdown: string; storageKey: string; artifact?: Record<string, unknown> } | null> {
    const artifact = this.plainObject(job.artifacts?.reportMarkdown);
    const storageKey = this.firstString(artifact, ['storageKey', 'storage_key']) ||
      (String(job.resultPath || '').startsWith('reports/') ? String(job.resultPath) : '');
    if (!storageKey || !this.artifactSync) return null;
    try {
      return { markdown: await this.artifactSync.readText(storageKey), storageKey, artifact };
    } catch {
      return null;
    }
  }

  private sanitizedArtifactMetadata(artifacts: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(artifacts || {})) {
      const item = this.plainObject(value);
      if (!item.storageKey && !item.storageProvider && !item.artifactType) continue;
      output[name] = {
        storageProvider: this.firstString(item, ['storageProvider']) || null,
        storageKey: this.firstString(item, ['storageKey']) || null,
        fileName: this.firstString(item, ['fileName']) || null,
        artifactType: this.firstString(item, ['artifactType']) || null,
        mimeType: this.firstString(item, ['mimeType']) || null,
        sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : null,
        sha256: this.firstString(item, ['sha256']) || null,
        createdAt: this.firstString(item, ['createdAt']) || null,
      };
    }
    return output;
  }

  private publicResultPath(value: unknown): string | null {
    const pathValue = String(value || '');
    return pathValue.startsWith('reports/') ? pathValue : null;
  }

  async getDatabaseSources(jobId: string, user?: AuthUser): Promise<DatabaseSourcesResponse | undefined> {
    const job = user ? this.assertCanAccessJob(jobId, user) : this.jobs.get(jobId);
    if (!job) return undefined;

    const dir = await this.resolveHermesJobDir(job);
    if (!dir) {
      const vectorResult = this.vectorResultFromJob(job);
      const vectorSources = this.normalizeVectorSources(vectorResult?.sources || []).slice(0, 50);
      const entityPolicy = await this.entityPolicyForJob(job, null);
      const filtered = this.filterDatabaseSourcesForResponse(vectorSources, entityPolicy);
      if (vectorSources.length) {
        const status: DatabaseSourcesResponse['status'] = filtered.acceptedSources.length
          ? 'hit'
          : filtered.diagnostics.fallbackReason
            ? 'fallback'
            : 'empty';
        return {
          status,
          sources: filtered.acceptedSources,
          acceptedSources: filtered.acceptedSources,
          uncertainSources: filtered.uncertainSources,
          rejectedSources: filtered.rejectedSources,
          diagnostics: { ...filtered.diagnostics, entityPolicy },
          message: this.databaseSourceMessage(filtered),
          fallbackReason: filtered.diagnostics.fallbackReason,
          totalHits: Math.max(vectorResult?.totalHits || 0, vectorSources.length),
          updatedAt: vectorResult?.updatedAt || null,
          queryPlan: this.emptyDatabaseQueryPlanSummary(),
          retrievalMode: 'vector',
          vectorPlan: this.buildVectorQueryPlanSummary(vectorResult),
        };
      }
      return {
        status: 'unavailable',
        sources: [],
        fallbackReason: '',
        totalHits: 0,
        updatedAt: null,
        queryPlan: this.emptyDatabaseQueryPlanSummary(),
        retrievalMode: 'keyword',
        vectorPlan: this.buildVectorQueryPlanSummary(vectorResult),
      };
    }

    const planPath = this.remoteFs.joinPath(dir, 'database', 'database_query_plan.json');
    const sourcesPath = this.remoteFs.joinPath(dir, 'database', 'database_sources.json');
    const plan = await this.readJsonFile(planPath);
    const planObject = plan && !Array.isArray(plan) ? plan : null;
    const sourcesRaw = await this.readJsonFile(sourcesPath);
    const sourcesList = Array.isArray(sourcesRaw) ? sourcesRaw : [];
    const vectorResult = this.vectorResultFromJob(job);
    const vectorSources = this.normalizeVectorSources(vectorResult?.sources || []);
    const candidates = this.mergeDatabaseSources(vectorSources, this.normalizeDatabaseSources(sourcesList)).slice(0, 50);
    const contextJson = await this.readJsonFile(this.remoteFs.joinPath(dir, 'context.json'));
    const contextObject = contextJson && !Array.isArray(contextJson) ? contextJson : null;
    const entityPolicy = await this.entityPolicyForJob(job, dir, contextObject);
    const filtered = this.filterDatabaseSourcesForResponse(candidates, entityPolicy);
    const savedDiagnostics = await this.readDatabaseSourceDiagnostics(dir);
    const uncertainSources = filtered.uncertainSources.length
      ? filtered.uncertainSources
      : this.normalizeDiagnosticDatabaseSources(savedDiagnostics.uncertainSources);
    const rejectedSources = filtered.rejectedSources.length
      ? filtered.rejectedSources
      : this.normalizeDiagnosticDatabaseSources(savedDiagnostics.rejectedSources);
    const sources = filtered.acceptedSources;
    const queryPlan = this.buildDatabaseQueryPlanSummary(planObject, sources.length);
    const vectorPlan = this.buildVectorQueryPlanSummary(vectorResult);
    const fallbackReason = this.sanitizeLogText(
      this.firstString(planObject, ['database_source_fallback_reason', 'fallbackReason', 'fallback_reason']) ||
        filtered.diagnostics.fallbackReason ||
        vectorPlan.fallbackReason,
      300,
    );

    let updatedAt: string | null = null;
    try {
      const sourceStat = await this.remoteFs.stat(sourcesPath);
      updatedAt = Number.isFinite(sourceStat.mtimeMs) ? new Date(sourceStat.mtimeMs).toISOString() : null;
    } catch {
      try {
        const planStat = await this.remoteFs.stat(planPath);
        updatedAt = Number.isFinite(planStat.mtimeMs) ? new Date(planStat.mtimeMs).toISOString() : null;
      } catch {
        updatedAt = null;
      }
    }

    const planTotalHits = this.firstNumber(planObject, ['total_hits', 'totalHits', 'relevant_hits']) || 0;
    const vectorTotalHits = vectorResult?.totalHits || 0;
    const totalHits = Math.max(planTotalHits + vectorTotalHits, candidates.length, sources.length);
    const status: DatabaseSourcesResponse['status'] = sources.length
      ? 'hit'
      : fallbackReason
        ? 'fallback'
        : plan
          ? 'empty'
          : 'unavailable';

    const retrievalMode = vectorSources.length && sourcesList.length
      ? 'hybrid'
      : vectorSources.length
        ? 'vector'
        : 'keyword';

    return {
      status,
      sources,
      acceptedSources: sources,
      uncertainSources,
      rejectedSources,
      diagnostics: { ...filtered.diagnostics, ...savedDiagnostics.diagnostics, entityPolicy },
      message: this.databaseSourceMessage({
        ...filtered,
        uncertainSources,
        rejectedSources,
      }),
      fallbackReason,
      totalHits,
      updatedAt,
      queryPlan,
      retrievalMode,
      vectorPlan,
    };
  }

  async getSources(jobId: string, options: ReportSourcesOptions = {}, user: AuthUser): Promise<ReportSourcesResponse | undefined> {
    const job = this.assertCanAccessJob(jobId, user);

    const type = this.normalizeReportSourceType(options.type);
    const page = this.parsePositiveInt(options.page, 1);
    const pageSize = Math.min(this.parsePositiveInt(options.pageSize, 10), 100);

    const [reportRefs, structuredSources, crawlerSources, toolSearchSources, candidateResult, extractFailed] = await Promise.all([
      this.reportReferenceSources(job),
      this.structuredReportSources(job),
      this.crawlerReportSources(job),
      this.toolSearchSources(job),
      type === 'candidate_hits' ? this.candidateHitSources(job) : Promise.resolve({ items: [], total: 0, detailSaved: false }),
      type === 'extract_failed' ? this.extractFailedSources(job) : Promise.resolve([]),
    ]);

    const databaseRecall = this.databaseRecallChannelSources(structuredSources, reportRefs);
    const toolSearch = this.toolSearchChannelSources(toolSearchSources, reportRefs, databaseRecall);
    const sourceDiagnostics = await this.reportSourceDiagnostics(job);
    const summary: ReportSourceSummary = {
      databaseRecallCount: databaseRecall.length,
      crawlerCount: crawlerSources.length,
      toolSearchCount: toolSearch.length,
      reportReferenceCount: reportRefs.length,
      structuredSourceCount: structuredSources.length,
    };

    const groups: Record<Exclude<ReportSourceListType, 'all'>, ReportSourceListItem[]> = {
      database_recall: databaseRecall,
      crawler: crawlerSources,
      tool_search: toolSearch,
      report_refs: reportRefs,
      structured_sources: structuredSources,
      candidate_hits: candidateResult.items,
      extract_failed: extractFailed,
    };
    const allItems = type === 'all'
      ? [...databaseRecall, ...crawlerSources, ...toolSearch].sort((a, b) => this.reportSourcePriority(b) - this.reportSourcePriority(a))
      : groups[type] || [];
    const total = type === 'candidate_hits'
      ? (candidateResult.total || allItems.length)
      : allItems.length;
    const start = (page - 1) * pageSize;
    const items = allItems.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: start + items.length < total && allItems.length > start + items.length,
      meta: {
        summary,
        sourceDiagnostics,
        ...(type === 'candidate_hits'
          ? {
            detailSaved: candidateResult.detailSaved,
            message: candidateResult.detailSaved
              ? ''
              : `候选池共 ${total} 条，当前历史任务未保存候选明细。`,
          }
          : {}),
      },
    };
  }

  private async enrichPayloadWithVectorSources(job: JobRecord): Promise<Record<string, unknown>> {
    const payload = { ...(job.payload as unknown as Record<string, unknown>) };
    if (job.skill !== 'write-hb') return payload;

    const knownContext = typeof payload.known_context === 'string' ? payload.known_context : '';
    const parsed = this.withDraftAssistantDatabaseSourceDefaults(this.parseJsonObject(knownContext) || {});
    const databaseOptions = parsed.databaseSourceOptions && typeof parsed.databaseSourceOptions === 'object' && !Array.isArray(parsed.databaseSourceOptions)
      ? parsed.databaseSourceOptions as Record<string, unknown>
      : {};
    const databaseEnabled = databaseOptions.enabled === true || String(databaseOptions.enabled).toLowerCase() === 'true';
    if (!databaseEnabled) return payload;

    const maxRows = this.boundInt(databaseOptions.maxMetadataRows, 50, 1, 100);
    const lookbackDays = this.boundInt(databaseOptions.lookbackDays, 30, 0, 365);
    const result = await this.vectorSources.search({
      topic: String(payload.topic || parsed.topic || ''),
      knownContext: parsed,
      maxRows,
      lookbackDays,
    });
    const entityPolicy = await this.entityPolicyForJob(job, null, parsed);
    const filtered = filterSourcesByEntityPolicy(
      result.sources.map((source) => ({ ...source })),
      entityPolicy,
    );
    const acceptedVectorSources = filtered.acceptedSources.map((source) => this.vectorSourceFromGuardedSource(source));

    job.artifacts = {
      ...job.artifacts,
      vectorDatabaseCandidateSources: result.sources,
      vectorDatabaseSources: acceptedVectorSources,
      vectorDatabaseUncertainSources: filtered.uncertainSources,
      vectorDatabaseRejectedSources: filtered.rejectedSources,
      vectorDatabaseQueryPlan: result.queryPlan,
      vectorDatabaseSourceStatus: result.status,
      entityPolicy,
      databaseSourceDiagnostics: filtered.diagnostics,
    };
    await this.writeJobState(job);

    const enrichedContext = {
      ...parsed,
      entityPolicy,
      vectorDatabaseSourceOptions: {
        enabled: true,
        provider: 'postgres_pgvector',
        mode: 'semantic_summary',
        lookbackDays,
        maxMetadataRows: maxRows,
      },
      vectorDatabaseSources: acceptedVectorSources,
      vectorDatabaseQueryPlan: result.queryPlan,
      sourceDiagnostics: {
        ...this.plainObject(parsed.sourceDiagnostics),
        database: {
          entityPolicy,
          ...filtered.diagnostics,
        },
      },
    };

    await this.writeBackendDatabaseRecallArtifacts(job, enrichedContext, {
      ...result,
      sources: acceptedVectorSources,
    }, {
      maxRows,
      lookbackDays,
      databaseOptions,
      entityPolicy,
      sourceFilter: filtered,
    });

    const liveSources = this.normalizeVectorSources(acceptedVectorSources).slice(0, 50);
    this.pushEvent(job, {
      type: 'stage',
      stage: 'database_sources',
      message: liveSources.length
        ? `PG vector sources recalled: ${liveSources.length} items.`
        : `数据库检索工具：未找到通过核心实体校验的数据库信源，已过滤 ${filtered.rejectedSources.length + filtered.uncertainSources.length} 条候选。`,
    });
    this.pushEvent(job, { type: 'sources', sources: liveSources.map((source) => ({ ...source })) });

    payload.known_context = JSON.stringify(enrichedContext, null, 2);
    return payload;
  }

  private async enrichPayloadWithWebSupplement(job: JobRecord, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (job.skill !== 'write-hb') return payload;
    const startedAt = Date.now();
    const context = this.contextObjectFromPayload(payload);
    const databaseSources = Array.isArray(context.vectorDatabaseSources)
      ? context.vectorDatabaseSources.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      : [];
    const supplementOptions = this.plainObject(context.sourceSupplementOptions);
    const databaseOptions = this.plainObject(context.databaseSourceOptions);
    const minimumAcceptedDatabaseSources = this.boundInt(
      supplementOptions.minimumAcceptedDatabaseSources ?? databaseOptions.minimumAcceptedDatabaseSources ?? 3,
      3,
      1,
      20,
    );
    const decision = decideWebSupplementTrigger({
      acceptedDatabaseCount: databaseSources.length,
      minimumAcceptedDatabaseSources,
      context,
    });
    const jobDir = this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const entityPolicy = await this.entityPolicyForJob(job, jobDir, context);
    const queries = buildSupplementQueries(entityPolicy);
    const baseDiagnostics: SupplementChannelResult['diagnostics'] = {
      triggered: decision.triggered,
      triggerReason: decision.reason,
      queries,
      searchResultCount: 0,
      searchValidatedCount: 0,
      fetchedCount: 0,
      acceptedCount: 0,
      uncertainCount: 0,
      rejectedCount: 0,
      minimumAcceptedDatabaseSources: decision.minimumAcceptedDatabaseSources,
    };

    if (!decision.triggered) {
      const retrievalMetrics = this.retrievalMetrics(context, baseDiagnostics, { totalSupplementDurationMs: Date.now() - startedAt });
      const nextContext = this.withSupplementDiagnostics(context, { ...baseDiagnostics, retrievalMetrics }, {}, {});
      await this.writeWebSupplementArtifacts(job, nextContext, this.emptySupplementResult(baseDiagnostics));
      return { ...payload, known_context: JSON.stringify(nextContext, null, 2) };
    }

    this.pushEvent(job, {
      type: 'stage',
      stage: 'web_supplement_started',
      message: `数据库有效信源不足，启动公开信源补充；使用 ${queries.length} 个精确查询词。`,
    });

    const webAllowed = this.webSearchAllowed(context);
    let searchCandidates: WebSearchSource[] = [];
    let searchDurationMs = 0;
    let queryDiagnostics: Array<Record<string, unknown>> = [];
    if (webAllowed && this.webSupplement && queries.length) {
      try {
        const searchStartedAt = Date.now();
        if (typeof (this.webSupplement as unknown as { searchWithDiagnostics?: unknown }).searchWithDiagnostics === 'function') {
          const result = await (this.webSupplement as unknown as {
            searchWithDiagnostics(terms: string[], maxResults: number): Promise<{ sources: WebSearchSource[]; queryDiagnostics: Array<Record<string, unknown>>; durationMs: number }>;
          }).searchWithDiagnostics(queries, WEB_SUPPLEMENT_LIMITS.candidatesPerQuery);
          searchCandidates = result.sources;
          queryDiagnostics = result.queryDiagnostics;
          searchDurationMs = result.durationMs;
        } else {
          searchCandidates = await this.webSupplement.search(queries, WEB_SUPPLEMENT_LIMITS.candidatesPerQuery);
          searchDurationMs = Date.now() - searchStartedAt;
        }
      } catch (error) {
        this.pushEvent(job, {
          type: 'stage',
          stage: 'web_supplement_warning',
          message: `互联网搜索工具：公开信源补充未完成，继续使用现有来源。${this.sanitizeUserVisibleText(error instanceof Error ? error.message : String(error), 160)}`,
        });
      }
    }
    this.pushEvent(job, {
      type: 'stage',
      stage: 'web_supplement_search',
      message: `互联网搜索工具：使用 ${queries.length} 个精确查询词，获得 ${searchCandidates.length} 条候选。`,
    });

    const searchValidationInput = searchCandidates.map((source) => ({
      ...source,
      content: '',
      vectorScore: source.searchScore,
      validationStage: 'search_result_validation',
    }));
    const searchFiltered = filterSourcesByEntityPolicy(searchValidationInput, entityPolicy);
    const searchAcceptedKeys = new Set(searchFiltered.acceptedSources.map((source) => this.supplementSourceKey(source)).filter(Boolean));
    const acceptedSearchCandidates = searchCandidates.filter((source) => searchAcceptedKeys.has(this.supplementSourceKey(source)));
    this.pushEvent(job, {
      type: 'stage',
      stage: 'web_supplement_entity_guard',
      message: `互联网搜索工具：搜索摘要实体校验通过 ${acceptedSearchCandidates.length} 条。`,
    });

    const webAccepted: Record<string, unknown>[] = [];
    const webUncertain: Record<string, unknown>[] = [...searchFiltered.uncertainSources];
    const webRejected: Record<string, unknown>[] = [...searchFiltered.rejectedSources];
    const urlsNeedingCrawler: string[] = [];
    let fetchedCount = 0;

    const fetchStartedAt = Date.now();
    for (const source of acceptedSearchCandidates.slice(0, WEB_SUPPLEMENT_LIMITS.maxFullContentFetches)) {
      if (!String(source.content || '').trim()) {
        if (source.url) urlsNeedingCrawler.push(source.url);
        else webRejected.push(this.rejectedSupplementSource(source, '正文抓取缺失，无法完成二次校验。'));
        continue;
      }
      fetchedCount += 1;
      const finalSource = { ...source, validationStage: 'fetched_content_validation', vectorScore: source.searchScore };
      const bodyOnlyFiltered = filterSourcesByEntityPolicy([{
        ...finalSource,
        title: '',
        summary: '',
        snippet: '',
      }], entityPolicy);
      if (!this.fetchedBodyEntityConsistent(bodyOnlyFiltered)) {
        webRejected.push(this.rejectedSupplementSource(finalSource, '搜索摘要命中实体，但抓取正文未通过核心实体校验或标题与正文不一致。'));
        continue;
      }
      const finalFiltered = filterSourcesByEntityPolicy([finalSource], entityPolicy);
      if (!finalFiltered.acceptedSources.length) {
        webRejected.push(...finalFiltered.rejectedSources, ...finalFiltered.uncertainSources);
        continue;
      }
      const guarded = finalFiltered.acceptedSources[0];
      const quality = assessSourceQuality(guarded);
      const enriched = { ...guarded, sourceQuality: quality };
      enriched.sourcePriority = sourcePriority(enriched);
      if (quality.status === 'accepted') webAccepted.push(enriched);
      else if (quality.status === 'uncertain') webUncertain.push(enriched);
      else webRejected.push(enriched);
    }

    const fetchDurationMs = Date.now() - fetchStartedAt;
    const crawlerStartedAt = Date.now();
    const crawlerCandidates = await this.fetchSupplementUrlsWithCrawler(job, context, urlsNeedingCrawler, queries);
    const crawlerDurationMs = Date.now() - crawlerStartedAt;
    fetchedCount += crawlerCandidates.length;
    const crawlerFiltered = filterSourcesByEntityPolicy(crawlerCandidates, entityPolicy);
    const crawlerAccepted: Record<string, unknown>[] = [];
    const crawlerUncertain: Record<string, unknown>[] = [...crawlerFiltered.uncertainSources];
    const crawlerRejected: Record<string, unknown>[] = [...crawlerFiltered.rejectedSources];
    for (const source of crawlerFiltered.acceptedSources) {
      const quality = assessSourceQuality(source);
      const enriched: Record<string, unknown> = { ...source, sourceQuality: quality };
      enriched.sourcePriority = sourcePriority(enriched);
      if (quality.status === 'accepted') crawlerAccepted.push(enriched);
      else if (quality.status === 'uncertain') crawlerUncertain.push(enriched);
      else crawlerRejected.push(enriched);
    }

    const databaseForDedupe = databaseSources.map((source) => ({
      ...source,
      sourceChannel: 'database',
      sourceQuality: this.plainObject(source.sourceQuality).score
        ? source.sourceQuality
        : { status: 'accepted', score: 0.68, tier: 'industry', reason: '已通过数据库实体校验。' },
    }));
    const acceptedBeforeDedupe = [
      ...databaseForDedupe,
      ...webAccepted.map((source) => ({ ...source, sourceChannel: 'web' })),
      ...crawlerAccepted.map((source) => ({ ...source, sourceChannel: 'crawler' })),
    ];
    const acceptedAll = dedupeSupplementSources(acceptedBeforeDedupe);
    const acceptedDatabaseSources = acceptedAll.filter((source) => source.sourceChannel === 'database').map((source) => this.withoutChannel(source));
    const acceptedWebSources = acceptedAll.filter((source) => source.sourceChannel === 'web').map((source) => this.withoutChannel(source));
    const acceptedCrawlerSources = acceptedAll.filter((source) => source.sourceChannel === 'crawler').map((source) => this.withoutChannel(source));
    const deduplication = {
      beforeCount: acceptedBeforeDedupe.length,
      afterCount: acceptedAll.length,
      removedCount: Math.max(0, acceptedBeforeDedupe.length - acceptedAll.length),
    };
    const diagnostics: SupplementChannelResult['diagnostics'] = {
      ...baseDiagnostics,
      searchResultCount: searchCandidates.length,
      searchValidatedCount: acceptedSearchCandidates.length,
      fetchedCount,
      acceptedCount: acceptedWebSources.length + acceptedCrawlerSources.length,
      uncertainCount: webUncertain.length + crawlerUncertain.length,
      rejectedCount: webRejected.length + crawlerRejected.length,
      queryDiagnostics,
      deduplication,
    };
    diagnostics.retrievalMetrics = this.retrievalMetrics(context, diagnostics, {
      webSearchDurationMs: searchDurationMs,
      fetchDurationMs,
      crawlerDurationMs,
      totalSupplementDurationMs: Date.now() - startedAt,
      crawlerAttemptCount: urlsNeedingCrawler.length,
      crawlerSuccessCount: crawlerCandidates.length,
      deduplication,
    });
    const result: SupplementChannelResult = {
      acceptedWebSources,
      uncertainWebSources: webUncertain,
      rejectedWebSources: webRejected,
      acceptedCrawlerSources,
      uncertainCrawlerSources: crawlerUncertain,
      rejectedCrawlerSources: crawlerRejected,
      diagnostics,
    };
    const previousCrawler = this.normalizeCrawlerSourceContext(context.crawlerSourceContext);
    const nextCrawlerItems = dedupeSupplementSources([
      ...previousCrawler.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'),
      ...acceptedCrawlerSources,
    ]);
    const nextContext = this.withSupplementDiagnostics({
      ...context,
      vectorDatabaseSources: acceptedDatabaseSources,
      webSources: acceptedWebSources,
      crawlerSourceContext: {
        ...previousCrawler,
        items: nextCrawlerItems,
      },
    }, diagnostics, {
      acceptedCount: acceptedWebSources.length,
      uncertainCount: webUncertain.length,
      rejectedCount: webRejected.length,
      searchResultCount: searchCandidates.length,
      fetchedCount,
      queryDiagnostics,
    }, {
      acceptedCount: acceptedCrawlerSources.length,
      uncertainCount: crawlerUncertain.length,
      rejectedCount: crawlerRejected.length,
    });

    job.artifacts = {
      ...job.artifacts,
      webSupplementDiagnostics: diagnostics,
      acceptedWebSources,
      acceptedCrawlerSources,
    };
    await this.writeWebSupplementArtifacts(job, nextContext, result);
    this.pushEvent(job, {
      type: 'stage',
      stage: 'web_supplement_completed',
      message: `公开信源补充完成：正文抓取成功 ${fetchedCount} 条，最终 accepted ${diagnostics.acceptedCount} 条，过滤 ${diagnostics.uncertainCount + diagnostics.rejectedCount} 条实体错配或低质量来源。`,
    });
    this.pushEvent(job, {
      type: 'sources',
      sources: [...acceptedWebSources, ...acceptedCrawlerSources],
    });
    return { ...payload, known_context: JSON.stringify(nextContext, null, 2) };
  }

  private emptySupplementResult(diagnostics: SupplementChannelResult['diagnostics']): SupplementChannelResult {
    return {
      acceptedWebSources: [],
      uncertainWebSources: [],
      rejectedWebSources: [],
      acceptedCrawlerSources: [],
      uncertainCrawlerSources: [],
      rejectedCrawlerSources: [],
      diagnostics,
    };
  }

  private withSupplementDiagnostics(
    context: Record<string, unknown>,
    supplement: SupplementChannelResult['diagnostics'],
    web: Record<string, unknown>,
    crawler: Record<string, unknown>,
  ): Record<string, unknown> {
    const existing = this.plainObject(context.sourceDiagnostics);
    return {
      ...context,
      sourceDiagnostics: {
        ...existing,
        web: { ...this.plainObject(existing.web), ...web },
        crawler: { ...this.plainObject(existing.crawler), ...crawler },
        supplement: {
          triggered: supplement.triggered,
          reason: supplement.triggerReason,
          queries: supplement.queries,
          searchResultCount: supplement.searchResultCount,
          searchValidatedCount: supplement.searchValidatedCount,
          fetchedCount: supplement.fetchedCount,
          acceptedCount: supplement.acceptedCount,
          uncertainCount: supplement.uncertainCount,
          rejectedCount: supplement.rejectedCount,
          minimumAcceptedDatabaseSources: supplement.minimumAcceptedDatabaseSources,
          queryDiagnostics: supplement.queryDiagnostics || [],
          retrievalMetrics: supplement.retrievalMetrics || {},
          deduplication: supplement.deduplication || {},
        },
      },
    };
  }

  private retrievalMetrics(
    context: Record<string, unknown>,
    supplement: SupplementChannelResult['diagnostics'],
    durations: Record<string, unknown>,
  ): Record<string, unknown> {
    const database = this.plainObject(this.plainObject(context.sourceDiagnostics).database);
    const databaseCandidates = Number(database.candidateCount ?? database.totalHits ?? 0);
    const databaseAccepted = Number(database.acceptedCount ?? (Array.isArray(context.vectorDatabaseSources) ? context.vectorDatabaseSources.length : 0));
    const databaseUncertain = Number(database.uncertainCount ?? 0);
    const databaseRejected = Number(database.rejectedCount ?? 0);
    const fetched = supplement.fetchedCount;
    const sourceDiagnostics = this.plainObject(context.sourceDiagnostics);
    const webAccepted = Number(this.plainObject(sourceDiagnostics.web).acceptedCount ?? supplement.acceptedCount);
    const crawlerAccepted = Number(this.plainObject(sourceDiagnostics.crawler).acceptedCount ?? 0);
    const acceptedTotal = databaseAccepted + webAccepted + crawlerAccepted;
    const acceptedSources = [
      ...(Array.isArray(context.vectorDatabaseSources) ? context.vectorDatabaseSources : []),
      ...(Array.isArray(context.webSources) ? context.webSources : []),
      ...this.normalizeCrawlerSourceContext(context.crawlerSourceContext).items,
    ].filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    const domains = new Set(acceptedSources.map((source) => this.sourceDomain(this.firstString(source, ['url', 'source_url', 'data_source_url']))).filter(Boolean));
    const officialCount = acceptedSources.filter((source) => this.plainObject(source.sourceQuality).tier === 'official').length;
    const mediaCount = acceptedSources.filter((source) => ['mainstream', 'industry'].includes(String(this.plainObject(source.sourceQuality).tier || ''))).length;
    const crawlerAttempts = Number(durations.crawlerAttemptCount ?? 0);
    const crawlerSuccess = Number(durations.crawlerSuccessCount ?? 0);
    return {
      database: {
        candidateCount: databaseCandidates,
        acceptedCount: databaseAccepted,
        uncertainCount: databaseUncertain,
        rejectedCount: databaseRejected,
        acceptanceRate: databaseCandidates ? databaseAccepted / databaseCandidates : 0,
      },
      web: {
        triggered: supplement.triggered,
        queryCount: supplement.queries.length,
        searchResultCount: supplement.searchResultCount,
        searchAcceptedCount: supplement.searchValidatedCount,
        fetchAttemptCount: Math.min(supplement.searchValidatedCount, WEB_SUPPLEMENT_LIMITS.maxFullContentFetches),
        fetchSuccessCount: fetched,
        fetchSuccessRate: Math.min(supplement.searchValidatedCount, WEB_SUPPLEMENT_LIMITS.maxFullContentFetches) ? fetched / Math.min(supplement.searchValidatedCount, WEB_SUPPLEMENT_LIMITS.maxFullContentFetches) : 0,
        contentAcceptedCount: supplement.acceptedCount - crawlerAccepted,
        contentRejectedCount: supplement.rejectedCount,
      },
      crawler: { attemptCount: crawlerAttempts, successCount: crawlerSuccess, acceptedCount: crawlerAccepted },
      deduplication: durations.deduplication || { beforeCount: acceptedTotal, afterCount: acceptedTotal, removedCount: 0 },
      final: {
        acceptedSourceCount: acceptedTotal,
        officialSourceCount: officialCount,
        mediaSourceCount: mediaCount,
        uniqueDomainCount: domains.size,
        referencedSourceCount: Number((context as Record<string, unknown>).reportReferencesCount ?? 0),
      },
      performance: {
        databaseDurationMs: Number(database.durationMs ?? 0),
        webSearchDurationMs: Number(durations.webSearchDurationMs ?? 0),
        fetchDurationMs: Number(durations.fetchDurationMs ?? 0),
        crawlerDurationMs: Number(durations.crawlerDurationMs ?? 0),
        totalSupplementDurationMs: Number(durations.totalSupplementDurationMs ?? 0),
      },
      limits: WEB_SUPPLEMENT_LIMITS,
    };
  }

  private sourceDomain(value: string): string {
    try { return new URL(value).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
  }

  private webSearchAllowed(context: Record<string, unknown>): boolean {
    const options = this.plainObject(context.webSearchOptions || context.internetSearchOptions);
    return options.enabled !== false && context.internetSearchEnabled !== false && context.webSearchEnabled !== false;
  }

  private async fetchSupplementUrlsWithCrawler(
    job: JobRecord,
    context: Record<string, unknown>,
    urls: string[],
    queries: string[],
  ): Promise<Record<string, unknown>[]> {
    if (!urls.length || !this.crawler || !job.ownerUserId) return [];
    const crawlerPlan = this.plainObject(context.crawlerPlan);
    const supplementOptions = this.plainObject(context.sourceSupplementOptions);
    const crawlerAllowed = crawlerPlan.enabled === true || supplementOptions.allowCrawlerFetch === true;
    if (!crawlerAllowed) return [];
    try {
      const uniqueUrls = Array.from(new Set(urls)).slice(0, WEB_SUPPLEMENT_LIMITS.maxCrawlerFallbackUrls);
      const task = await this.crawler.createTask({
        jobId: job.jobId,
        ownerId: job.ownerUserId,
        ownerUsername: job.ownerUsername || '',
        title: `${String(context.topic || (job.payload as unknown as Record<string, unknown>).topic || '编报')}公开信源正文补充`,
        goal: `抓取通过搜索摘要实体校验的公开来源正文，查询词：${queries.slice(0, 6).join('；')}`,
        crawlerPlan: {
          enabled: true,
          mode: 'manual',
          goal: '公开信源正文二次校验',
          autoGapFilling: false,
          directions: [],
          manualUrls: uniqueUrls,
          manualDomains: [],
          manualKeywords: queries,
          maxPages: uniqueUrls.length,
          maxDepth: 0,
          language: 'zh-CN',
          executePhase: 'research',
          sourcePhase: 'research',
        },
        maxPages: uniqueUrls.length,
        maxDepth: 0,
      });
      const result = await this.crawler.runTask(task.taskId);
      return result.items.map((item) => ({
        itemId: item.itemId,
        taskId: item.taskId,
        title: item.title,
        url: item.url,
        publisher: item.publisher,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt,
        summary: item.contentSummary,
        content: item.contentText,
        contentSummary: item.contentSummary,
        contentText: item.contentText,
        metadata: item.metadata,
        relevanceScore: item.relevanceScore,
        credibilityScore: item.credibilityScore,
        sourceType: 'crawler',
        sourcePhase: 'research',
        validationStage: 'fetched_content_validation',
      }));
    } catch {
      return [];
    }
  }

  private rejectedSupplementSource(source: Record<string, unknown>, reason: string): Record<string, unknown> {
    return {
      ...source,
      entityMatch: {
        ...this.plainObject(source.entityMatch || source.entity_match),
        status: 'rejected',
        reason,
      },
    };
  }

  private supplementSourceKey(source: Record<string, unknown>): string {
    const url = this.firstString(source, ['url', 'source_url', 'data_source_url']);
    if (url) return `url:${this.normalizeSourceUrl(url)}`;
    const title = this.firstString(source, ['title', 'ch_title']);
    return title ? `title:${title.toLowerCase().replace(/\s+/g, '')}` : '';
  }

  private async writeWebSupplementArtifacts(
    job: JobRecord,
    context: Record<string, unknown>,
    result: SupplementChannelResult,
  ): Promise<void> {
    const jobDir = this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const researchDir = this.remoteFs.joinPath(jobDir, 'research');
    await this.remoteFs.mkdir(researchDir);
    const acceptedPath = this.remoteFs.joinPath(researchDir, 'web_sources.json');
    const diagnosticsPath = this.remoteFs.joinPath(researchDir, 'web_supplement_diagnostics.json');
    await Promise.all([
      this.remoteFs.writeFile(this.remoteFs.joinPath(jobDir, 'context.json'), `${JSON.stringify(context, null, 2)}\n`),
      this.remoteFs.writeFile(acceptedPath, `${JSON.stringify({
        acceptedWebSources: result.acceptedWebSources,
        acceptedCrawlerSources: result.acceptedCrawlerSources,
      }, null, 2)}\n`),
      this.remoteFs.writeFile(diagnosticsPath, `${JSON.stringify(result, null, 2)}\n`),
    ]);
    job.artifacts = {
      ...job.artifacts,
      webSourcesPath: acceptedPath,
      webSupplementDiagnosticsPath: diagnosticsPath,
    };
    await this.writeJobState(job);
  }

  private guardCrawlerSources(items: unknown[], entityPolicy: EntityPolicy): {
    acceptedSources: Record<string, unknown>[];
    uncertainSources: Record<string, unknown>[];
    rejectedSources: Record<string, unknown>[];
  } {
    const candidates = items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        ...item,
        summary: this.firstString(item, ['contentSummary', 'content_summary', 'summary']),
        content: this.firstString(item, ['contentText', 'content_text', 'content']),
        vectorScore: this.firstNumber(item, ['relevanceScore', 'relevance_score']) || 0,
        validationStage: 'fetched_content_validation',
      }));
    const bodyValidated: Record<string, unknown>[] = [];
    const bodyRejected: Record<string, unknown>[] = [];
    for (const candidate of candidates) {
      const bodyOnly = filterSourcesByEntityPolicy([{ ...candidate, title: '', summary: '', snippet: '' }], entityPolicy);
      if (this.fetchedBodyEntityConsistent(bodyOnly)) bodyValidated.push(candidate);
      else bodyRejected.push(this.rejectedSupplementSource(candidate, '抓取正文未通过核心实体校验或标题与正文不一致。'));
    }
    const filtered = filterSourcesByEntityPolicy(bodyValidated, entityPolicy);
    const acceptedSources: Record<string, unknown>[] = [];
    const uncertainSources: Record<string, unknown>[] = [...filtered.uncertainSources];
    const rejectedSources: Record<string, unknown>[] = [...bodyRejected, ...filtered.rejectedSources];
    for (const source of filtered.acceptedSources) {
      const quality = assessSourceQuality(source);
      const enriched = { ...source, sourceQuality: quality, sourcePriority: 0 };
      enriched.sourcePriority = sourcePriority(enriched);
      if (quality.status === 'accepted') acceptedSources.push(enriched);
      else if (quality.status === 'uncertain') uncertainSources.push(enriched);
      else rejectedSources.push(enriched);
    }
    return { acceptedSources, uncertainSources, rejectedSources };
  }

  private fetchedBodyEntityConsistent(filtered: SourceFilterResult<Record<string, unknown>>): boolean {
    if (filtered.acceptedSources.length) return true;
    return filtered.uncertainSources.some((source) => {
      const match = source.entityMatch;
      return match.matchedCoreEntities.length > 0 && match.matchedConfusions.length === 0;
    });
  }

  private mergeAcceptedSourceChannels(context: Record<string, unknown>, crawlerSources: Record<string, unknown>[]): Record<string, unknown> {
    const database = (Array.isArray(context.vectorDatabaseSources) ? context.vectorDatabaseSources : [])
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({ ...item, sourceChannel: 'database' }));
    const web = (Array.isArray(context.webSources) ? context.webSources : [])
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({ ...item, sourceChannel: 'web' }));
    const existingCrawler = this.normalizeCrawlerSourceContext(context.crawlerSourceContext).items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({ ...item, sourceChannel: 'crawler' }));
    const combined = dedupeSupplementSources([
      ...database,
      ...web,
      ...existingCrawler,
      ...crawlerSources.map((item) => ({ ...item, sourceChannel: 'crawler' })),
    ]);
    return {
      ...context,
      vectorDatabaseSources: combined.filter((item) => item.sourceChannel === 'database').map((item) => this.withoutChannel(item)),
      webSources: combined.filter((item) => item.sourceChannel === 'web').map((item) => this.withoutChannel(item)),
      crawlerSourceContext: {
        ...this.normalizeCrawlerSourceContext(context.crawlerSourceContext),
        items: combined.filter((item) => item.sourceChannel === 'crawler').map((item) => this.withoutChannel(item)),
      },
    };
  }

  private withoutChannel(source: Record<string, unknown>): Record<string, unknown> {
    const { sourceChannel: _sourceChannel, ...rest } = source;
    return rest;
  }

  private async writeCrawlerDiagnosticsArtifact(job: JobRecord, diagnostics: Record<string, unknown>): Promise<void> {
    const jobDir = this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const crawlerDir = this.remoteFs.joinPath(jobDir, 'crawler');
    await this.remoteFs.mkdir(crawlerDir);
    const filePath = this.remoteFs.joinPath(crawlerDir, 'crawler_sources_diagnostics.json');
    await this.remoteFs.writeFile(filePath, `${JSON.stringify(diagnostics, null, 2)}\n`);
    job.artifacts = { ...job.artifacts, crawlerSourceDiagnosticsPath: filePath };
    await this.writeJobState(job);
  }

  private async enrichPayloadWithCrawlerSources(job: JobRecord, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (job.skill !== 'write-hb') return payload;
    const context = this.contextObjectFromPayload(payload);
    const crawlerPlan = this.plainObject(context.crawlerPlan);
    const isPlanningExecuted =
      String(crawlerPlan.executePhase || '') === 'planning' &&
      crawlerPlan.alreadyExecuted === true;
    if (isPlanningExecuted) {
      const selectedContext = await this.enrichPayloadWithPlanningCrawlerSources(job, payload, context, crawlerPlan);
      return selectedContext;
    }
    const enabled = crawlerPlan.enabled === true || String(crawlerPlan.enabled || '').toLowerCase() === 'true';
    if (!enabled) {
      const nextContext = {
        ...context,
        crawlerPlan: {
          ...crawlerPlan,
          enabled: false,
          mode: String(crawlerPlan.mode || 'hybrid'),
          executePhase: 'research',
        },
        crawlerSourceContext: this.normalizeCrawlerSourceContext(context.crawlerSourceContext),
      };
      this.pushEvent(job, {
        type: 'stage',
        stage: 'crawler_skipped',
        message: '资料采集工具：跳过，crawlerPlan.enabled=false',
      });
      await this.writeCrawlerContextArtifact(job, nextContext);
      return { ...payload, known_context: JSON.stringify(nextContext, null, 2) };
    }

    if (!this.crawler) {
      this.pushEvent(job, {
        type: 'stage',
        stage: 'crawler_unavailable',
        message: '资料采集工具：跳过，后端采集模块不可用',
      });
      return payload;
    }

    try {
      this.pushEvent(job, {
        type: 'stage',
        stage: 'crawler_create',
        message: '资料采集工具：已创建采集任务',
      });
      const task = await this.crawler.createTask({
        jobId: job.jobId,
        ownerId: job.ownerUserId || '',
        ownerUsername: job.ownerUsername || '',
        title: String(payload.topic || payload.title || '资料采集任务'),
        goal: String(crawlerPlan.goal || context.topic || payload.topic || ''),
        crawlerPlan,
        maxPages: crawlerPlan.maxPages,
        maxDepth: crawlerPlan.maxDepth,
      });
      this.pushEvent(job, {
        type: 'stage',
        stage: 'crawler_run',
        message: '资料采集工具：执行采集任务',
      });
      const result = await this.crawler.runTask(task.taskId);
      const rawCrawlerSourceContext = this.buildCrawlerSourceContext(result.task, result.items);
      const entityPolicy = parseEntityPolicy(context.entityPolicy);
      const guardedCrawler = entityPolicy
        ? this.guardCrawlerSources(rawCrawlerSourceContext.items, entityPolicy)
        : {
          acceptedSources: rawCrawlerSourceContext.items,
          uncertainSources: [],
          rejectedSources: [],
        };
      const mergedContext = this.mergeAcceptedSourceChannels(context, guardedCrawler.acceptedSources);
      const crawlerSourceContext = {
        ...rawCrawlerSourceContext,
        items: this.normalizeCrawlerSourceContext(mergedContext.crawlerSourceContext).items,
      };
      const previousCrawlerDiagnostics = this.plainObject(this.plainObject(mergedContext.sourceDiagnostics).crawler);
      const nextContext = {
        ...mergedContext,
        crawlerPlan,
        crawlerSourceContext,
        sourceDiagnostics: {
          ...this.plainObject(mergedContext.sourceDiagnostics),
          crawler: {
            ...previousCrawlerDiagnostics,
            acceptedCount: crawlerSourceContext.items.length,
            uncertainCount: Number(previousCrawlerDiagnostics.uncertainCount || 0) + guardedCrawler.uncertainSources.length,
            rejectedCount: Number(previousCrawlerDiagnostics.rejectedCount || 0) + guardedCrawler.rejectedSources.length,
          },
        },
      };
      job.artifacts = {
        ...job.artifacts,
        crawlerSourceContext,
        crawlerTaskIds: crawlerSourceContext.tasks.map((item) => item.taskId),
        crawlerItemCount: crawlerSourceContext.items.length,
      };
      await this.writeCrawlerContextArtifact(job, nextContext);
      if (entityPolicy) {
        await this.writeCrawlerDiagnosticsArtifact(job, {
          entityPolicy,
          acceptedCrawlerSources: guardedCrawler.acceptedSources,
          uncertainCrawlerSources: guardedCrawler.uncertainSources,
          rejectedCrawlerSources: guardedCrawler.rejectedSources,
        });
      }
      this.pushEvent(job, {
        type: 'stage',
        stage: 'crawler_completed',
        message: entityPolicy
          ? `资料采集工具：抓取 ${result.items.length} 条，最终 accepted ${guardedCrawler.acceptedSources.length} 条，过滤 ${guardedCrawler.uncertainSources.length + guardedCrawler.rejectedSources.length} 条。`
          : `资料采集工具：采集完成，获得 ${crawlerSourceContext.items.length} 条来源`,
      });
      this.pushEvent(job, {
        type: 'sources',
        sources: crawlerSourceContext.items.map((item) => ({
          ...this.plainObject(item),
          sourceGroup: 'crawler',
          sourceOrigin: 'crawler',
          sourceType: '资料采集',
        })),
      });
      return { ...payload, known_context: JSON.stringify(nextContext, null, 2) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushEvent(job, {
        type: 'stage',
        stage: 'crawler_warning',
        message: `资料采集工具：采集未完成，继续编报。${this.sanitizeUserVisibleText(message, 200)}`,
      });
      const nextContext = {
        ...context,
        crawlerPlan,
        crawlerSourceContext: this.normalizeCrawlerSourceContext(context.crawlerSourceContext),
      };
      await this.writeCrawlerContextArtifact(job, nextContext);
      return { ...payload, known_context: JSON.stringify(nextContext, null, 2) };
    }
  }

  private async enrichPayloadWithPlanningCrawlerSources(
    job: JobRecord,
    payload: Record<string, unknown>,
    context: Record<string, unknown>,
    crawlerPlan: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const selectedIds = this.stringArray(context.selectedCrawlerItemIds, 80);
    const selectedItems = await this.readSelectedCrawlerItemsForJob(job, selectedIds);
    const fallbackContext = this.normalizeCrawlerSourceContext(context.crawlerSourceContext);
    const fallbackItems = Array.isArray(fallbackContext.items)
      ? fallbackContext.items.filter((item) => {
        if (!selectedIds.length) return false;
        const id = this.firstString(this.plainObject(item), ['itemId', 'item_id']);
        return selectedIds.includes(id);
      })
      : [];
    const items = selectedItems.length ? selectedItems : fallbackItems.map((item, index) => ({
      ...this.plainObject(item),
      itemId: this.firstString(this.plainObject(item), ['itemId', 'item_id']) || `planning-selected-${index + 1}`,
      sourceType: 'crawler',
      sourcePhase: 'planning',
    }));
    const entityPolicy = parseEntityPolicy(context.entityPolicy);
    const guarded = entityPolicy
      ? this.guardCrawlerSources(items, entityPolicy)
      : { acceptedSources: items, uncertainSources: [], rejectedSources: [] };
    const taskIds = this.stringArray(context.crawlerTaskIds, 20);
    const crawlerSourceContext = {
      source: 'planning_selected_sources',
      tasks: this.buildPlanningCrawlerTaskSummaries(fallbackContext.tasks, taskIds, guarded.acceptedSources.length),
      items: guarded.acceptedSources.map((item) => ({
        ...item,
        sourceType: 'crawler',
        sourcePhase: 'planning',
      })),
    };
    const previousCrawlerDiagnostics = this.plainObject(this.plainObject(context.sourceDiagnostics).crawler);
    const nextContext = {
      ...context,
      crawlerPlan: {
        ...crawlerPlan,
        enabled: crawlerPlan.enabled !== false,
        executePhase: 'planning',
        alreadyExecuted: true,
        allowFurtherCollectionInResearch: crawlerPlan.allowFurtherCollectionInResearch === true,
      },
      selectedCrawlerItemIds: selectedIds,
      crawlerTaskIds: taskIds,
      crawlerSourceContext,
      sourceDiagnostics: {
        ...this.plainObject(context.sourceDiagnostics),
        crawler: {
          ...previousCrawlerDiagnostics,
          acceptedCount: crawlerSourceContext.items.length,
          uncertainCount: Number(previousCrawlerDiagnostics.uncertainCount || 0) + guarded.uncertainSources.length,
          rejectedCount: Number(previousCrawlerDiagnostics.rejectedCount || 0) + guarded.rejectedSources.length,
        },
      },
    };
    job.artifacts = {
      ...job.artifacts,
      crawlerSourceContext,
      crawlerTaskIds: taskIds,
      crawlerItemCount: crawlerSourceContext.items.length,
    };
    await this.writeCrawlerContextArtifact(job, nextContext);
    if (entityPolicy) {
      await this.writeCrawlerDiagnosticsArtifact(job, {
        entityPolicy,
        acceptedCrawlerSources: guarded.acceptedSources,
        uncertainCrawlerSources: guarded.uncertainSources,
        rejectedCrawlerSources: guarded.rejectedSources,
      });
    }
    this.pushEvent(job, {
      type: 'stage',
      stage: 'crawler_planning_selected',
      message: `资料采集工具：使用规划页面已选择的 ${crawlerSourceContext.items.length} 条采集信源。`,
    });
    this.pushEvent(job, {
      type: 'sources',
      sources: crawlerSourceContext.items.map((item) => ({
        ...item,
        sourceGroup: 'crawler',
        sourceOrigin: 'crawler',
        sourceType: '资料采集',
        sourcePhase: 'planning',
        method: '规划页面已选',
      })),
    });
    return { ...payload, known_context: JSON.stringify(nextContext, null, 2) };
  }

  private async readSelectedCrawlerItemsForJob(job: JobRecord, selectedIds: string[]): Promise<Array<Record<string, unknown>>> {
    if (!selectedIds.length) return [];
    const pool = await this.getPool();
    const isAdminOwner = job.ownerRole === 'admin';
    const result = isAdminOwner
      ? await pool.query(
        `SELECT * FROM crawler_items WHERE item_id::text = ANY($1::text[]) ORDER BY created_at ASC`,
        [selectedIds],
      )
      : await pool.query(
        `SELECT * FROM crawler_items WHERE item_id::text = ANY($1::text[]) AND owner_id = $2 ORDER BY created_at ASC`,
        [selectedIds, job.ownerUserId || ''],
      );
    return result.rows.map((row) => this.crawlerItemRowToContextItem(row));
  }

  private crawlerItemRowToContextItem(row: Record<string, unknown>): Record<string, unknown> {
    return {
      itemId: String(row.item_id || ''),
      taskId: String(row.task_id || ''),
      title: String(row.title || ''),
      url: String(row.url || ''),
      publisher: String(row.publisher || ''),
      publishedAt: row.published_at ? this.isoString(row.published_at) : null,
      fetchedAt: this.isoString(row.fetched_at),
      contentSummary: String(row.content_summary || ''),
      contentText: String(row.content_text || ''),
      sourceType: 'crawler',
      sourcePhase: 'planning',
      relevanceScore: this.firstNumber(row, ['relevance_score']) ?? null,
      credibilityScore: this.firstNumber(row, ['credibility_score']) ?? null,
    };
  }

  private buildPlanningCrawlerTaskSummaries(tasks: unknown[], taskIds: string[], selectedCount: number): unknown[] {
    const existing = Array.isArray(tasks) ? tasks : [];
    if (existing.length) {
      return existing.map((task) => ({
        ...this.plainObject(task),
        selectedCount,
      }));
    }
    return taskIds.map((taskId) => ({
      taskId,
      status: 'completed',
      itemCount: selectedCount,
      selectedCount,
    }));
  }

  private buildCrawlerSourceContext(task: CrawlerTaskResponse, items: CrawlerItemResponse[]) {
    return {
      tasks: [{
        taskId: task.taskId,
        status: task.status,
        goal: task.goal,
        itemCount: items.length,
      }],
      items: items.map((item) => ({
        itemId: item.itemId,
        title: item.title,
        url: item.url,
        publisher: item.publisher,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt,
        contentSummary: item.contentSummary,
        contentText: item.contentText,
        sourceType: 'crawler',
        relevanceScore: item.relevanceScore,
        credibilityScore: item.credibilityScore,
      })),
    };
  }

  private normalizeCrawlerSourceContext(value: unknown): { tasks: unknown[]; items: unknown[] } {
    const context = this.plainObject(value);
    return {
      tasks: Array.isArray(context.tasks) ? context.tasks : [],
      items: Array.isArray(context.items) ? context.items : [],
    };
  }

  private async writeCrawlerContextArtifact(job: JobRecord, context: Record<string, unknown>): Promise<void> {
    const jobDir = this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const crawlerDir = this.remoteFs.joinPath(jobDir, 'crawler');
    const crawlerSourceContext = this.normalizeCrawlerSourceContext(context.crawlerSourceContext);
    await this.remoteFs.mkdir(crawlerDir);
    await Promise.all([
      this.remoteFs.writeFile(this.remoteFs.joinPath(jobDir, 'context.json'), `${JSON.stringify(context, null, 2)}\n`),
      this.remoteFs.writeFile(this.remoteFs.joinPath(crawlerDir, 'crawler_sources.json'), `${JSON.stringify(crawlerSourceContext, null, 2)}\n`),
    ]);
    job.artifacts = {
      ...job.artifacts,
      hermesJobDir: jobDir,
      crawlerSourcesPath: this.remoteFs.joinPath(crawlerDir, 'crawler_sources.json'),
    };
    await this.writeJobState(job);
  }

  private async enrichPayloadWithDraftAssistantContext(
    job: JobRecord,
    payload: Record<string, unknown>,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const planId = this.optionalId(job.planId) || this.optionalId(payload.planId);
    if (!planId) return payload;
    const bundle = await this.loadDraftAssistantPlanBundle(planId, user);
    await this.writeDraftAssistantArtifacts(job, bundle, payload);
    const context = this.contextObjectFromPayload(payload);
    const instructions = [
      '本次深度编报必须严格依据 Draft Assistant 生成的 report_plan。',
      '用户已经确认该提纲版本，正文规划不得脱离该提纲。',
      '主要内容部分必须根据 main_content sectionGoal 展开。',
      '各方态度部分必须使用 attitudeSources，并写明表态主体、发表时间、媒体和来源。',
      '涉我风险部分必须使用 riskPoints，并说明事实依据和不确定性。',
      '缺少来源的信息必须标注待核实。',
      '不得仅根据标题推断事实。',
      '不得重新自由发挥生成与提纲无关的大段内容。',
    ];
    const enriched = {
      ...payload,
      eventId: bundle.eventId,
      outlineId: bundle.outlineId,
      planId: bundle.planId,
      draftAssistantMode: true,
      known_context: JSON.stringify({
        ...context,
        draftAssistantContext: {
          eventId: bundle.eventId,
          outlineId: bundle.outlineId,
          planId: bundle.planId,
          event: bundle.event,
          sources: bundle.sources,
          attitudes: bundle.attitudes,
          reportPlan: bundle.reportPlan,
        },
        draftAssistantInstructions: instructions,
      }, null, 2),
    };
    job.eventId = bundle.eventId;
    job.outlineId = bundle.outlineId;
    job.planId = bundle.planId;
    job.artifacts = {
      ...job.artifacts,
      draftAssistantPlanId: bundle.planId,
      draftAssistantOutlineId: bundle.outlineId,
      draftAssistantEventId: bundle.eventId,
    };
    await this.writeJobState(job);
    this.pushEvent(job, {
      type: 'stage',
      stage: 'draft_assistant_context',
      message: 'Draft Assistant report_plan and source context prepared for deep report generation.',
    });
    return enriched;
  }

  private async writeDraftAssistantArtifacts(
    job: JobRecord,
    bundle: DraftAssistantPlanBundle,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const jobDir = this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const databaseDir = this.remoteFs.joinPath(jobDir, 'database');
    await this.remoteFs.mkdir(databaseDir);
    const contextPath = this.remoteFs.joinPath(jobDir, 'context.json');
    const existingContext = await this.readJsonFile(contextPath);
    const baseContext = existingContext && !Array.isArray(existingContext)
      ? existingContext
      : this.contextObjectFromPayload(payload);
    const draftAssistantContext = {
      eventId: bundle.eventId,
      outlineId: bundle.outlineId,
      planId: bundle.planId,
      event: bundle.event,
      sources: bundle.sources,
      attitudes: bundle.attitudes,
      reportPlan: bundle.reportPlan,
    };

    await Promise.all([
      this.remoteFs.writeFile(
        contextPath,
        `${JSON.stringify({ ...baseContext, draftAssistantContext }, null, 2)}\n`,
      ),
      this.remoteFs.writeFile(
        this.remoteFs.joinPath(databaseDir, 'draft_event.json'),
        `${JSON.stringify(bundle.event, null, 2)}\n`,
      ),
      this.remoteFs.writeFile(
        this.remoteFs.joinPath(databaseDir, 'draft_sources.json'),
        `${JSON.stringify(bundle.sources, null, 2)}\n`,
      ),
      this.remoteFs.writeFile(
        this.remoteFs.joinPath(databaseDir, 'draft_attitudes.json'),
        `${JSON.stringify(bundle.attitudes, null, 2)}\n`,
      ),
      this.remoteFs.writeFile(
        this.remoteFs.joinPath(databaseDir, 'report_plan.json'),
        `${JSON.stringify(bundle.reportPlan, null, 2)}\n`,
      ),
    ]);

    job.artifacts = {
      ...job.artifacts,
      hermesJobDir: jobDir,
      draftAssistantContextPath: contextPath,
      draftAssistantReportPlanPath: this.remoteFs.joinPath(databaseDir, 'report_plan.json'),
    };
    await this.writeJobState(job);
  }

  private contextObjectFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const knownContext = typeof payload.known_context === 'string' ? payload.known_context : '';
    const parsed = this.parseJsonObject(knownContext);
    if (parsed) return parsed;
    return {
      topic: String(payload.topic || payload.title || ''),
      reportType: String(payload.report_type || ''),
      freeTextContext: knownContext,
    };
  }

  private async enhancePayloadWithUserPreferences(payload: Record<string, unknown>, user: AuthUser): Promise<Record<string, unknown>> {
    if (payload.useMyPreferences !== true || !this.userPreferences) return payload;
    const templateId = this.optionalId(payload.templateId);
    const userPreferenceContext = await this.userPreferences.buildUserPreferenceContext(user, templateId || undefined);
    const nextContext = {
      ...this.contextObjectFromPayload(payload),
      userPreferenceContext,
    };
    return {
      ...payload,
      known_context: JSON.stringify(nextContext),
    };
  }

  private normalizeReportEditInput(input: ReportEditInput): {
    targetType: ReportEditTargetType;
    targetPath: string | null;
    originalText: string;
    instruction: string;
    editMode: ReportEditMode;
  } {
    const targetTypes = new Set<ReportEditTargetType>(['paragraph', 'section', 'selected_text', 'full_section']);
    const editModes = new Set<ReportEditMode>(['rewrite', 'expand', 'shorten', 'polish', 'add_sources', 'strengthen_risk', 'clarify_facts', 'custom']);
    const targetType = String(input?.targetType || 'selected_text').trim() as ReportEditTargetType;
    if (!targetTypes.has(targetType)) throw new BadRequestException({ error: 'targetType is invalid' });
    const originalText = String(input?.originalText || '').trim();
    if (!originalText) throw new BadRequestException({ error: 'originalText is required' });
    const instruction = String(input?.instruction || '').trim();
    if (!instruction) throw new BadRequestException({ error: 'instruction is required' });
    const editMode = String(input?.editMode || 'rewrite').trim() as ReportEditMode;
    if (!editModes.has(editMode)) throw new BadRequestException({ error: 'editMode is invalid' });
    const targetPath = String(input?.targetPath || '').trim();
    return {
      targetType,
      targetPath: targetPath || null,
      originalText: originalText.slice(0, 20000),
      instruction: instruction.slice(0, 4000),
      editMode,
    };
  }

  private async generateReportEditText(
    job: JobRecord,
    input: ReturnType<ReportsService['normalizeReportEditInput']>,
  ): Promise<{ editedText: string; modelUsed: string }> {
    if (!REPORT_AGENT_API_KEY) throw new Error('REPORT_AGENT_API_KEY is not configured');
    const client = new OpenAI({ apiKey: REPORT_AGENT_API_KEY, baseURL: REPORT_AGENT_BASE_URL });
    const response = await client.chat.completions.create({
      model: REPORT_AGENT_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            '你是深度编报报告的局部段落修改助手。',
            '只输出修改后的段落或小节文本，不要输出解释、标题“以下是修改后”或 Markdown 包装。',
            '不得编造来源；如果用户要求补充来源但上下文没有可核实来源，必须写“暂无可核实来源”或保持谨慎表述。',
            '各方态度类修改必须尽量保留表态主体、时间、媒体、来源。',
            '涉我风险类修改必须避免空泛判断，明确事实依据和不确定性。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify(this.buildReportEditPromptPayload(job, input)),
        },
      ],
    });
    const editedText = String(response.choices?.[0]?.message?.content || '').trim();
    return { editedText, modelUsed: REPORT_AGENT_MODEL };
  }

  private buildReportEditPromptPayload(
    job: JobRecord,
    input: ReturnType<ReportsService['normalizeReportEditInput']>,
  ): Record<string, unknown> {
    const payload = this.plainObject(job.payload);
    const context = this.contextObjectFromPayload(payload);
    const title = String(payload.topic || payload.title || payload.target_country || job.jobId || '');
    return {
      task: 'revise_report_segment',
      outputRules: [
        '只输出修改后的文本。',
        '不输出解释。',
        '不输出“以下是修改后”。',
        '不编造来源。',
        '没有可核实来源时保持谨慎并标注暂无可核实来源。',
      ],
      target: {
        targetType: input.targetType,
        targetPath: input.targetPath,
        editMode: input.editMode,
      },
      originalText: input.originalText,
      instruction: input.instruction,
      report: {
        jobId: job.jobId,
        title,
        reportType: payload.report_type || payload.reportType || '',
        status: job.status,
      },
      contextSummary: this.safeJsonSlice(context, 12000),
      draftAssistantContext: this.safeJsonSlice(this.plainObject(context.draftAssistantContext), 8000),
      userPreferenceContext: this.safeJsonSlice(this.plainObject(context.userPreferenceContext), 8000),
      reportPlan: this.safeJsonSlice(this.plainObject(context.report_plan), 8000),
      availableSources: this.extractSourceSummaryFromContext(context),
    };
  }

  private extractSourceSummaryFromContext(context: Record<string, unknown>): unknown[] {
    const candidates = [
      context.database_sources,
      context.vector_sources,
      context.vectorDatabaseSources,
      this.plainObject(context.draftAssistantContext).sources,
    ];
    for (const value of candidates) {
      if (Array.isArray(value) && value.length) {
        return value.slice(0, 20).map((item) => {
          const row = this.plainObject(item);
          return {
            title: row.title || row.ch_title || row.sourceTitle || '',
            url: row.url || row.data_source_url || row.sourceUrl || '',
            sourceName: row.websiteName || row.website_name || row.publisher || row.media || '',
            publishTime: row.publishTime || row.publish_time || row.publishedAt || '',
            summary: String(row.summary || row.sourceSummary || row.contentExcerpt || row.content_text || '').slice(0, 800),
          };
        });
      }
    }
    return [];
  }

  private safeJsonSlice(value: unknown, maxLength: number): unknown {
    const text = JSON.stringify(value || {});
    if (text.length <= maxLength) return value;
    return { truncated: true, excerpt: text.slice(0, maxLength) };
  }

  private toReportEdit(row: Record<string, unknown>): ReportEditResponse {
    return {
      editId: String(row.edit_id || ''),
      jobId: String(row.job_id || ''),
      ownerId: String(row.owner_id || ''),
      targetType: String(row.target_type || ''),
      targetPath: row.target_path ? String(row.target_path) : null,
      originalText: String(row.original_text || ''),
      instruction: String(row.instruction || ''),
      editedText: String(row.edited_text || ''),
      editMode: String(row.edit_mode || ''),
      modelUsed: row.model_used ? String(row.model_used) : null,
      status: String(row.status || ''),
      createdAt: this.isoString(row.created_at),
    };
  }

  private async readLatestQualityReviewFromDb(jobId: string): Promise<ReportQualityReviewResponse | null> {
    try {
      const result = await (await this.getPool()).query(
        `SELECT review_id, job_id, owner_id, status, overall_score, factual_clarity_score,
                plan_alignment_score, source_quality_score, attitude_traceability_score,
                risk_reasoning_score, writing_quality_score, word_count, review_json,
                error_message, created_at
           FROM report_quality_reviews
          WHERE job_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [jobId],
      );
      return result.rows[0] ? this.toQualityReview(result.rows[0]) : null;
    } catch {
      return null;
    }
  }

  private async readQualityReviewArtifact(job: JobRecord): Promise<Record<string, unknown> | null> {
    const dir = await this.resolveHermesJobDir(job) || this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const raw = await this.readJsonFile(this.remoteFs.joinPath(dir, 'quality', 'quality_review.json'));
    return raw && !Array.isArray(raw) ? raw : null;
  }

  private async readFinalMarkdownForQualityReview(job: JobRecord): Promise<string> {
    if (job.markdown && job.markdown.trim()) return job.markdown;
    if (job.resultPath) {
      try {
        const markdown = await this.remoteFs.readFile(job.resultPath);
        if (markdown.trim()) return markdown;
      } catch {
        // Continue to the conventional final report path.
      }
    }
    const dir = await this.resolveHermesJobDir(job) || this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    return this.remoteFs.readFile(this.remoteFs.joinPath(dir, 'final', 'report.md'));
  }

  private async collectQualityReviewContext(job: JobRecord): Promise<Record<string, unknown>> {
    const payloadContext = this.contextObjectFromPayload(this.plainObject(job.payload));
    const dir = await this.resolveHermesJobDir(job) || this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const contextJson = await this.readJsonFile(this.remoteFs.joinPath(dir, 'context.json'));
    const databaseSources = await this.readJsonFile(this.remoteFs.joinPath(dir, 'database', 'database_sources.json'));
    const vectorSources = await this.readJsonFile(this.remoteFs.joinPath(dir, 'database', 'vector_sources.json'));
    const crawlerSources = await this.readJsonFile(this.remoteFs.joinPath(dir, 'crawler', 'crawler_sources.json'));
    return {
      ...payloadContext,
      ...(contextJson && !Array.isArray(contextJson) ? contextJson : {}),
      database_sources: Array.isArray(databaseSources) ? databaseSources : payloadContext.database_sources,
      vector_sources: Array.isArray(vectorSources) ? vectorSources : payloadContext.vector_sources,
      crawlerSourceContext: crawlerSources && !Array.isArray(crawlerSources)
        ? crawlerSources
        : payloadContext.crawlerSourceContext,
    };
  }

  private buildQualityReviewJson(job: JobRecord, markdown: string, context: Record<string, unknown>): Record<string, unknown> {
    const wordCount = this.countChineseReportCharacters(markdown);
    const sourceUsage = this.estimateQualitySourceUsage(markdown, context);
    const checks = this.buildQualityChecks(job, markdown, context, wordCount, sourceUsage);
    const issues = this.buildQualityIssues(markdown, checks, wordCount, sourceUsage);
    const scores = this.buildQualityScores(checks, wordCount, sourceUsage);
    const overallScore = this.clampScore(Math.round(
      scores.factualClarity * 0.18 +
      scores.planAlignment * 0.18 +
      scores.sourceQuality * 0.18 +
      scores.attitudeTraceability * 0.14 +
      scores.riskReasoning * 0.16 +
      scores.writingQuality * 0.16,
    ));
    return {
      overallScore,
      summary: overallScore >= 80
        ? '报告整体围绕主题展开，结构和信源使用较完整，仍建议复核各方态度、涉我风险和来源标注。'
        : '报告已生成，但在主题贴合、信源引用或风险依据方面存在需要人工复核的问题。',
      wordCount,
      scores,
      checks,
      issues,
      recommendedEdits: issues.slice(0, 5).map((issue) => ({
        section: this.firstString(this.plainObject(issue), ['section']) || '报告正文',
        editMode: /来源|态度|媒体|时间/.test(String((issue as Record<string, unknown>).suggestion || '')) ? 'add_sources' : 'polish',
        instruction: String((issue as Record<string, unknown>).suggestion || '请根据自检意见补充事实依据并压实表述。'),
      })),
      sourceUsage,
    };
  }

  private buildFailedQualityReviewJson(message: string): Record<string, unknown> {
    return {
      overallScore: null,
      summary: '成稿自检失败，可稍后重试。',
      wordCount: 0,
      scores: {
        factualClarity: null,
        planAlignment: null,
        sourceQuality: null,
        attitudeTraceability: null,
        riskReasoning: null,
        writingQuality: null,
      },
      checks: [],
      issues: [],
      recommendedEdits: [],
      sourceUsage: { databaseSourcesUsed: 0, crawlerSourcesUsed: 0, internetSourcesUsed: 0, unverifiedClaims: 0 },
      error: this.sanitizeUserVisibleText(message, 300),
    };
  }

  private buildQualityChecks(
    job: JobRecord,
    markdown: string,
    context: Record<string, unknown>,
    wordCount: number,
    sourceUsage: Record<string, number>,
  ): Array<Record<string, unknown>> {
    const payload = this.plainObject(job.payload);
    const topic = String(payload.topic || payload.title || payload.target_country || context.topic || '').trim();
    const lower = markdown.toLowerCase();
    const hasTopic = !topic || markdown.includes(topic) || topic.split(/\s+/).some((part) => part && markdown.includes(part));
    const hasMainContent = /基本情况|主要内容|事件概述|背景/.test(markdown) && /发生|推动|宣布|涉及|影响|进展/.test(markdown);
    const hasAttitudeTrace = /各方态度|立场|表态|回应|认为|表示/.test(markdown) && /年|月|日|媒体|公告|声明|报道|发布/.test(markdown);
    const hasRiskBasis = /涉我风险|风险/.test(markdown) && /基于|依据|显示|来源|监管|数据|报道|文件|逻辑/.test(markdown);
    const hasSourceClarity = (sourceUsage.databaseSourcesUsed + sourceUsage.crawlerSourcesUsed + sourceUsage.internetSourcesUsed) > 0 || /\[\d+\]|参考资料|来源/.test(markdown);
    const plan = this.plainObject(context.report_plan);
    const planText = JSON.stringify(plan || {});
    const hasPlan = !planText || planText === '{}' || ['基本情况', '涉我风险', '对策建议', '事件概述'].some((section) => markdown.includes(section));
    const aiTrace = /作为ai|以下是|样式说明|本文将|下面是|我将为您/i.test(markdown);
    return [
      this.qualityCheck('topic_alignment', '主题一致性', hasTopic, hasTopic ? '报告主题与用户标题基本一致。' : '报告未明显围绕用户标题展开。'),
      this.qualityCheck('main_content_clarity', '事件描述清楚度', hasMainContent, hasMainContent ? '主要内容基本交代事件背景、经过或影响。' : '主要内容对事件要素交代不足。'),
      this.qualityCheck('attitude_traceability', '各方态度可追溯性', hasAttitudeTrace, hasAttitudeTrace ? '各方态度包含一定主体、时间或来源线索。' : '各方态度缺少主体、时间、媒体或来源。'),
      this.qualityCheck('risk_reasoning_basis', '涉我风险依据', hasRiskBasis, hasRiskBasis ? '涉我风险包含一定事实或逻辑依据。' : '涉我风险判断可能偏空泛。'),
      this.qualityCheck('source_reference_clarity', '信源引用清晰度', hasSourceClarity, hasSourceClarity ? '报告包含来源或参考资料线索。' : '报告未清楚呈现信源引用。'),
      this.qualityCheck('plan_coverage', '编报规划体现度', hasPlan, hasPlan ? '报告结构基本体现编报规划。' : '用户确认的规划重点未充分体现。'),
      this.qualityCheck('ai_boilerplate', '无用 AI 痕迹', !aiTrace, aiTrace ? '报告存在“以下是”等无用 AI 描述。' : '未发现明显无用 AI 描述。'),
      this.qualityCheck('word_count', '字数充足度', wordCount >= 2500, wordCount >= 2500 ? '成稿字数达到基础检查阈值。' : '成稿字数明显偏少，建议扩充事实和分析密度。'),
    ];
  }

  private qualityCheck(key: string, label: string, passed: boolean, comment: string): Record<string, unknown> {
    return { key, label, status: passed ? 'pass' : 'warning', comment };
  }

  private buildQualityIssues(
    markdown: string,
    checks: Array<Record<string, unknown>>,
    wordCount: number,
    sourceUsage: Record<string, number>,
  ): Array<Record<string, unknown>> {
    const issues = checks
      .filter((check) => check.status !== 'pass')
      .map((check) => ({
        severity: check.key === 'ai_boilerplate' ? 'warning' : 'warning',
        section: this.issueSectionForCheck(String(check.key)),
        problem: String(check.comment || ''),
        evidence: this.findIssueEvidence(markdown, String(check.key)),
        suggestion: this.issueSuggestionForCheck(String(check.key)),
        targetText: this.findIssueEvidence(markdown, String(check.key)),
      }));
    if ((sourceUsage.unverifiedClaims || 0) > 0) {
      issues.push({
        severity: 'warning',
        section: '信源引用',
        problem: '报告中可能存在未充分标注依据的判断。',
        evidence: '检测到“可能、预计、或将”等判断性表述。',
        suggestion: '请补充对应信源、事实依据或明确不确定性。',
        targetText: '可能/预计/或将相关判断。',
      });
    }
    if (wordCount < 2500 && !issues.some((item) => item.section === '字数')) {
      issues.push({
        severity: 'warning',
        section: '字数',
        problem: '成稿字数明显偏少。',
        evidence: `当前估算字数 ${wordCount}。`,
        suggestion: '请补充事件经过、各方态度、事实依据、风险链条和对策可操作性。',
        targetText: '',
      });
    }
    return issues.slice(0, 12);
  }

  private buildQualityScores(checks: Array<Record<string, unknown>>, wordCount: number, sourceUsage: Record<string, number>) {
    const passed = (key: string) => checks.find((item) => item.key === key)?.status === 'pass';
    return {
      factualClarity: this.clampScore((passed('main_content_clarity') ? 82 : 62) + (wordCount > 4000 ? 8 : 0)),
      planAlignment: this.clampScore(passed('topic_alignment') && passed('plan_coverage') ? 84 : 65),
      sourceQuality: this.clampScore((passed('source_reference_clarity') ? 78 : 58) + Math.min(12, (sourceUsage.databaseSourcesUsed + sourceUsage.crawlerSourcesUsed + sourceUsage.internetSourcesUsed) * 2)),
      attitudeTraceability: this.clampScore(passed('attitude_traceability') ? 78 : 60),
      riskReasoning: this.clampScore(passed('risk_reasoning_basis') ? 80 : 62),
      writingQuality: this.clampScore((passed('ai_boilerplate') ? 84 : 62) + (wordCount >= 2500 ? 4 : -8)),
    };
  }

  private issueSectionForCheck(key: string): string {
    const map: Record<string, string> = {
      topic_alignment: '主题',
      main_content_clarity: '主要内容',
      attitude_traceability: '各方态度',
      risk_reasoning_basis: '涉我风险',
      source_reference_clarity: '信源引用',
      plan_coverage: '规划体现',
      ai_boilerplate: '正文表述',
      word_count: '字数',
    };
    return map[key] || '报告正文';
  }

  private issueSuggestionForCheck(key: string): string {
    const map: Record<string, string> = {
      topic_alignment: '请回到用户标题和编报规划，删减跑题内容并补充直接相关事实。',
      main_content_clarity: '请补充事件是什么、主体、时间、地点、进展和影响。',
      attitude_traceability: '请补充表态主体、表态时间、媒体或发布渠道和来源链接。',
      risk_reasoning_basis: '请用已有信源补充风险判断的事实依据、传导路径和不确定性。',
      source_reference_clarity: '请区分数据库信源、资料采集信源和互联网搜索信源，并补充参考资料编号。',
      plan_coverage: '请对照 report_plan 补齐未体现的章节重点。',
      ai_boilerplate: '请删除“以下是”“作为AI”等无用描述，改为正式编报表述。',
      word_count: '请扩充事实密度、分析层次、风险链条和对策建议。',
    };
    return map[key] || '请根据成稿自检意见进行局部修改。';
  }

  private findIssueEvidence(markdown: string, key: string): string {
    if (key === 'ai_boilerplate') {
      const match = markdown.match(/.{0,20}(作为AI|以下是|样式说明|本文将|下面是|我将为您).{0,40}/i);
      if (match) return match[0];
    }
    const lines = markdown.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    return (lines.find((line) => line.length > 20 && !line.startsWith('#')) || lines[0] || '').slice(0, 220);
  }

  private estimateQualitySourceUsage(markdown: string, context: Record<string, unknown>): Record<string, number> {
    const databaseSources = [
      ...(Array.isArray(context.database_sources) ? context.database_sources : []),
      ...(Array.isArray(context.vector_sources) ? context.vector_sources : []),
      ...(Array.isArray(context.vectorDatabaseSources) ? context.vectorDatabaseSources : []),
    ];
    const crawlerContext = this.plainObject(context.crawlerSourceContext);
    const crawlerSources = Array.isArray(crawlerContext.items) ? crawlerContext.items : [];
    const draftContext = this.plainObject(context.draftAssistantContext);
    const draftSources = Array.isArray(draftContext.sources) ? draftContext.sources : [];
    const referenceCount = (markdown.match(/\[\d+\]/g) || []).length;
    const judgementCount = (markdown.match(/可能|预计|或将|风险|影响|认为/g) || []).length;
    return {
      databaseSourcesUsed: Math.min(databaseSources.length, referenceCount || databaseSources.length),
      crawlerSourcesUsed: Math.min(crawlerSources.length, referenceCount || crawlerSources.length),
      internetSourcesUsed: Math.max(0, referenceCount - databaseSources.length - crawlerSources.length),
      draftAssistantSourcesUsed: draftSources.length,
      userProvidedSourcesUsed: Array.isArray(context.userProvidedSources) ? context.userProvidedSources.length : 0,
      unverifiedClaims: Math.max(0, judgementCount - referenceCount - databaseSources.length - crawlerSources.length),
    };
  }

  private countChineseReportCharacters(markdown: string): number {
    return markdown.replace(/```[\s\S]*?```/g, '').replace(/[#*_>`\-\s\[\]\(\)0-9a-zA-Z.,;:!?，。；：！？、（）]/g, '').length;
  }

  private clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private async saveQualityReview(
    job: JobRecord,
    reviewJson: Record<string, unknown>,
    status: string,
    errorMessage: string | null,
  ): Promise<ReportQualityReviewResponse> {
    const scores = this.plainObject(reviewJson.scores);
    const result = await (await this.getPool()).query(
      `INSERT INTO report_quality_reviews (
         job_id, owner_id, status, overall_score, factual_clarity_score,
         plan_alignment_score, source_quality_score, attitude_traceability_score,
         risk_reasoning_score, writing_quality_score, review_json, error_message, word_count
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
       RETURNING review_id, job_id, owner_id, status, overall_score, factual_clarity_score,
                 plan_alignment_score, source_quality_score, attitude_traceability_score,
                 risk_reasoning_score, writing_quality_score, word_count, review_json,
                 error_message, created_at`,
      [
        job.jobId,
        job.ownerUserId || null,
        status,
        this.optionalScore(reviewJson.overallScore),
        this.optionalScore(scores.factualClarity),
        this.optionalScore(scores.planAlignment),
        this.optionalScore(scores.sourceQuality),
        this.optionalScore(scores.attitudeTraceability),
        this.optionalScore(scores.riskReasoning),
        this.optionalScore(scores.writingQuality),
        JSON.stringify(reviewJson),
        errorMessage,
        this.firstNumber(reviewJson, ['wordCount']) || 0,
      ],
    );
    const review = this.toQualityReview(result.rows[0]);
    job.artifacts = { ...job.artifacts, qualityReview: review.reviewJson, qualityReviewId: review.reviewId };
    await this.writeJobState(job);
    return review;
  }

  private optionalScore(value: unknown): number | null {
    const score = Number(value);
    return Number.isFinite(score) ? this.clampScore(score) : null;
  }

  private async writeQualityReviewArtifact(job: JobRecord, reviewJson: Record<string, unknown>): Promise<void> {
    const jobDir = await this.resolveHermesJobDir(job) || this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const qualityDir = this.remoteFs.joinPath(jobDir, 'quality');
    await this.remoteFs.mkdir(qualityDir);
    const path = this.remoteFs.joinPath(qualityDir, 'quality_review.json');
    await this.remoteFs.writeFile(path, `${JSON.stringify(reviewJson, null, 2)}\n`);
    job.artifacts = { ...job.artifacts, qualityReviewPath: path };
    await this.writeJobState(job);
  }

  private toQualityReview(row: Record<string, unknown>, job?: JobRecord): ReportQualityReviewResponse {
    const reviewJson = typeof row.review_json === 'string'
      ? this.parseJsonObject(row.review_json) || {}
      : this.plainObject(row.review_json || row);
    const scores = this.plainObject(reviewJson.scores);
    return {
      reviewId: String(row.review_id || reviewJson.reviewId || ''),
      jobId: String(row.job_id || job?.jobId || ''),
      ownerId: row.owner_id ? String(row.owner_id) : (job?.ownerUserId || null),
      status: String(row.status || reviewJson.status || 'completed'),
      overallScore: this.optionalScore(row.overall_score ?? reviewJson.overallScore),
      wordCount: this.firstNumber(row, ['word_count']) ?? this.firstNumber(reviewJson, ['wordCount']) ?? null,
      scores: {
        factualClarity: this.optionalScore(row.factual_clarity_score ?? scores.factualClarity),
        planAlignment: this.optionalScore(row.plan_alignment_score ?? scores.planAlignment),
        sourceQuality: this.optionalScore(row.source_quality_score ?? scores.sourceQuality),
        attitudeTraceability: this.optionalScore(row.attitude_traceability_score ?? scores.attitudeTraceability),
        riskReasoning: this.optionalScore(row.risk_reasoning_score ?? scores.riskReasoning),
        writingQuality: this.optionalScore(row.writing_quality_score ?? scores.writingQuality),
      },
      summary: String(reviewJson.summary || ''),
      checks: Array.isArray(reviewJson.checks) ? reviewJson.checks : [],
      issues: Array.isArray(reviewJson.issues) ? reviewJson.issues : [],
      recommendedEdits: Array.isArray(reviewJson.recommendedEdits) ? reviewJson.recommendedEdits : [],
      sourceUsage: this.plainObject(reviewJson.sourceUsage),
      reviewJson,
      errorMessage: row.error_message ? String(row.error_message) : null,
      createdAt: this.isoString(row.created_at),
    };
  }

  private async writeBackendDatabaseRecallArtifacts(
    job: JobRecord,
    context: Record<string, unknown>,
    result: VectorSearchResult,
    options: {
      maxRows: number;
      lookbackDays: number;
      databaseOptions: Record<string, unknown>;
      entityPolicy?: EntityPolicy;
      sourceFilter?: SourceFilterResult;
    },
  ): Promise<void> {
    const jobDir = this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const databaseDir = this.remoteFs.joinPath(jobDir, 'database');
    const now = new Date().toISOString();
    const vectorSources = result.sources.slice(0, options.maxRows);
    const acceptedMatches = new Map<string, SourceEntityMatch>();
    for (const source of options.sourceFilter?.acceptedSources || []) {
      const key = this.sourceEntityMatchKey(source);
      if (key) acceptedMatches.set(key, source.entityMatch);
    }
    const databaseSources = vectorSources.map((source, index) => ({
      id: `pg-vector-${index + 1}`,
      source_type: 'pg_vector',
      retrieval_channel: 'backend_pre_recall',
      ch_title: source.title,
      data_source_url: source.url,
      summary: source.summary,
      content_excerpt: source.contentExcerpt || '',
      website_name: source.websiteName,
      publish_time: source.publishTime,
      similarity: source.similarity,
      relevance_score: source.relevanceScore,
      relevance_level: this.databaseRelevanceLevel(source.relevanceScore),
      relevance_reason: '后端在调用编报执行器前通过 PostgreSQL pgvector 语义召回命中。',
      needs_verification: true,
      entity_match: acceptedMatches.get(this.sourceEntityMatchKey(source)) || null,
    }));
    const queryPlan = {
      schema_version: 1,
      generated_by: 'backend_pre_recall',
      generated_at: now,
      retrieval_mode: 'pg_vector',
      mcp_server: 'pg-sources',
      actual_connector: 'backend_pgvector_direct',
      compatibility_note: 'This artifact mirrors the old MCP pg-sources output shape, but was produced by backend pre-recall before invoking the report agent.',
      storageMode: result.queryPlan.storageMode,
      sourceTable: result.queryPlan.sourceTable || String(options.databaseOptions.sourceTable || ''),
      activeTable: result.queryPlan.activeTable,
      indexTable: result.queryPlan.indexTable,
      embeddingModel: result.queryPlan.embeddingModel,
      embeddingDimensions: result.queryPlan.embeddingDimensions,
      indexedRows: result.queryPlan.indexedRows,
      lookbackDays: options.lookbackDays,
      maxMetadataRows: options.maxRows,
      query_terms: this.databaseQueryTerms(context),
      vector_hits: result.queryPlan.vectorHits,
      keyword_boosted_hits: result.queryPlan.keywordBoostedHits,
      total_hits: result.totalHits,
      returned_sources: databaseSources.length,
      broadening_applied: result.queryPlan.broadeningApplied,
      content_rows_read: Math.min(databaseSources.length, this.boundInt(options.databaseOptions.maxContentRows, 8, 0, 20)),
      status: result.status,
      database_source_fallback_reason: databaseSources.length
        ? ''
        : options.sourceFilter?.diagnostics.fallbackReason || result.queryPlan.fallbackReason || 'PG vector pre-recall returned no usable accepted source.',
      fallback_mcp: '',
      entity_policy_enabled: true,
      accepted_sources: databaseSources.length,
      uncertain_sources: options.sourceFilter?.uncertainSources.length || 0,
      rejected_sources: options.sourceFilter?.rejectedSources.length || 0,
      should_use_web_supplement: options.sourceFilter?.diagnostics.shouldUseWebSupplement || databaseSources.length < 3,
    };
    const diagnostics = {
      schema_version: 1,
      generated_by: 'backend_pre_recall',
      generated_at: now,
      entityPolicy: options.entityPolicy || context.entityPolicy || null,
      diagnostics: options.sourceFilter?.diagnostics || {},
      uncertainSources: options.sourceFilter?.uncertainSources || [],
      rejectedSources: options.sourceFilter?.rejectedSources || [],
    };

    await this.remoteFs.mkdir(databaseDir);
    await Promise.all([
      this.remoteFs.writeFile(
        this.remoteFs.joinPath(jobDir, 'context.json'),
        `${JSON.stringify(context, null, 2)}\n`,
      ),
      this.remoteFs.writeFile(
        this.remoteFs.joinPath(databaseDir, 'vector_sources.json'),
        `${JSON.stringify(vectorSources, null, 2)}\n`,
      ),
      this.remoteFs.writeFile(
        this.remoteFs.joinPath(databaseDir, 'database_sources.json'),
        `${JSON.stringify(databaseSources, null, 2)}\n`,
      ),
      this.remoteFs.writeFile(
        this.remoteFs.joinPath(databaseDir, 'database_query_plan.json'),
        `${JSON.stringify(queryPlan, null, 2)}\n`,
      ),
      this.remoteFs.writeFile(
        this.remoteFs.joinPath(databaseDir, 'entity_policy.json'),
        `${JSON.stringify(options.entityPolicy || context.entityPolicy || null, null, 2)}\n`,
      ),
      this.remoteFs.writeFile(
        this.remoteFs.joinPath(databaseDir, 'database_sources_diagnostics.json'),
        `${JSON.stringify(diagnostics, null, 2)}\n`,
      ),
    ]);

    job.artifacts = {
      ...job.artifacts,
      hermesJobDir: jobDir,
      backendDatabaseSourcesPath: this.remoteFs.joinPath(databaseDir, 'database_sources.json'),
      backendDatabaseQueryPlanPath: this.remoteFs.joinPath(databaseDir, 'database_query_plan.json'),
      backendVectorSourcesPath: this.remoteFs.joinPath(databaseDir, 'vector_sources.json'),
      backendDatabaseSourceDiagnosticsPath: this.remoteFs.joinPath(databaseDir, 'database_sources_diagnostics.json'),
      entityPolicyPath: this.remoteFs.joinPath(databaseDir, 'entity_policy.json'),
    };
    await this.writeJobState(job);
  }

  private databaseRelevanceLevel(score: number): 'high' | 'medium' | 'low' {
    if (score >= 0.72) return 'high';
    if (score >= 0.55) return 'medium';
    return 'low';
  }

  private databaseQueryTerms(context: Record<string, unknown>): string[] {
    const terms = new Set<string>();
    const add = (value: unknown) => {
      const text = String(value ?? '').trim();
      if (text) terms.add(this.sanitizeLogText(text, 120));
    };
    add(context.topic);
    const intent = context.databaseQueryIntent && typeof context.databaseQueryIntent === 'object'
      ? context.databaseQueryIntent as Record<string, unknown>
      : {};
    for (const key of ['topic', 'normalizedTopic']) add(intent[key]);
    for (const key of ['coreTerms', 'entityTerms', 'actionTerms', 'domainTerms', 'ngrams', 'queries']) {
      const values = intent[key];
      if (Array.isArray(values)) values.slice(0, 20).forEach(add);
    }
    const selectedSearchQueries = context.selectedSearchQueries;
    if (Array.isArray(selectedSearchQueries)) selectedSearchQueries.slice(0, 10).forEach(add);
    return Array.from(terms).filter(Boolean).slice(0, 80);
  }

  private withDraftAssistantDatabaseSourceDefaults(context: Record<string, unknown>): Record<string, unknown> {
    if (context.databaseSourceOptions !== undefined) return context;
    const isDraftAssistantImport =
      context.kind === 'draft_assistant_import' ||
      context.draftAssistantMode === true ||
      Boolean(this.optionalId(context.planId));
    if (!isDraftAssistantImport) return context;
    return {
      ...context,
      databaseSourceOptions: {
        enabled: true,
        lookbackDays: 30,
        maxMetadataRows: 50,
        maxContentRows: 8,
      },
    };
  }

  private parseJsonObject(text: string): Record<string, unknown> | null {
    if (!text.trim()) return null;
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  private boundInt(raw: unknown, fallback: number, min: number, max: number): number {
    if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return fallback;
    const parsed = typeof raw === 'number' ? raw : Number(String(raw ?? ''));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  }

  private async runJob(job: JobRecord) {
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    await this.writeJobState(job);
    const startedAtMs = Date.now();

    try {
      const requestUser = this.buildRequestUser(job);
      const enrichedPayload = await this.enrichPayloadWithVectorSources(job);
      const supplementPayload = await this.enrichPayloadWithWebSupplement(job, enrichedPayload);
      const crawlerPayload = await this.enrichPayloadWithCrawlerSources(job, supplementPayload);
      const draftPayload = await this.enrichPayloadWithDraftAssistantContext(job, crawlerPayload, this.buildJobOwnerUser(job));
      const runInput: RunInput = {
        skill: job.skill,
        payload: draftPayload,
        requestUser,
        onEvent: (event) => this.pushEvent(job, event),
        jobId: job.jobId,
      };
      let result;
      let recoveredReport: Awaited<ReturnType<typeof this.resolveHermesReportFile>> = null;
      if (REPORT_AGENT_PROVIDER !== 'hermes') {
        result = await this.hermes.runReport(runInput);
      } else if (HERMES_RUN_MODE === 'runs') {
        try {
          result = await this.hermes.runReportViaRunsApi(runInput);
        } catch (runsError) {
          const message = this.sanitizeUserVisibleText(runsError instanceof Error ? runsError.message : String(runsError), 300);
          this.pushEvent(job, {
            type: 'stage',
            stage: 'runs_recovering',
            message: `Hermes runs API failed; checking for an already written report file. ${message}`,
          });
          recoveredReport = await this.findMarkdownFileInJobDir(job.jobId) ?? await this.findBestMarkdownFileForJob(job);
          if (recoveredReport) {
            this.pushEvent(job, {
              type: 'stage',
              stage: 'report_file_recovered',
              message: `Recovered generated report file after Hermes runs API failure: ${recoveredReport.filePath}`,
            });
            result = { markdown: `REPORT_FILE: ${recoveredReport.filePath}`, artifacts: { runMode: 'runs_api_recovered' } };
          } else {
            const artifactSummary = await this.describeHermesJobArtifacts(job);
            throw new Error(`Hermes runs API failed and no final report file was recovered. ${artifactSummary} ${message}`.trim());
          }
        }
      } else if (HERMES_RUN_MODE === 'remote_cli') {
        try {
          result = await this.hermes.runReport(runInput);
        } catch (cliError) {
          const message = this.sanitizeUserVisibleText(cliError instanceof Error ? cliError.message : String(cliError), 300);
          this.pushEvent(job, {
            type: 'stage',
            stage: 'http_fallback',
            message: `Hermes remote CLI failed; falling back to HTTP/SSE Gateway. ${message}`,
          });
          recoveredReport = await this.resolveHermesReportFile('', startedAtMs, job.jobId);
          if (recoveredReport) {
            this.pushEvent(job, {
              type: 'stage',
              stage: 'report_file_recovered',
              message: `Recovered generated report file after remote CLI failure: ${recoveredReport.filePath}`,
            });
            result = { markdown: `REPORT_FILE: ${recoveredReport.filePath}`, artifacts: { runMode: 'remote_cli_recovered' } };
          } else {
            result = await this.hermes.runReportViaHttpSse(runInput);
          }
        }
      } else if (HERMES_RUN_MODE === 'http') {
        result = await this.hermes.runReportViaHttpSse(runInput);
      } else {
        try {
          result = await this.hermes.runReportViaGateway(runInput);
        } catch (gatewayError) {
          const message = this.sanitizeUserVisibleText(gatewayError instanceof Error ? gatewayError.message : String(gatewayError), 300);
          this.pushEvent(job, {
            type: 'stage',
            stage: 'gateway_fallback',
            message: `任务通道暂不可用，已切换为普通生成模式。${message}`,
          });
          recoveredReport = await this.resolveHermesReportFile('', startedAtMs);
          if (recoveredReport) {
            this.pushEvent(job, {
              type: 'stage',
              stage: 'report_file_recovered',
              message: `Recovered generated report file after empty Gateway response: ${recoveredReport.filePath}`,
            });
            result = { markdown: `REPORT_FILE: ${recoveredReport.filePath}`, artifacts: {} };
          } else {
            try {
              result = await this.hermes.runReport(runInput);
            } catch (fallbackError) {
              recoveredReport = await this.resolveHermesReportFile('', startedAtMs);
              if (!recoveredReport) throw fallbackError;
              this.pushEvent(job, {
                type: 'stage',
                stage: 'report_file_recovered',
                message: `Recovered generated report file after empty fallback response: ${recoveredReport.filePath}`,
              });
              result = { markdown: `REPORT_FILE: ${recoveredReport.filePath}`, artifacts: {} };
            }
          }
        }
      }
      if (this.isJobCancelled(job)) return;

      let resolvedReport = recoveredReport ?? (await this.resolveHermesReportFile(result.markdown, startedAtMs, job.jobId));
      if (this.isJobCancelled(job)) return;
      let finalMarkdown = resolvedReport?.markdown ?? result.markdown;
      let syncResult: ArtifactSyncResult | null = null;
      if (!resolvedReport && /^\s*REPORT_FILE\s*:/im.test(finalMarkdown)) {
        if (!this.artifactSync) {
          job.artifacts = {
            ...job.artifacts,
            artifactSyncStatus: 'failed',
            artifactSyncDiagnostics: this.artifactSyncDiagnostics(job, finalMarkdown),
          };
          await this.writeJobState(job);
          throw new Error('HERMES_ARTIFACT_NOT_FOUND: Hermes returned a REPORT_FILE pointer, but no valid Markdown report file was found.');
        }
        syncResult = await this.artifactSync.syncReportMarkdown({
          jobId: job.jobId,
          reportPointer: this.extractReportPath(finalMarkdown) || this.extractReportPath(result.markdown),
          markdown: finalMarkdown,
        });
        if (syncResult.status !== 'completed') {
          job.artifacts = {
            ...job.artifacts,
            ...result.artifacts,
            artifactSyncStatus: 'failed',
            artifactSyncDiagnostics: syncResult.diagnostics,
          };
          await this.writeJobState(job);
          throw new Error(`${syncResult.code || 'ARTIFACT_SYNC_FAILED'}: ${syncResult.message || 'Report artifact sync failed.'}`);
        }
        const storageKey = syncResult.artifacts.reportMarkdown?.storageKey;
        finalMarkdown = storageKey ? await this.artifactSync.readText(storageKey) : finalMarkdown;
      }
      try {
        this.assertUsableGeneratedMarkdown(finalMarkdown);
      } catch (validationError) {
        const lateReport = await this.resolveHermesReportFile('', startedAtMs, job.jobId, 150_000);
        if (!lateReport) throw validationError;
        this.pushEvent(job, {
          type: 'stage',
          stage: 'report_file_recovered',
          message: `Recovered generated report file after validation fallback: ${lateReport.filePath}`,
        });
        resolvedReport = lateReport;
      }
      const usableMarkdown = resolvedReport?.markdown ?? finalMarkdown;
      syncResult = syncResult || (this.artifactSync
        ? await this.artifactSync.syncReportMarkdown({
          jobId: job.jobId,
          reportPointer: this.extractReportPath(result.markdown),
          localPath: resolvedReport?.filePath,
          markdown: usableMarkdown,
        })
        : null);
      if (syncResult && syncResult.status !== 'completed') {
        job.artifacts = {
          ...job.artifacts,
          ...result.artifacts,
          artifactSyncStatus: 'failed',
          artifactSyncDiagnostics: syncResult.diagnostics,
        };
        await this.writeJobState(job);
        throw new Error(`${syncResult.code || 'ARTIFACT_SYNC_FAILED'}: ${syncResult.message || 'Report artifact sync failed.'}`);
      }
      job.status = 'succeeded';
      job.markdown = usableMarkdown;
      job.artifacts = {
        ...job.artifacts,
        ...result.artifacts,
        ...(syncResult?.artifacts || {}),
        artifactSyncStatus: syncResult ? 'completed' : 'completed',
        artifactSyncDiagnostics: syncResult?.diagnostics || this.plainObject(job.artifacts?.artifactSyncDiagnostics),
      };
      job.resultPath = syncResult?.artifacts.reportMarkdown?.storageKey || resolvedReport?.filePath || (await this.writeReportFile(job, job.markdown));
      await this.writeReportReferencesArtifact(job, usableMarkdown);
      job.updatedAt = new Date().toISOString();
      await this.writeJobState(job);
      void this.runQualityReviewForJob(job).catch((reviewError) => {
        const message = reviewError instanceof Error ? reviewError.message : String(reviewError);
        this.pushEvent(job, {
          type: 'stage',
          stage: 'quality_review_failed',
          message: `成稿自检失败，可稍后重试。${this.sanitizeUserVisibleText(message, 180)}`,
        });
      });
      this.pushEvent(job, { type: 'stage', stage: 'done', message: 'Report generation completed and saved to disk.' });
      this.pushEvent(job, { type: 'done', jobId: job.jobId });
      this.streams.get(job.jobId)?.complete();
    } catch (error) {
      if (error instanceof HermesApprovalRequiredError) {
        job.status = 'waiting_approval';
        job.markdown = error.partialOutput;
        job.updatedAt = new Date().toISOString();
        await this.writeJobState(job);
        this.pushEvent(job, {
          type: 'stage',
          stage: 'approval_required',
          message: 'Hermes is waiting for tool approval. Run the approval command in the Hermes chat/session, then create the report again.',
        });
        this.pushEvent(job, {
          type: 'approval_required',
          commands: error.commands,
          message: 'Hermes requires approval before it can use external tools.',
          partialOutput: error.partialOutput,
        });
        this.pushEvent(job, { type: 'done', jobId: job.jobId });
        this.streams.get(job.jobId)?.complete();
        return;
      }

      const message = this.sanitizeUserVisibleText(error instanceof Error ? error.message : String(error), 300);
      const recovered = await this.safeRecoverJobFromExistingReport(job, 'failure_handler');
      if (recovered) {
        this.pushEvent(job, { type: 'done', jobId: job.jobId });
        this.streams.get(job.jobId)?.complete();
        return;
      }

      job.status = 'failed';
      job.stage = 'failed';
      job.errorMessage = message;
      job.updatedAt = new Date().toISOString();
      await this.writeJobState(job);
      this.pushEvent(job, { type: 'error', message });
      this.pushEvent(job, { type: 'done', jobId: job.jobId });
      this.streams.get(job.jobId)?.complete();
    }
  }

  private pushEvent(job: JobRecord, event: ServerEvent) {
    const safeEvent = this.sanitizeServerEvent(event);
    if (safeEvent.type === 'progress_state') {
      this.emitProgressState(job, safeEvent.progressState);
      return;
    }
    job.events.push(safeEvent);
    const logEntry = this.toEventLogEntry(job, safeEvent);
    if (logEntry) {
      job.eventLog.push(logEntry);
      if (job.eventLog.length > 500) job.eventLog = job.eventLog.slice(-500);
    }
    if (safeEvent.type === 'stage') {
      job.stage = safeEvent.stage;
    }
    this.streams.get(job.jobId)?.next(safeEvent);
    void this.writeJobState(job);
    void this.refreshProgressState(job, true);
  }

  private toEventLogEntry(job: JobRecord, event: ServerEvent): EventLogEntry | null {
    const now = new Date().toISOString();
    const baseId = `${job.jobId}:${job.eventLog.length + 1}:${event.type}`;

    if (event.type === 'stage') {
      return {
        id: `${baseId}:${event.stage}`,
        time: now,
        type: 'stage',
        label: '阶段进度',
        status: event.stage || 'running',
        phase: event.stage,
        actor: this.inferEventActor(event.stage),
        summary: this.sanitizeLogText(event.message || event.stage || 'Hermes 阶段更新', 220),
      };
    }

    if (event.type === 'tool_start' || event.type === 'tool_delta' || event.type === 'tool_end' || event.type === 'tool_error') {
      const raw = event.raw && typeof event.raw === 'object' ? (event.raw as Record<string, unknown>) : {};
      const status =
        this.firstLogString(raw, ['status']) ||
        (event.type === 'tool_start' ? 'started' : event.type === 'tool_end' ? 'completed' : event.type === 'tool_error' ? 'failed' : 'running');
      const label = this.sanitizeLogText(this.firstLogString(raw, ['label']) || event.name || 'Tool', 80);
      const summary = this.sanitizeLogText(
        this.firstLogString(raw, ['summary']) ||
          (event.type === 'tool_error' ? event.message : `${label} ${status}`),
        220,
      );
      const command = this.sanitizeCommandForEventLog(this.firstLogString(raw, ['command']));
      const phase = this.sanitizeLogText(this.firstLogString(raw, ['phase']), 80);
      const actor = this.sanitizeLogText(this.firstLogString(raw, ['actor']), 80);
      const detail = this.sanitizeLogText(this.firstLogString(raw, ['detail']), 220);
      const toolName = this.sanitizeLogText(this.extractToolNameForEvent(event, raw), 120);
      const toolEngine = this.sanitizeLogText(this.inferToolEngine(toolName || label || command), 60);
      return {
        id: `${baseId}:${event.id ?? job.eventLog.length + 1}`,
        time: now,
        type: event.type,
        label,
        status,
        summary,
        ...(command ? { command } : {}),
        ...(phase ? { phase } : {}),
        ...(actor ? { actor } : {}),
        ...(detail ? { detail } : {}),
        ...(toolName ? { toolName, toolDisplayName: this.formatToolDisplayName(toolName), toolId: event.id } : {}),
        ...(toolEngine ? { toolEngine } : {}),
      };
    }

    if (event.type === 'error') {
      return {
        id: baseId,
        time: now,
        type: 'error',
        label: '任务错误',
        status: 'failed',
        phase: 'error',
        actor: 'system',
        summary: this.sanitizeLogText(event.message || '任务失败', 220),
      };
    }

    if (event.type === 'done') {
      return {
        id: `${baseId}:${event.jobId}`,
        time: now,
        type: 'done',
        label: '任务完成',
        status: 'completed',
        phase: 'done',
        actor: 'system',
        summary: '后端任务已结束。',
      };
    }

    return null;
  }

  private firstLogString(value: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
    }
    return '';
  }

  private extractToolNameForEvent(event: ServerEvent, raw: Record<string, unknown>): string {
    const direct = 'name' in event && typeof event.name === 'string' ? event.name.trim() : '';
    if (direct) return direct;
    const rawDirect = this.firstLogString(raw, ['toolName', 'tool_name', 'name', 'tool', 'server', 'mcpServer', 'mcp_server']);
    if (rawDirect) return rawDirect;
    const rawFunction = raw.function && typeof raw.function === 'object' ? (raw.function as Record<string, unknown>) : null;
    const functionName = this.firstString(rawFunction, ['name']);
    if (functionName) return functionName;
    const command = this.firstLogString(raw, ['command']);
    if (/pg-sources__query/i.test(command)) return 'pg-sources__query';
    if (/mysql-test__mysql_query/i.test(command)) return 'mysql-test__mysql_query';
    if (/harness_cli\.py\s+plan/i.test(command)) return 'harness_cli.py plan';
    if (/harness_cli\.py\s+run/i.test(command)) return 'harness_cli.py run';
    if (/research_cli\.py/i.test(command)) return 'research_cli.py';
    if (/firecrawl/i.test(command)) return 'firecrawl';
    if (/tavily/i.test(command)) return 'tavily';
    if (/\bexa\b/i.test(command)) return 'exa';
    return '';
  }

  private inferToolEngine(value: string): string {
    const lower = String(value || '').toLowerCase();
    if (!lower) return '';
    if (lower.includes('pg-sources') || lower.includes('pg_vector')) return 'pg_vector';
    if (lower.includes('mysql')) return 'mysql';
    if (lower.includes('firecrawl')) return 'firecrawl';
    if (lower.includes('tavily_extract')) return 'tavily_extract';
    if (lower.includes('tavily')) return 'tavily';
    if (/\bexa\b/.test(lower)) return 'exa';
    if (lower.includes('harness_cli')) return 'harness';
    if (lower.includes('research_cli')) return 'research';
    if (lower.includes('sessions_')) return 'session';
    return '';
  }

  private formatToolDisplayName(toolName: string): string {
    const raw = String(toolName || '').replace(/\s+/g, ' ').trim();
    const lower = raw.toLowerCase();
    if (
      /pg-sources__query|pg_sources__query|mysql-test__mysql_query|mysql_test__mysql_query|database_sources|database_query_plan|vector_sources/.test(lower) ||
      /\b(pg|postgres|postgresql|mysql|sql|vector|embedding|database|db)\b/.test(lower)
    ) {
      return '数据库检索工具';
    }
    if (
      /\b(exa|firecrawl|tavily|internet|search|crawl|scrape|browser)\b|exa[_\s-]?search|firecrawl[_\s-]?(mcp|search|extract|crawl|scrape)|web[_\s-]?(search|serch|fetch|crawl|scrape)|search\.mjs|extract\.mjs/.test(lower)
    ) {
      return '互联网搜索工具';
    }
    return '本地脚本工具';
  }

  private firstString(data: Record<string, unknown> | null, keys: string[]): string {
    if (!data) return '';
    for (const key of keys) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  private firstNumber(data: Record<string, unknown> | null, keys: string[]): number | undefined {
    if (!data) return undefined;
    for (const key of keys) {
      const value = data[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return undefined;
  }

  private firstBoolean(data: Record<string, unknown> | null, keys: string[]): boolean | undefined {
    if (!data) return undefined;
    for (const key of keys) {
      const value = data[key];
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
      }
    }
    return undefined;
  }

  private arrayLength(data: Record<string, unknown> | null, keys: string[]): number | undefined {
    if (!data) return undefined;
    for (const key of keys) {
      const value = data[key];
      if (Array.isArray(value)) return value.length;
    }
    return undefined;
  }

  private nonNegativeInt(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.trunc(value));
  }

  private emptyDatabaseQueryPlanSummary(): DatabaseQueryPlanSummary {
    return {
      tablesDiscovered: 0,
      tablesChecked: 0,
      strictHits: 0,
      expandedHits: 0,
      returnedSources: 0,
      broadeningApplied: false,
      contentRowsRead: 0,
    };
  }

  private buildDatabaseQueryPlanSummary(plan: Record<string, unknown> | null, sourceCount: number): DatabaseQueryPlanSummary {
    const tablesDiscovered =
      this.firstNumber(plan, ['tables_discovered_count', 'tablesDiscoveredCount', 'discovered_tables_count']) ??
      this.arrayLength(plan, ['tables_discovered', 'tablesDiscovered', 'discovered_tables']);
    const tablesChecked =
      this.firstNumber(plan, ['tables_checked_count', 'tablesCheckedCount', 'checked_tables_count']) ??
      this.arrayLength(plan, ['tables_checked', 'tablesChecked', 'checked_tables']);
    const strictHits = this.firstNumber(plan, ['strict_hits', 'strictHits']);
    const expandedHits = this.firstNumber(plan, ['expanded_hits', 'expandedHits']);
    const returnedSources = this.firstNumber(plan, ['returned_sources', 'returnedSources']);
    const broadeningApplied = this.firstBoolean(plan, ['broadening_applied', 'broadeningApplied']) ?? this.nonNegativeInt(expandedHits) > 0;
    const contentRowsRead = this.firstNumber(plan, ['content_rows_read', 'contentRowsRead']);

    return {
      tablesDiscovered: this.nonNegativeInt(tablesDiscovered),
      tablesChecked: this.nonNegativeInt(tablesChecked),
      strictHits: this.nonNegativeInt(strictHits),
      expandedHits: this.nonNegativeInt(expandedHits),
      returnedSources: this.nonNegativeInt(returnedSources ?? sourceCount),
      broadeningApplied,
      contentRowsRead: this.nonNegativeInt(contentRowsRead),
    };
  }

  private buildVectorQueryPlanSummary(result: VectorSearchResult | null): VectorQueryPlanSummary {
    const plan = result?.queryPlan;
    return {
      enabled: Boolean(plan?.enabled),
      available: Boolean(plan?.available),
      storageMode: this.sanitizeLogText(String(plan?.storageMode || ''), 80),
      embeddingModel: this.sanitizeLogText(String(plan?.embeddingModel || ''), 80),
      activeTable: this.sanitizeLogText(String(plan?.activeTable || plan?.sourceTable || ''), 120),
      indexedRows: this.nonNegativeInt(Number(plan?.indexedRows || 0)),
      vectorHits: this.nonNegativeInt(Number(plan?.vectorHits || 0)),
      keywordBoostedHits: this.nonNegativeInt(Number(plan?.keywordBoostedHits || 0)),
      returnedSources: this.nonNegativeInt(Number(plan?.returnedSources || result?.sources.length || 0)),
      broadeningApplied: Boolean(plan?.broadeningApplied),
      lastIndexedAt: plan?.lastIndexedAt || null,
      fallbackReason: this.sanitizeLogText(String(plan?.fallbackReason || ''), 300),
    };
  }

  private vectorResultFromJob(job: JobRecord): VectorSearchResult | null {
    const sources = Array.isArray(job.artifacts?.vectorDatabaseSources)
      ? job.artifacts.vectorDatabaseSources as VectorSourceItem[]
      : [];
    const rawPlan = job.artifacts?.vectorDatabaseQueryPlan && typeof job.artifacts.vectorDatabaseQueryPlan === 'object'
      ? job.artifacts.vectorDatabaseQueryPlan as VectorSearchResult['queryPlan']
      : null;
    const status = String(job.artifacts?.vectorDatabaseSourceStatus || (sources.length ? 'hit' : rawPlan?.fallbackReason ? 'fallback' : 'unavailable'));
    if (!sources.length && !rawPlan) return null;
    return {
      status: ['hit', 'empty', 'fallback', 'unavailable'].includes(status) ? status as VectorSearchResult['status'] : 'unavailable',
      sources,
      totalHits: Math.max(Number(rawPlan?.vectorHits || 0), sources.length),
      queryPlan: rawPlan || {
        enabled: false,
        available: false,
        activeProfile: '',
        availableProfiles: [],
        storageMode: 'unavailable',
        embeddingModel: '',
        embeddingDimensions: 0,
        indexTable: '',
        activeTable: '',
        sourceTable: '',
        embeddingColumnType: '',
        pgvectorAvailable: false,
        indexedRows: 0,
        vectorHits: 0,
        keywordBoostedHits: 0,
        returnedSources: sources.length,
        broadeningApplied: false,
        lastIndexedAt: null,
        fallbackReason: '',
      },
      updatedAt: rawPlan?.lastIndexedAt || null,
    };
  }

  private normalizeVectorSources(items: VectorSourceItem[]): DatabaseSourceItem[] {
    return items
      .map((item) => ({
        title: this.sanitizeLogText(item.title || '', 200),
        url: this.sanitizeLogText(item.url || '', 500),
        summary: this.sanitizeLogText(item.summary || '', 1000),
        contentExcerpt: this.sanitizeLogText(item.contentExcerpt || '', 1000),
        websiteName: this.sanitizeLogText(item.websiteName || '', 120),
        publishTime: this.sanitizeLogText(item.publishTime || '', 60),
        similarity: Number.isFinite(Number(item.similarity)) ? Number(item.similarity) : undefined,
        relevanceScore: Number.isFinite(Number(item.relevanceScore)) ? Number(item.relevanceScore) : undefined,
        sourceType: item.retrievalMode || 'vector',
      }))
      .filter((item) => item.title || item.url);
  }

  private vectorSourceFromGuardedSource(source: Record<string, unknown>): VectorSourceItem {
    return {
      title: this.sanitizeLogText(this.firstString(source, ['title', 'ch_title']), 500),
      url: this.sanitizeLogText(this.firstString(source, ['url', 'data_source_url']), 1000),
      summary: this.sanitizeLogText(this.firstString(source, ['summary']), 1200),
      contentExcerpt: this.sanitizeLogText(this.firstString(source, ['contentExcerpt', 'content_excerpt']), 1200),
      embeddingText: this.sanitizeLogText(this.firstString(source, ['embeddingText', 'embedding_text']), 1200),
      websiteName: this.sanitizeLogText(this.firstString(source, ['websiteName', 'website_name']), 300),
      publishTime: this.sanitizeLogText(this.firstString(source, ['publishTime', 'publish_time']), 80),
      similarity: this.firstNumber(source, ['similarity']) ?? 0,
      relevanceScore: this.firstNumber(source, ['relevanceScore', 'relevance_score']) ?? this.firstNumber(source, ['similarity']) ?? 0,
      retrievalMode: 'vector',
    };
  }

  private filterDatabaseSourcesForResponse(sources: DatabaseSourceItem[], entityPolicy: EntityPolicy): SourceFilterResult<DatabaseSourceItem> {
    return filterSourcesByEntityPolicy(
      sources.map((source) => ({
        ...source,
        publisher: source.websiteName,
        publishedAt: source.publishTime,
        vectorScore: source.relevanceScore ?? source.similarity,
      })),
      entityPolicy,
    );
  }

  private databaseSourceMessage(filtered: {
    acceptedSources: unknown[];
    uncertainSources: unknown[];
    rejectedSources: unknown[];
    diagnostics: { fallbackReason?: string };
  }): string {
    if (filtered.acceptedSources.length) return '';
    const filteredCount = filtered.uncertainSources.length + filtered.rejectedSources.length;
    if (filteredCount > 0) return `数据库未找到通过核心实体校验的信源，已过滤 ${filteredCount} 条候选。`;
    return filtered.diagnostics.fallbackReason || '';
  }

  private sourceEntityMatchKey(source: Partial<DatabaseSourceItem | VectorSourceItem | Record<string, unknown>>): string {
    const record = source as Record<string, unknown>;
    const url = this.firstString(record, ['url', 'data_source_url', 'source_url']);
    if (url) return `url:${this.normalizeSourceUrl(url)}`;
    const title = this.firstString(record, ['title', 'ch_title']);
    const summary = this.firstString(record, ['summary']);
    return title ? `title:${title.toLowerCase()}|${summary.slice(0, 80).toLowerCase()}` : '';
  }

  private async entityPolicyForJob(
    job: JobRecord,
    dir?: string | null,
    context?: Record<string, unknown> | null,
  ): Promise<EntityPolicy> {
    if (dir) {
      const databaseDir = this.remoteFs.joinPath(dir, 'database');
      const rawPolicy = await this.readJsonFile(this.remoteFs.joinPath(databaseDir, 'entity_policy.json'));
      const filePolicy = parseEntityPolicy(rawPolicy);
      if (filePolicy) return { ...filePolicy, generatedBy: filePolicy.generatedBy || 'existing' };
      const diagnostics = await this.readJsonFile(this.remoteFs.joinPath(databaseDir, 'database_sources_diagnostics.json'));
      const diagnosticsPolicy = diagnostics && !Array.isArray(diagnostics)
        ? parseEntityPolicy(diagnostics.entityPolicy)
        : null;
      if (diagnosticsPolicy) return { ...diagnosticsPolicy, generatedBy: diagnosticsPolicy.generatedBy || 'existing' };
    }

    const contextPolicy = parseEntityPolicy(context?.entityPolicy);
    if (contextPolicy) return { ...contextPolicy, generatedBy: contextPolicy.generatedBy || 'existing' };

    const artifactPolicy = parseEntityPolicy(job.artifacts?.entityPolicy);
    if (artifactPolicy) return { ...artifactPolicy, generatedBy: artifactPolicy.generatedBy || 'existing' };

    const payload = job.payload as unknown as Record<string, unknown>;
    const payloadContext = context || this.contextObjectFromPayload(payload);
    const reportPlan = this.plainObject(payloadContext.report_plan || payloadContext.reportPlan);
    const draftAssistantContext = this.plainObject(payloadContext.draftAssistantContext);
    const input = {
      topic: payload.topic || payloadContext.topic,
      userSupplement: payloadContext.supplement || payload.known_context,
      reportPlan,
      databaseQueryIntent: payloadContext.databaseQueryIntent,
      selectedSearchQueries: payloadContext.selectedSearchQueries,
      selectedSources: payloadContext.userProvidedSources || payloadContext.selectedSources,
      draftAssistantContext,
    };
    const hermesExtractor = this.hermes as unknown as { extractEntityPolicy?: (input: ExtractEntityPolicyInput) => Promise<EntityPolicy> };
    if (typeof hermesExtractor.extractEntityPolicy === 'function') {
      try {
        return await hermesExtractor.extractEntityPolicy(input);
      } catch {
        // Deterministic fallback keeps report creation available when model extraction fails.
      }
    }
    return buildRuleBasedEntityPolicy(input);
  }

  private mergeDatabaseSources(primary: DatabaseSourceItem[], secondary: DatabaseSourceItem[]): DatabaseSourceItem[] {
    const seen = new Set<string>();
    const merged: DatabaseSourceItem[] = [];
    for (const item of [...primary, ...secondary]) {
      const key = item.url || `${item.title}|${item.summary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged;
  }

  private inferEventActor(phase: string): string {
    if (/research/i.test(phase)) return 'research-agent';
    if (/synthesis/i.test(phase)) return 'synthesis-agent';
    if (/hermes|running|waiting_final_report/i.test(phase)) return 'main-agent';
    return 'system';
  }

  private sanitizeCommandForEventLog(value: string): string {
    if (!value) return '';
    const sanitized = this.sanitizeLogText(value, 180)
      .replace(/\b(?:exa|firecrawl|tavily|tavily[_\s-]?(?:search|extract)|exa[_\s-]?search|firecrawl[_\s-]?(?:mcp|search|extract|crawl|scrape)|web[_\s-]?(?:search|serch|fetch|crawl|scrape)|search\.mjs|extract\.mjs)\b/gi, '互联网搜索工具')
      .replace(/(?:\/home\/node\/\.hermes\/workspace\/|\/usr\/docker\/hermes\/workspace\/)/g, '.../')
      .replace(/([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*=)[^\s"'`]+/gi, '$1[redacted]');
    return sanitized;
  }

  private sanitizeServerEvent(event: ServerEvent): ServerEvent {
    if (event.type === 'stage') {
      return { ...event, message: this.sanitizeUserVisibleText(event.message, 500) };
    }
    if (event.type === 'status') {
      return { ...event, message: event.message ? this.sanitizeUserVisibleText(event.message, 500) : event.message };
    }
    if (event.type === 'tool_error') {
      return { ...event, message: this.sanitizeUserVisibleText(event.message, 500), raw: this.sanitizeEventRaw(event.raw) };
    }
    if (event.type === 'tool_start' || event.type === 'tool_delta' || event.type === 'tool_end') {
      return { ...event, raw: this.sanitizeEventRaw(event.raw) };
    }
    if (event.type === 'approval_required') {
      return { ...event, message: this.sanitizeUserVisibleText(event.message, 500) };
    }
    if (event.type === 'error') {
      return { ...event, message: this.sanitizeUserVisibleText(event.message, 500) };
    }
    if (event.type === 'progress_state') {
      return { ...event, progressState: this.sanitizeProgressState(event.progressState) ?? event.progressState };
    }
    return event;
  }

  private sanitizeEventRaw(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      result[key] = typeof value === 'string' ? this.sanitizeUserVisibleText(value, 800) : value;
    }
    return result;
  }

  private sanitizeProgressState(state: ReportProgressState | undefined): ReportProgressState | undefined {
    if (!state) return undefined;
    return {
      ...state,
      stages: state.stages.map((stage) => ({
        ...stage,
        evidence: stage.evidence.map((item) => ({
          ...item,
          message: this.sanitizeUserVisibleText(item.message, 500),
        })),
      })),
    };
  }

  private sanitizeEventLogEntry(item: EventLogEntry): EventLogEntry {
    return {
      ...item,
      label: this.sanitizeUserVisibleText(item.label, 120),
      status: this.sanitizeUserVisibleText(item.status, 120),
      summary: this.sanitizeUserVisibleText(item.summary, 500),
      command: item.command ? this.sanitizeCommandForEventLog(item.command) : item.command,
      phase: item.phase ? this.sanitizeUserVisibleText(item.phase, 120) : item.phase,
      actor: item.actor ? this.sanitizeUserVisibleText(item.actor, 120) : item.actor,
      detail: item.detail ? this.sanitizeUserVisibleText(item.detail, 500) : item.detail,
      toolName: item.toolName ? this.sanitizeUserVisibleText(item.toolName, 120) : item.toolName,
      toolDisplayName: item.toolDisplayName ? this.sanitizeUserVisibleText(item.toolDisplayName, 120) : item.toolDisplayName,
      toolId: item.toolId ? this.sanitizeUserVisibleText(item.toolId, 120) : item.toolId,
      toolEngine: item.toolEngine ? this.sanitizeUserVisibleText(item.toolEngine, 80) : item.toolEngine,
    };
  }

  private sanitizeUserVisibleText(value: string, maxLength: number): string {
    const text = this.sanitizeLogText(value, Math.max(maxLength * 4, 1000));
    const lower = text.toLowerCase();
    if (/content_filter|considered high risk|safety policy|安全策略|高风险/.test(lower)) {
      return '本次主题触发模型安全策略，生成内容被拦截，未形成有效报告。请调整表述或降低敏感措辞后重试。';
    }
    const normalized = text
      .replace(/\b(?:exa|firecrawl|tavily|tavily[_\s-]?(?:search|extract)|exa[_\s-]?search|firecrawl[_\s-]?(?:mcp|search|extract|crawl|scrape)|web[_\s-]?(?:search|serch|fetch|crawl|scrape)|search\.mjs|extract\.mjs)\b/gi, '互联网搜索工具')
      .replace(/Hermes\s+Gateway/gi, '任务通道')
      .replace(/Hermes\s+report-agent/gi, '编报智能体')
      .replace(/Hermes\s+qa-agent/gi, '问答智能体')
      .replace(/Hermes/gi, '智能体服务')
      .replace(/(?:\/home\/node\/\.hermes\/workspace\/|\/usr\/docker\/hermes\/workspace\/)/gi, '.../')
      .replace(/\breport-agent\b/gi, '编报智能体')
      .replace(/\bqa-agent\b/gi, '问答智能体')
      .replace(/\bGateway\b/g, '任务通道')
      .replace(/returned too little report content\.?/gi, '生成内容不足，未达到编报成稿要求。')
      .replace(/returned a REPORT_FILE pointer, but no valid Markdown report file was found\.?/gi, '返回了报告文件指针，但未找到有效 Markdown 报告文件。')
      .replace(/returned empty report content\.?/gi, '未生成有效报告正文。')
      .replace(/returned no text\.?/gi, '未返回有效正文。')
      .replace(/returned no response\.?/gi, '未返回有效响应。')
      .replace(/couldn't generate a response\.?/gi, '未能生成有效响应。')
      .replace(/returned invalid K\/HB format: standalone .* headings are not allowed\.?/gi, '生成结果不符合编报格式要求。')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}…`;
  }

  private sanitizeLogText(value: string, maxLength: number): string {
    const redacted = String(value)
      .replace(/\b(api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*["']?[^"'\s,;}]+/gi, '$1=[redacted]')
      .replace(/\b(?:sk|tp)-[a-zA-Z0-9_-]{16,}\b/g, '[redacted-key]')
      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [redacted]')
      .replace(/\s+/g, ' ')
      .trim();
    if (redacted.length <= maxLength) return redacted;
    return `${redacted.slice(0, maxLength - 1)}…`;
  }

  private async writeReportFile(job: JobRecord, markdown: string): Promise<string> {
    try {
      const reportDir = this.remoteFs.remoteDir;
      await this.remoteFs.mkdir(reportDir);
      const filePath = this.remoteFs.joinPath(reportDir, `${job.jobId}.md`);
      await this.remoteFs.writeFile(filePath, markdown);
      return filePath;
    } catch (err) {
      console.error('writeReportFile failed:', err instanceof Error ? err.message : err);
      return '';
    }
  }

  private async writeJobState(job: JobRecord): Promise<void> {
    try {
      const reportDir = this.remoteFs.remoteDir;
      await this.remoteFs.mkdir(reportDir);
      const statePath = this.remoteFs.joinPath(reportDir, `${job.jobId}.json`);
      const { markdown: _markdown, events, ...serializable } = job;
      await this.remoteFs.writeFile(
        statePath,
        JSON.stringify({ ...serializable, eventCount: events.length }, null, 2),
      );
    } catch (err) {
      console.error('writeJobState failed:', err instanceof Error ? err.message : err);
    }
  }

  private async removeJobArtifacts(job: JobRecord): Promise<void> {
    const reportDir = this.remoteFs.remoteDir;
    const paths = new Map<string, { recursive: boolean }>();
    const addFile = (filePath: unknown) => {
      const value = String(filePath || '').trim();
      if (!value || !this.remoteFs.isInsideReportDir(value)) return;
      paths.set(value, { recursive: false });
      if (value.toLowerCase().endsWith('.md')) {
        paths.set(value.replace(/\.md$/i, '.html'), { recursive: false });
      }
    };
    const addDir = (dirPath: unknown) => {
      const value = String(dirPath || '').trim();
      if (!value || !this.remoteFs.isInsideReportDir(value)) return;
      paths.set(value, { recursive: true });
    };

    addFile(this.remoteFs.joinPath(reportDir, `${job.jobId}.json`));
    addFile(job.resultPath);
    addDir(await this.resolveHermesJobDir(job));

    for (const [filePath, options] of paths) {
      try {
        await this.remoteFs.remove(filePath, options);
      } catch (error) {
        console.error('removeJobArtifacts failed:', filePath, error instanceof Error ? error.message : error);
      }
    }
  }

  private async loadPersistedJobs(): Promise<void> {
    try {
      const reportDir = this.remoteFs.remoteDir;
      await this.remoteFs.mkdir(reportDir);
      const entries = await this.remoteFs.readdir(reportDir);
      await Promise.all(
        entries
          .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith('.json'))
          .map(async (entry) => {
            try {
              const filePath = this.remoteFs.joinPath(reportDir, entry.name);
              const parsed = JSON.parse(await this.remoteFs.readFile(filePath)) as Partial<JobRecord>;
              if (!parsed.jobId || this.jobs.has(parsed.jobId)) return;
              const job = {
                jobId: parsed.jobId,
                skill: parsed.skill ?? 'risk-assessment-reports',
                payload: parsed.payload ?? {},
                eventId: parsed.eventId,
                outlineId: parsed.outlineId,
                planId: parsed.planId,
                ownerUserId: parsed.ownerUserId ?? null,
                ownerUsername: parsed.ownerUsername ?? null,
                ownerRole: parsed.ownerRole,
                status: parsed.status ?? 'failed',
                artifacts: parsed.artifacts ?? {},
                createdAt: parsed.createdAt ?? new Date().toISOString(),
                updatedAt: parsed.updatedAt ?? parsed.createdAt ?? new Date().toISOString(),
                stage: parsed.stage,
                resultPath: parsed.resultPath,
                errorMessage: parsed.errorMessage,
                events: [],
                eventLog: Array.isArray(parsed.eventLog) ? parsed.eventLog.filter((item) => item && typeof item === 'object') as EventLogEntry[] : [],
                progressState: parsed.progressState,
              } as JobRecord;
              this.jobs.set(parsed.jobId, job);
              void this.reconcileInterruptedJob(job, 'startup_restore');
            } catch {
              // Ignore corrupted persisted job files.
            }
          }),
      );
    } catch {
      // Ignore startup restore failures; new jobs still work.
    }
  }

  private async safeRecoverJobFromExistingReport(job: JobRecord, reason: string): Promise<boolean> {
    try {
      return await this.recoverJobFromExistingReport(job, reason);
    } catch (error) {
      console.error('recoverJobFromExistingReport failed:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  private isJobCancelled(job: JobRecord): boolean {
    return String(job.status) === 'cancelled';
  }

  private async reconcileInterruptedJob(job: JobRecord, reason: string): Promise<void> {
    if (job.status !== 'queued' && job.status !== 'running') return;
    if (this.streams.has(job.jobId)) return;
    if (await this.recoverJobFromExistingReport(job, reason)) return;

    const lastActivityMs = this.lastJobActivityMs(job);
    if (Date.now() - lastActivityMs < 20 * 60 * 1000) return;

    job.status = 'failed';
    job.stage = 'failed';
    job.errorMessage = this.interruptedJobFailureMessage(job);
    job.updatedAt = new Date().toISOString();
    this.pushEvent(job, { type: 'error', message: job.errorMessage });
    await this.writeJobState(job);
  }

  private lastJobActivityMs(job: JobRecord): number {
    const times = [
      new Date(job.updatedAt || job.createdAt).getTime(),
      ...(job.eventLog || []).map((item) => new Date(item.time).getTime()),
    ].filter((value) => Number.isFinite(value));
    return times.length ? Math.max(...times) : Date.now();
  }

  private interruptedJobFailureMessage(job: JobRecord): string {
    const text = [
      job.errorMessage,
      ...(job.eventLog || []).slice(-30).map((item) => [item.summary, item.detail, item.command].filter(Boolean).join(' ')),
    ].join(' ');
    if (/content_filter|inappropriate content|provider rejected|safety policy|high risk/i.test(text)) {
      return '本次主题触发模型安全策略，生成内容被拦截，未形成有效报告。已停止等待，请调整表述或切换备用模型后重试。';
    }
    return '任务执行过程中服务连接中断，未找到可恢复的最终报告文件。已停止等待，请重新生成。';
  }

  private async resolveHermesReportFile(markdown: string, startedAtMs: number, jobId?: string, waitMs = 0) {
    const deadline = Date.now() + Math.max(0, waitMs);
    do {
      const found = await this.resolveHermesReportFileOnce(markdown, startedAtMs, jobId);
      if (found) return found;
      if (Date.now() >= deadline) break;
      await this.sleep(5_000);
    } while (Date.now() < deadline);

    return null;
  }

  private async resolveHermesReportFileOnce(markdown: string, startedAtMs: number, jobId?: string) {
    if (!this.hasReportFilePointer(markdown)) return null;

    const fromText = await this.readMarkdownFile(this.extractReportPath(markdown), jobId);
    if (fromText) return fromText;

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractReportPath(text: string): string | null {
    const normalized = text.replaceAll('\\\\', '/');
    const pointer = normalized.match(/^\s*REPORT_FILE\s*:\s*(\/[^\r\n`"'<>|?*]+?\.md)\s*$/im)?.[1]?.trim();
    if (pointer) return pointer;
    const pattern = /(?:\/opt\/data\/workspace\/report-agent\/reports\/|\/opt\/hermes\/workspace\/report-agent\/reports\/|\/home\/node\/\.hermes\/workspace\/report-agent\/reports\/|\/usr\/docker\/hermes\/workspace\/report-agent\/reports\/)[^\r\n`"'<>|?*]+?\.md/gi;
    const matches = Array.from(normalized.matchAll(pattern)).map((match) => match[0].trim());
    return matches[0] ?? null;
  }

  private hasReportFilePointer(text: string): boolean {
    return /^\s*REPORT_FILE\s*:\s*\/.+\.md\s*$/im.test(String(text || ''));
  }

  private async findLatestMarkdownFile(startedAtMs: number) {
    try {
      const reportDir = this.remoteFs.remoteDir;
      const entries = await this.remoteFs.readdir(reportDir);
      const files: { filePath: string; stat: { size: number; mtimeMs: number } }[] = [];
      for (const entry of entries) {
        if (!entry.isFile || !entry.name.toLowerCase().endsWith('.md')) continue;
        const filePath = this.remoteFs.joinPath(reportDir, entry.name);
        try {
          const stat = await this.remoteFs.stat(filePath);
          files.push({ filePath, stat });
        } catch { continue; }
      }

      const latest = files
        .filter(({ filePath, stat }) => this.remoteFs.isInsideReportDir(filePath) && stat.mtimeMs >= startedAtMs - 5000)
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || b.stat.size - a.stat.size)[0];
      return latest ? this.readMarkdownFile(latest.filePath) : null;
    } catch {
      return null;
    }
  }

  private async findMarkdownFileInJobDir(jobId: string) {
    const reportDir = this.remoteFs.remoteDir;
    const jobDir = this.remoteFs.joinPath(reportDir, jobId);
    const priorityPaths = [
      this.remoteFs.joinPath(jobDir, 'final', 'report.md'),
      this.remoteFs.joinPath(jobDir, 'report.md'),
    ];

    for (const filePath of priorityPaths) {
      const report = await this.readMarkdownFile(filePath);
      if (report) return report;
    }

    try {
      const finalDir = this.remoteFs.joinPath(jobDir, 'final');
      const entries = await this.remoteFs.readdir(finalDir);
      const files: { filePath: string; stat: { size: number; mtimeMs: number } }[] = [];
      for (const entry of entries) {
        if (!entry.isFile || !entry.name.toLowerCase().endsWith('.md')) continue;
        const filePath = this.remoteFs.joinPath(finalDir, entry.name);
        try {
          files.push({ filePath, stat: await this.remoteFs.stat(filePath) });
        } catch { continue; }
      }
      files.sort((a, b) => b.stat.size - a.stat.size || b.stat.mtimeMs - a.stat.mtimeMs);
      for (const candidate of files) {
        const report = await this.readMarkdownFile(candidate.filePath, jobId);
        if (report) return report;
      }
    } catch {
      return null;
    }

    return null;
  }

  private async describeHermesJobArtifacts(job: JobRecord): Promise<string> {
    try {
      const dir = await this.resolveHermesJobDir(job) || this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
      const checks: Array<[string, string]> = [
        ['context.json', this.remoteFs.joinPath(dir, 'context.json')],
        ['database/vector_sources.json', this.remoteFs.joinPath(dir, 'database', 'vector_sources.json')],
        ['database/database_sources.json', this.remoteFs.joinPath(dir, 'database', 'database_sources.json')],
        ['plan.json', this.remoteFs.joinPath(dir, 'plan.json')],
        ['research/research_A.json', this.remoteFs.joinPath(dir, 'research', 'research_A.json')],
        ['research/research_B.json', this.remoteFs.joinPath(dir, 'research', 'research_B.json')],
        ['research/consolidated.json', this.remoteFs.joinPath(dir, 'research', 'consolidated.json')],
        ['final/report.md', this.remoteFs.joinPath(dir, 'final', 'report.md')],
      ];
      const existing: string[] = [];
      const missing: string[] = [];
      for (const [label, filePath] of checks) {
        if (await this.remoteFs.exists(filePath)) existing.push(label);
        else missing.push(label);
      }
      return `Artifacts existing: ${existing.join(', ') || 'none'}. Missing: ${missing.join(', ') || 'none'}.`;
    } catch {
      return 'Artifact status could not be inspected.';
    }
  }

  private async recoverJobFromExistingReport(job: JobRecord, reason: string): Promise<boolean> {
    if (job.status === 'succeeded' && job.resultPath && job.markdown) return false;
    if (!this.canRecoverJobFromExistingReport(job)) return false;

    const report = await this.findMarkdownFileInJobDir(job.jobId) ?? await this.findBestMarkdownFileForJob(job);
    if (!report) return false;

    job.status = 'succeeded';
    job.stage = 'done';
    job.markdown = report.markdown;
    job.resultPath = report.filePath;
    job.errorMessage = undefined;
    await this.writeReportReferencesArtifact(job, report.markdown);
    job.updatedAt = new Date().toISOString();

    this.pushEvent(job, {
      type: 'stage',
      stage: 'report_file_recovered',
      message: `Recovered generated report file during ${reason}: ${report.filePath}`,
    });
    this.pushEvent(job, { type: 'stage', stage: 'done', message: 'Report generation completed and saved to disk.' });
    await this.writeJobState(job);
    return true;
  }

  private canRecoverJobFromExistingReport(job: JobRecord): boolean {
    if (job.status === 'queued' || job.status === 'running' || job.status === 'waiting_approval') return false;
    return this.hasExplicitReportCompletionEvidence(job);
  }

  private hasExplicitReportCompletionEvidence(job: JobRecord): boolean {
    return (job.eventLog || []).some((entry) => {
      const text = [entry.phase, entry.status, entry.summary, entry.detail, entry.command].filter(Boolean).join(' ');
      if (this.hasReportFilePointer(text)) return true;
      if (entry.type === 'stage' && entry.phase === 'received') return true;
      return entry.type === 'stage'
        && entry.phase === 'done'
        && /report generation completed|报告.*完成|最终报告.*确认/i.test(entry.summary || '');
    });
  }

  private async findBestMarkdownFileForJob(job: JobRecord) {
    try {
      const startedAtMs = new Date(job.createdAt).getTime();
      const endedAtMs = new Date(job.updatedAt || job.createdAt).getTime();
      const reportDir = this.remoteFs.remoteDir;
      const entries = await this.remoteFs.readdir(reportDir);
      const files: { filePath: string; stat: { size: number; mtimeMs: number } }[] = [];
      for (const entry of entries) {
        if (entry.isFile && entry.name.toLowerCase().endsWith('.md')) {
          const filePath = this.remoteFs.joinPath(reportDir, entry.name);
          try {
            const stat = await this.remoteFs.stat(filePath);
            files.push({ filePath, stat });
          } catch { continue; }
        }
        if (!entry.isDirectory) continue;
        const dir = this.remoteFs.joinPath(reportDir, entry.name);
        for (const nested of [
          this.remoteFs.joinPath(dir, 'final', 'report.md'),
          this.remoteFs.joinPath(dir, 'report.md'),
        ]) {
          try {
            const stat = await this.remoteFs.stat(nested);
            if (stat.isFile) files.push({ filePath: nested, stat });
          } catch { continue; }
        }
      }

      const candidates = files
        .filter(({ filePath, stat }) => {
          if (!this.remoteFs.isInsideReportDir(filePath)) return false;
          if (stat.mtimeMs < startedAtMs - 10_000) return false;
          if (Number.isFinite(endedAtMs) && stat.mtimeMs > endedAtMs + 60_000) return false;
          return true;
        })
        .sort((a, b) => b.stat.size - a.stat.size || b.stat.mtimeMs - a.stat.mtimeMs);

      for (const candidate of candidates) {
        const report = await this.readMarkdownFile(candidate.filePath);
        if (report) return report;
      }

      return null;
    } catch {
      return null;
    }
  }

  private async readMarkdownFile(filePath: string | null, jobId?: string) {
    if (!filePath) return null;
    if (jobId) {
      const resolved = await this.resolveArtifactLocalPath({ jobId, artifacts: {}, status: 'running' } as JobRecord, filePath, 'reportMarkdown');
      if (!resolved) return null;
      filePath = resolved;
    } else if (!this.remoteFs.isInsideReportDir(filePath)) return null;
    try {
      const stat = await this.remoteFs.stat(filePath);
      if (!stat.isFile) return null;
      const markdown = await this.remoteFs.readFile(filePath);
      return this.isValidReportMarkdown(markdown, stat.size) ? { filePath, markdown } : null;
    } catch {
      return null;
    }
  }

  private async resolveArtifactLocalPath(job: JobRecord, filePath: string | null | undefined, artifactType: string): Promise<string | null> {
    if (!filePath) return null;
    if (this.artifactResolver) {
      const resolved = await this.artifactResolver.resolveHermesArtifactPath({
        jobId: job.jobId,
        remotePath: filePath,
        artifactType,
      });
      if (resolved.exists) return resolved.localPath;
      job.artifacts = {
        ...job.artifacts,
        artifactSyncStatus: 'failed',
        artifactSyncDiagnostics: {
          ...this.plainObject(job.artifacts?.artifactSyncDiagnostics),
          [artifactType]: {
            status: resolved.status,
            mode: resolved.status,
            localExists: resolved.exists,
            remotePathPresent: Boolean(filePath),
            reason: resolved.reason,
          },
        },
      };
      return null;
    }
    return this.remoteFs.isInsideReportDir(filePath) ? filePath : null;
  }

  private artifactSyncDiagnostics(job: JobRecord, markdown: string): Record<string, unknown> {
    return {
      reportMarkdown: {
        status: 'missing',
        mode: 'mapped',
        localExists: false,
        remotePathPresent: Boolean(this.extractReportPath(markdown)),
        reason: 'REPORT_FILE pointer could not be resolved to a readable local artifact.',
      },
      jobId: job.jobId,
    };
  }

  private async readJsonFile(filePath: string): Promise<Record<string, unknown> | unknown[] | null> {
    try {
      const raw = await this.remoteFs.readFile(filePath);
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed as Record<string, unknown> | unknown[];
    } catch {
      return null;
    }
  }

  private normalizeDatabaseSources(items: unknown[]): DatabaseSourceItem[] {
    const result: DatabaseSourceItem[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const source = item as Record<string, unknown>;
      const title = this.sanitizeLogText(
        this.firstString(source, ['ch_title', 'title', 'entitle']),
        200,
      );
      const url = this.sanitizeLogText(
        this.firstString(source, ['data_source_url', 'url']),
        500,
      );
      if (!title && !url) continue;
      result.push({
        title,
        url,
        summary: this.sanitizeLogText(this.firstString(source, ['summary']), 1000),
        contentExcerpt: this.sanitizeLogText(this.firstString(source, ['content_excerpt', 'contentExcerpt', 'snippet', 'content_preview']), 1000),
        websiteName: this.sanitizeLogText(this.firstString(source, ['website_name', 'websiteName']), 120),
        publishTime: this.sanitizeLogText(this.firstString(source, ['publish_time', 'publishTime']), 60),
        similarity: this.firstNumber(source, ['similarity']),
        relevanceScore: this.firstNumber(source, ['relevance_score', 'relevanceScore', 'score', 'rank_score']),
        sourceType: this.sanitizeLogText(this.firstString(source, ['source_type', 'sourceType', 'type']), 80),
      });
    }
    return result;
  }

  private normalizeDiagnosticDatabaseSources(items: unknown[]): DatabaseSourceItem[] {
    return this.normalizeDatabaseSources(items).map((source, index) => {
      const raw = items[index] && typeof items[index] === 'object' ? items[index] as Record<string, unknown> : {};
      const entityMatchRaw = raw.entityMatch || raw.entity_match;
      const entityMatch = entityMatchRaw && typeof entityMatchRaw === 'object' && !Array.isArray(entityMatchRaw)
        ? entityMatchRaw as SourceEntityMatch
        : undefined;
      return entityMatch ? { ...source, entityMatch } : source;
    });
  }

  private async readDatabaseSourceDiagnostics(dir: string): Promise<{ diagnostics: Record<string, unknown>; uncertainSources: unknown[]; rejectedSources: unknown[] }> {
    const raw = await this.readJsonFile(this.remoteFs.joinPath(dir, 'database', 'database_sources_diagnostics.json'));
    if (!raw || Array.isArray(raw)) return { diagnostics: {}, uncertainSources: [], rejectedSources: [] };
    return {
      diagnostics: this.plainObject(raw.diagnostics),
      uncertainSources: Array.isArray(raw.uncertainSources) ? raw.uncertainSources : [],
      rejectedSources: Array.isArray(raw.rejectedSources) ? raw.rejectedSources : [],
    };
  }

  private normalizeReportSourceType(type: unknown): ReportSourceListType {
    const normalized = String(type || '').trim();
    if (
      normalized === 'database_recall' ||
      normalized === 'crawler' ||
      normalized === 'tool_search' ||
      normalized === 'report_refs' ||
      normalized === 'structured_sources' ||
      normalized === 'candidate_hits' ||
      normalized === 'extract_failed' ||
      normalized === 'all'
    ) {
      return normalized;
    }
    return 'all';
  }

  private databaseRecallChannelSources(
    structuredSources: ReportSourceListItem[],
    reportRefs: ReportSourceListItem[],
  ): ReportSourceListItem[] {
    const databaseItems = structuredSources.map((source) => ({
      ...source,
      sourceGroup: 'database_recall' as const,
      sourceOrigin: 'database_recall' as const,
      evidenceKind: source.evidenceKind || 'structured_source' as const,
      engine: source.engine || this.inferDatabaseEngine(source),
      sourceType: source.sourceType || '数据库记录',
    }));
    const databaseKeys = new Set(databaseItems.map((item) => this.sourceDedupeKey(item)).filter(Boolean));
    const matchingRefs = reportRefs
      .filter((ref) => databaseKeys.has(this.sourceDedupeKey(ref)))
      .map((ref) => ({
        ...ref,
        sourceGroup: 'database_recall' as const,
        sourceOrigin: 'database_recall' as const,
        evidenceKind: 'report_reference' as const,
        engine: this.inferDatabaseEngine(ref),
      }));
    return this.mergeReportSourceItems([...databaseItems, ...matchingRefs], 'database_recall');
  }

  private toolSearchChannelSources(
    researchSources: ReportSourceListItem[],
    reportRefs: ReportSourceListItem[],
    databaseRecall: ReportSourceListItem[],
  ): ReportSourceListItem[] {
    const databaseKeys = new Set(databaseRecall.map((item) => this.sourceDedupeKey(item)).filter(Boolean));
    const researchItems = researchSources.map((source) => ({
      ...source,
      sourceGroup: 'tool_search' as const,
      sourceOrigin: 'tool_search' as const,
      evidenceKind: source.evidenceKind || 'research_source' as const,
      engine: source.engine || this.inferToolSearchEngine(source),
    }));
    const researchKeys = new Set(researchItems.map((item) => this.sourceDedupeKey(item)).filter(Boolean));
    const publicRefs = reportRefs
      .filter((ref) => {
        const key = this.sourceDedupeKey(ref);
        if (!key || !ref.url || ref.matchStatus !== 'matched') return false;
        return !databaseKeys.has(key) || researchKeys.has(key);
      })
      .map((ref) => ({
        ...ref,
        sourceGroup: 'tool_search' as const,
        sourceOrigin: 'tool_search' as const,
        evidenceKind: 'report_reference' as const,
        engine: this.inferToolSearchEngine(ref),
      }));
    return this.mergeReportSourceItems([...researchItems, ...publicRefs], 'tool_search');
  }

  private mergeReportSourceItems(
    items: ReportSourceListItem[],
    sourceGroup: 'database_recall' | 'tool_search',
  ): ReportSourceListItem[] {
    const merged = new Map<string, ReportSourceListItem>();
    for (const item of items) {
      const key = this.sourceDedupeKey(item) || `${sourceGroup}:${item.id}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...item, sourceGroup });
        continue;
      }
      merged.set(key, {
        ...existing,
        citationNo: existing.citationNo ?? item.citationNo,
        title: this.longerText(existing.title, item.title),
        url: existing.url || item.url,
        sourceName: existing.sourceName || item.sourceName,
        publishTime: existing.publishTime || item.publishTime,
        summary: this.longerText(existing.summary, item.summary),
        excerpt: this.longerText(existing.excerpt, item.excerpt),
        sourceType: existing.sourceType || item.sourceType,
        relevanceScore: Math.max(existing.relevanceScore || 0, item.relevanceScore || 0) || undefined,
        status: existing.status || item.status,
        method: existing.method || item.method,
        rawReferenceText: existing.rawReferenceText || item.rawReferenceText,
        matchStatus: existing.matchStatus || item.matchStatus,
        evidenceKind: existing.evidenceKind === 'report_reference' ? item.evidenceKind || existing.evidenceKind : existing.evidenceKind,
        engine: existing.engine || item.engine,
      });
    }
    return Array.from(merged.values()).sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }

  private sourceDedupeKey(item: Partial<ReportSourceListItem>): string {
    const url = this.normalizeSourceUrl(item.url);
    if (url) return `url:${url}`;
    const title = String(item.title || '').trim().toLowerCase();
    const sourceName = String(item.sourceName || '').trim().toLowerCase();
    return title ? `title:${title}|${sourceName}` : '';
  }

  private reportSourcePriority(item: ReportSourceListItem): number {
    const explicit = Number(item.sourcePriority);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const relevance = Number(item.relevanceScore || 0);
    const normalized = relevance > 1 ? relevance / 100 : relevance;
    const authority = /官方|政府|公告|主流|研究|reuters|bloomberg/i.test(`${item.sourceType || ''} ${item.sourceName || ''}`) ? 0.15 : 0;
    const referenced = item.status === 'referenced' || item.evidenceKind === 'report_reference' ? 0.08 : 0;
    return Math.max(0, Math.min(1, normalized + authority + referenced));
  }

  private normalizeSourceUrl(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      parsed.hash = '';
      parsed.searchParams.sort();
      return parsed.toString().replace(/\/$/, '').toLowerCase();
    } catch {
      return raw.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
    }
  }

  private longerText(a?: string, b?: string): string {
    const left = String(a || '');
    const right = String(b || '');
    return right.length > left.length ? right : left;
  }

  private async reportReferenceSources(job: JobRecord): Promise<ReportSourceListItem[]> {
    const persisted = await this.readReportReferencesArtifact(job);
    const acceptedPersisted = (persisted || []).filter((item) => item.matchStatus === 'matched');
    if (acceptedPersisted.length) return acceptedPersisted;

    const markdown = await this.reportMarkdown(job);
    if (!markdown) return [];
    const rebuilt = await this.buildReportReferenceItems(job, markdown);
    await this.writeReportReferencesArtifact(job, markdown, rebuilt);
    return rebuilt.filter((item) => item.matchStatus === 'matched');
  }

  private async buildReportReferenceItems(job: JobRecord, markdown: string): Promise<ReportSourceListItem[]> {
    const references = this.parseReferenceEntriesRobust(markdown);
    const citationNumbers = this.parseCitationNumbers(markdown);
    const [structured, toolSearch, crawler] = await Promise.all([
      this.structuredReportSources(job),
      this.toolSearchSources(job),
      this.crawlerReportSources(job),
    ]);
    const acceptedSources = [...structured, ...toolSearch, ...crawler];
    const acceptedByUrl = new Map(
      acceptedSources
        .map((source) => [this.normalizeSourceUrl(source.url), source] as const)
        .filter(([url]) => Boolean(url)),
    );
    const titleKey = (value: unknown) => String(value || '')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '');
    const acceptedByTitle = new Map(
      acceptedSources
        .map((source) => [titleKey(source.title), source] as const)
        .filter(([title]) => Boolean(title)),
    );
    const allNumbers = citationNumbers.length
      ? citationNumbers
      : Array.from(references.keys()).sort((a, b) => a - b);

    return allNumbers.map((number, index) => {
      const reference = references.get(number);
      const referenceUrl = this.normalizeSourceUrl(reference?.url);
      const referenceTitle = titleKey(reference?.title);
      const matchedSource = reference
        ? (referenceUrl ? acceptedByUrl.get(referenceUrl) : undefined) ||
          (referenceTitle ? acceptedByTitle.get(referenceTitle) : undefined)
        : structured[number - 1];
      const rawReferenceText = reference?.rawReferenceText || reference?.summary || reference?.title || '';
      const matched = Boolean(matchedSource?.title || matchedSource?.url || matchedSource?.summary);
      return {
        id: `report-ref-${number}`,
        sourceGroup: 'report_refs',
        sourceOrigin: matchedSource?.sourceOrigin,
        evidenceKind: 'report_reference',
        engine: matchedSource?.engine,
        citationNo: number,
        title: reference?.title || matchedSource?.title || `\u53c2\u8003\u7f16\u53f7 [${number}]`,
        url: matchedSource?.url || '',
        sourceName: matchedSource?.sourceName || reference?.sourceName || '',
        publishTime: matchedSource?.publishTime || reference?.publishTime || '',
        summary: matchedSource?.summary || reference?.summary || rawReferenceText,
        excerpt: `\u6b63\u6587\u5f15\u7528\u7f16\u53f7 [${number}]`,
        sourceType: '\u62a5\u544a\u5f15\u7528',
        relevanceScore: Math.max(100 - index, 1),
        status: 'referenced',
        method: matchedSource?.method || (reference ? '\u62a5\u544a\u53c2\u8003\u8d44\u6599\u7d22\u5f15' : matched ? '\u7ed3\u6784\u5316\u4fe1\u6e90\u5339\u914d' : '\u6b63\u6587\u5f15\u7528\u7f16\u53f7'),
        rawReferenceText,
        matchStatus: matched ? 'matched' : 'raw_only',
      };
    });
  }

  private reportReferencesArtifactPath(job: JobRecord): string {
    return this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId, 'references', 'report_references.json');
  }

  private async reportReferencesArtifactCandidatePaths(job: JobRecord): Promise<string[]> {
    const paths = new Set<string>();
    const knownPath = this.firstString(job.artifacts || {}, ['reportReferencesPath', 'report_references_path']);
    if (knownPath) paths.add(knownPath);
    const dir = await this.resolveHermesJobDir(job);
    if (dir) paths.add(this.remoteFs.joinPath(dir, 'references', 'report_references.json'));
    paths.add(this.reportReferencesArtifactPath(job));
    return Array.from(paths);
  }

  private async readReportReferencesArtifact(job: JobRecord): Promise<ReportSourceListItem[] | null> {
    const paths = await this.reportReferencesArtifactCandidatePaths(job);
    for (const filePath of paths) {
      const raw = await this.readJsonFile(filePath);
      if (!raw) continue;
      if (Array.isArray(raw) || Number((raw as Record<string, unknown>).referenceGuardVersion) !== 2) continue;
      const items = Array.isArray(raw)
        ? raw
        : this.arrayFromObject(raw, ['references', 'items', 'sources', 'data']);
      const normalized = items
        .map((item, index) => this.normalizeReportReferenceArtifactItem(item, index))
        .filter((item): item is ReportSourceListItem => Boolean(item));
      if (normalized.length) return normalized;
    }
    return null;
  }

  private normalizeReportReferenceArtifactItem(item: unknown, index: number): ReportSourceListItem | null {
    if (!item || typeof item !== 'object') return null;
    const source = item as Record<string, unknown>;
    const citationNo = this.firstNumber(source, ['citationNo', 'citation_no', 'number', 'refNo', 'ref_no']) ?? index + 1;
    const normalized = this.normalizeSourceRecord(source, index, 'report_refs');
    const title = this.sanitizeLogText(
      this.firstString(source, ['title', 'ch_title', 'headline', 'sourceTitle']) ||
        this.firstString(source, ['rawReferenceText', 'raw_reference_text', 'referenceText', 'reference_text']) ||
        `\u53c2\u8003\u7f16\u53f7 [${citationNo}]`,
      220,
    );
    const rawReferenceText = this.sanitizeLogText(
      this.firstString(source, ['rawReferenceText', 'raw_reference_text', 'referenceText', 'reference_text']),
      1200,
    );
    const status = this.firstString(source, ['matchStatus', 'match_status']);
    return {
      ...normalized,
      id: this.sanitizeLogText(normalized.id || `report-ref-${citationNo}`, 260),
      sourceGroup: 'report_refs',
      evidenceKind: 'report_reference',
      citationNo,
      title,
      sourceType: normalized.sourceType || '\u62a5\u544a\u5f15\u7528',
      relevanceScore: normalized.relevanceScore ?? Math.max(100 - index, 1),
      status: normalized.status || 'referenced',
      method: normalized.method || '\u62a5\u544a\u53c2\u8003\u8d44\u6599\u7d22\u5f15',
      rawReferenceText,
      matchStatus: status === 'matched' || status === 'failed' || status === 'raw_only'
        ? status
        : rawReferenceText
          ? 'raw_only'
          : 'matched',
    };
  }

  private async writeReportReferencesArtifact(
    job: JobRecord,
    markdown: string,
    prebuiltItems?: ReportSourceListItem[],
  ): Promise<void> {
    try {
      const items = prebuiltItems ?? await this.buildReportReferenceItems(job, markdown);
      const references = items.filter((item) => item.matchStatus === 'matched').slice(0, 300).map((item) => ({
        citationNo: item.citationNo,
        title: item.title || '',
        sourceName: item.sourceName || '',
        url: item.url || '',
        publishedAt: item.publishTime || '',
        summary: item.summary || '',
        excerpt: item.excerpt || '',
        rawReferenceText: item.rawReferenceText || '',
        sourceType: item.sourceType || '',
        sourceOrigin: item.sourceOrigin || '',
        evidenceKind: item.evidenceKind || '',
        engine: item.engine || '',
        relevanceScore: item.relevanceScore,
        status: item.status || '',
        method: item.method || '',
        matchStatus: item.matchStatus || 'raw_only',
      }));
      const filePath = this.reportReferencesArtifactPath(job);
      const dirPath = this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId, 'references');
      await this.remoteFs.mkdir(dirPath);
      await this.remoteFs.writeFile(
        filePath,
        JSON.stringify({
          jobId: job.jobId,
          referenceGuardVersion: 2,
          updatedAt: new Date().toISOString(),
          sourceCount: references.length,
          references,
        }, null, 2),
      );
      job.artifacts = {
        ...job.artifacts,
        reportReferencesPath: filePath,
        reportReferencesCount: references.length,
      };
    } catch (err) {
      console.error('writeReportReferencesArtifact failed:', err instanceof Error ? err.message : err);
    }
  }

  private parseReferenceEntriesRobust(markdown: string): Map<number, Partial<ReportSourceListItem>> {
    const refs = new Map<number, Partial<ReportSourceListItem>>();
    const refsStart = this.findReferenceSectionStart(markdown);
    if (refsStart < 0) return refs;
    const sectionText = markdown.slice(refsStart);
    const boundary = sectionText.search(
      /\n\s*(?:\*\*)?\s*(?:\u6765\u6e90\u53ef\u4fe1\u5ea6\u8bc4\u4f30|\u4fe1\u6e90\u53ef\u4fe1\u5ea6\u8bc4\u4f30|\u4fe1\u606f\u7f3a\u53e3|source credibility assessment|information gaps?)\s*[:\uff1a]?\s*(?:\*\*)?\s*(?=\n|$)/iu,
    );
    const refText = boundary >= 0 ? sectionText.slice(0, boundary) : sectionText;
    const regex = /(?:^|\n)\s*(?:\[(\d{1,3})\]|〔(\d{1,3})〕|【(\d{1,3})】|(\d{1,3})[\u3001.\uff0e])\s*([\s\S]*?)(?=\n\s*(?:\[\d{1,3}\]|〔\d{1,3}〕|【\d{1,3}】|\d{1,3}[\u3001.\uff0e])\s*|$)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(refText)) !== null) {
      const number = Number(match[1] || match[2] || match[3] || match[4]);
      const entry = String(match[5] || '').replace(/\s+/g, ' ').trim();
      if (!number || !entry) continue;
      const url = entry.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;\uff0c\u3002\uff1b\uff09]+$/g, '') || '';
      const title = url ? entry.replace(url, '').trim() : entry;
      refs.set(number, {
        title: this.sanitizeLogText(title || entry, 220),
        url: this.sanitizeLogText(url, 500),
        summary: this.sanitizeLogText(entry, 800),
        rawReferenceText: this.sanitizeLogText(entry, 1200),
      });
    }
    return refs;
  }

  private findReferenceSectionStart(markdown: string): number {
    return markdown.search(
      /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:[\u4e00-\u9fa5]+[\u3001.\uff0e]\s*)?(?:\u53c2\u8003\u6587\u732e|\u53c2\u8003\u8d44\u6599|references)(?:\*\*)?\s*[:\uff1a]?\s*(?:\n|$)/iu,
    );
  }

  private async structuredReportSources(job: JobRecord): Promise<ReportSourceListItem[]> {
    const data = await this.getDatabaseSources(job.jobId);
    return (data?.sources || []).map((source, index) => ({
      id: `structured-${source.url || source.title || index}`,
      sourceGroup: 'structured_sources',
      sourceOrigin: 'database_recall',
      evidenceKind: 'structured_source',
      engine: data?.retrievalMode === 'vector' || data?.retrievalMode === 'hybrid' ? 'pg_vector' : 'database',
      title: source.title || source.url || '未命名信源',
      url: source.url || '',
      sourceName: source.websiteName || '',
      publishTime: source.publishTime || '',
      summary: source.summary || '',
      excerpt: '',
      sourceType: data?.retrievalMode === 'vector' ? '向量召回' : data?.retrievalMode === 'hybrid' ? '混合召回' : '数据库记录',
      relevanceScore: Math.max(95 - index, 1),
      status: 'structured',
      method: data?.retrievalMode === 'vector' ? '向量透明展示' : data?.retrievalMode === 'hybrid' ? '数据库/向量透明展示' : '数据库透明展示',
    }));
  }

  private async crawlerReportSources(job: JobRecord): Promise<ReportSourceListItem[]> {
    const contexts: unknown[] = [];
    const payloadContext = this.contextObjectFromPayload(this.plainObject(job.payload));
    contexts.push(payloadContext.crawlerSourceContext);
    contexts.push(job.artifacts?.crawlerSourceContext);
    const dir = await this.resolveHermesJobDir(job);
    if (dir) {
      const contextJson = await this.readJsonFile(this.remoteFs.joinPath(dir, 'context.json'));
      if (contextJson && !Array.isArray(contextJson)) contexts.push(contextJson.crawlerSourceContext);
      const crawlerJson = await this.readJsonFile(this.remoteFs.joinPath(dir, 'crawler', 'crawler_sources.json'));
      contexts.push(crawlerJson);
    }

    const items: unknown[] = [];
    for (const context of contexts) {
      const object = this.plainObject(context);
      if (Array.isArray(object.items)) items.push(...object.items);
      if (Array.isArray(context)) items.push(...context);
    }

    return items
      .map((item, index) => this.normalizeCrawlerSourceItem(item, index))
      .filter((item): item is ReportSourceListItem => Boolean(item));
  }

  private normalizeCrawlerSourceItem(item: unknown, index: number): ReportSourceListItem | null {
    if (!item || typeof item !== 'object') return null;
    const source = item as Record<string, unknown>;
    const normalized = this.normalizeSourceRecord(source, index, 'crawler');
    const sourcePhase = this.firstString(source, ['sourcePhase', 'source_phase']);
    const method = sourcePhase === 'planning'
      ? '规划页面已选'
      : sourcePhase === 'research'
        ? 'Research Phase 补采'
        : normalized.method || '资料采集工具';
    return {
      ...normalized,
      id: normalized.id || `crawler-${index + 1}`,
      sourceGroup: 'crawler',
      sourceOrigin: 'crawler',
      evidenceKind: 'crawler_source',
      engine: 'crawler',
      title: normalized.title || this.firstString(source, ['title']) || `资料采集来源 ${index + 1}`,
      sourceName: normalized.sourceName || this.firstString(source, ['publisher', 'sourceName']) || '',
      publishTime: normalized.publishTime || this.firstString(source, ['publishedAt', 'published_at', 'fetchedAt']),
      summary: normalized.summary || this.firstString(source, ['contentSummary', 'content_summary', 'summary']),
      excerpt: normalized.excerpt || this.firstString(source, ['contentText', 'content_text']).slice(0, 1200),
      sourceType: '资料采集',
      relevanceScore: normalized.relevanceScore ?? this.firstNumber(source, ['relevanceScore', 'relevance_score']) ?? undefined,
      status: normalized.status || 'collected',
      method,
    };
  }

  private async candidateHitSources(job: JobRecord): Promise<{ items: ReportSourceListItem[]; total: number; detailSaved: boolean }> {
    const data = await this.getDatabaseSources(job.jobId);
    const total = this.candidateHitTotal(data);
    const rawItems = await this.readCandidateSourceItems(job);
    const items = rawItems.map((item, index) => this.normalizeCandidateSourceItem(item, index));
    return {
      items,
      total: total || items.length,
      detailSaved: items.length > 0,
    };
  }

  private async extractFailedSources(job: JobRecord): Promise<ReportSourceListItem[]> {
    const dir = await this.resolveHermesJobDir(job);
    if (!dir) return [];
    const sourcesPath = this.remoteFs.joinPath(dir, 'database', 'database_sources.json');
    const raw = await this.readJsonFile(sourcesPath);
    const items = Array.isArray(raw) ? raw : this.arrayFromObject(raw, ['items', 'sources', 'results', 'data']);
    return items
      .filter((item) => {
        const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const text = `${this.firstString(source, ['status', 'extract_status', 'source_status'])} ${this.firstString(source, ['error', 'message', 'failure_reason', 'failedReason'])}`;
        return /fail|error|失败|错误|不可用/i.test(text);
      })
      .map((item, index) => {
        const source = item as Record<string, unknown>;
        const normalized = this.normalizeSourceRecord(source, index, 'extract_failed');
        return {
          ...normalized,
          status: 'failed',
          failedReason: this.firstString(source, ['failure_reason', 'failedReason', 'error', 'message']),
          sourceType: normalized.sourceType || '抽取失败',
        };
      });
  }

  private async toolSearchSources(job: JobRecord): Promise<ReportSourceListItem[]> {
    const maxResearchFilesPerDirectory = 50;
    const maxEligibleItems = 300;
    const dir = this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    const contextSources: Array<{ item: unknown; evidenceKind: ReportEvidenceKind }> = [];
    const payloadContext = this.contextObjectFromPayload(job.payload as unknown as Record<string, unknown>);
    if (Array.isArray(payloadContext.webSources)) {
      contextSources.push(...payloadContext.webSources.map((item) => ({ item, evidenceKind: 'research_source' as const })));
    }
    const contextJson = await this.readJsonFile(this.remoteFs.joinPath(dir, 'context.json'));
    if (contextJson && !Array.isArray(contextJson) && Array.isArray(contextJson.webSources)) {
      contextSources.push(...contextJson.webSources.map((item) => ({ item, evidenceKind: 'research_source' as const })));
    }
    const rawItems: Array<{ item: unknown; evidenceKind: ReportEvidenceKind }> = [...contextSources];

    for (const researchDir of await this.toolSearchResearchDirs(job)) {
      try {
        const consolidated = await this.readJsonFile(this.remoteFs.joinPath(researchDir, 'consolidated.json'));
        rawItems.push(...this.extractToolSearchRawItems(consolidated));

        const entries = await this.remoteFs.readdir(researchDir);
        let researchFilesRead = 0;
        for (const entry of entries) {
          if (!entry.isFile || !/^research_[a-z0-9_-]+\.json$/i.test(entry.name)) continue;
          if (researchFilesRead >= maxResearchFilesPerDirectory) break;
          researchFilesRead += 1;
          const parsed = await this.readJsonFile(this.remoteFs.joinPath(researchDir, entry.name));
          rawItems.push(...this.extractToolSearchRawItems(parsed));
        }
      } catch {
        // A missing or unreadable research directory must not hide other sources.
      }
    }

    const candidates = rawItems
      .filter(({ item, evidenceKind }) => this.isHighValueToolSearchItem(item, evidenceKind))
      .slice(0, maxEligibleItems)
      .map(({ item, evidenceKind }, index) => ({
        item: item as Record<string, unknown>,
        evidenceKind,
        source: this.normalizeToolSearchSourceItem(item, index, evidenceKind),
      }))
      .filter((candidate): candidate is {
        item: Record<string, unknown>;
        evidenceKind: ReportEvidenceKind;
        source: ReportSourceListItem & { url: string };
      } => typeof candidate.source?.url === 'string' && candidate.source.url.length > 0);
    const deduped = new Map<string, typeof candidates[number]>();
    for (const candidate of candidates) {
      const key = this.canonicalToolSearchUrl(candidate.source.url);
      const existing = deduped.get(key);
      if (!existing || this.preferToolSearchSource(candidate, existing)) {
        deduped.set(key, candidate);
      }
    }

    return this.mergeReportSourceItems([...deduped.values()].map((candidate) => candidate.source), 'tool_search').slice(0, 50);
  }

  private async toolSearchResearchDirs(job: JobRecord): Promise<string[]> {
    const dirs = new Set<string>();
    dirs.add(this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId, 'research'));
    const sharedRoot = String(process.env.HERMES_SHARED_REPORT_ROOT || '').trim();
    if (sharedRoot) dirs.add(this.remoteFs.joinPath(sharedRoot, job.jobId, 'research'));
    try {
      const resolved = await this.resolveHermesJobDir(job);
      if (resolved) dirs.add(this.remoteFs.joinPath(resolved, 'research'));
    } catch {
      // Artifact and shared directories remain usable if legacy job discovery fails.
    }
    return [...dirs];
  }

  private isHighValueToolSearchItem(item: unknown, evidenceKind: ReportEvidenceKind): boolean {
    if (!item || typeof item !== 'object') return false;
    if (evidenceKind === 'evidence_card') return true;
    const source = item as Record<string, unknown>;
    const credibility = this.firstNumber(source, ['credibility_score', 'credibilityScore']) || 0;
    const tier = this.firstString(source, ['credibility_tier', 'credibilityTier']).toLowerCase();
    const quality = source.sourceQuality;
    const qualityObject = quality && typeof quality === 'object' ? quality as Record<string, unknown> : {};
    const qualityScore = typeof quality === 'number'
      ? quality
      : this.firstNumber(qualityObject, ['score']) || 0;
    const accepted = this.firstString(qualityObject, ['status']).toLowerCase() === 'accepted';
    const normalizedQualityScore = qualityScore > 1 ? qualityScore / 100 : qualityScore;
    return credibility >= 0.8 || ['high', 'medium-high'].includes(tier) || accepted || normalizedQualityScore >= 0.8;
  }

  private canonicalToolSearchUrl(value: string): string {
    try {
      const url = new URL(value);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_.+|iref|ref|source)$/i.test(key)) url.searchParams.delete(key);
      }
      url.hostname = url.hostname.toLowerCase();
      return url.toString();
    } catch {
      return value;
    }
  }

  private preferToolSearchSource(
    candidate: { item: Record<string, unknown>; evidenceKind: ReportEvidenceKind; source: ReportSourceListItem },
    existing: { item: Record<string, unknown>; evidenceKind: ReportEvidenceKind; source: ReportSourceListItem },
  ): boolean {
    const candidateEvidence = candidate.evidenceKind === 'evidence_card' ? 1 : 0;
    const existingEvidence = existing.evidenceKind === 'evidence_card' ? 1 : 0;
    if (candidateEvidence !== existingEvidence) return candidateEvidence > existingEvidence;

    const credibility = (item: Record<string, unknown>) =>
      this.firstNumber(item, ['credibility_score', 'credibilityScore']) || 0;
    const candidateCredibility = credibility(candidate.item);
    const existingCredibility = credibility(existing.item);
    if (candidateCredibility !== existingCredibility) return candidateCredibility > existingCredibility;

    const contentLength = (item: Record<string, unknown>) => [
      'summary', 'excerpt', 'content', 'contentText', 'content_text', 'body', 'text',
    ].reduce((length, key) => length + this.firstString(item, [key]).length, 0);
    return contentLength(candidate.item) > contentLength(existing.item);
  }

  private extractToolSearchRawItems(value: unknown, depth = 0): Array<{ item: unknown; evidenceKind: ReportEvidenceKind }> {
    if (!value || depth > 6) return [];
    if (Array.isArray(value)) return value.flatMap((item) => this.extractToolSearchRawItems(item, depth + 1));
    if (typeof value !== 'object') return [];

    const record = value as Record<string, unknown>;
    const result: Array<{ item: unknown; evidenceKind: ReportEvidenceKind }> = [];
    for (const [key, candidate] of Object.entries(record)) {
      const evidenceKind = this.evidenceKindForToolSearchKey(key);
      if (evidenceKind && Array.isArray(candidate)) {
        for (const item of candidate) {
          if (this.isToolSearchRawItem(item, evidenceKind)) result.push({ item, evidenceKind });
        }
      } else if (candidate && typeof candidate === 'object') {
        result.push(...this.extractToolSearchRawItems(candidate, depth + 1));
      }
    }
    return result;
  }

  private evidenceKindForToolSearchKey(key: string): ReportEvidenceKind | null {
    const normalized = key.toLowerCase();
    if (normalized === 'sources' || normalized === 'source_list') return 'research_source';
    if (normalized === 'documents') return 'research_source';
    if (normalized === 'evidence_cards' || normalized === 'evidencecards') return 'evidence_card';
    if (normalized === 'key_findings' || normalized === 'keyfindings' || normalized === 'verification_needed') return 'evidence_card';
    return null;
  }

  private isToolSearchRawItem(item: unknown, evidenceKind?: ReportEvidenceKind): boolean {
    if (!item || typeof item !== 'object') return false;
    const source = item as Record<string, unknown>;
    const haystack = [
      this.firstString(source, ['engine', 'search_engine', 'provider']),
      this.firstString(source, ['method', 'retrievalMode', 'collection_method', 'mode']),
      this.firstString(source, ['source_type', 'type', 'sourceType']),
      this.firstString(source, ['url', 'source_url', 'data_source_url', 'sourceUrl']),
    ].join(' ').toLowerCase();
    return /\b(exa|firecrawl|tavily|tavily_extract)\b/.test(haystack)
      || (evidenceKind === 'evidence_card' && /\bweb_fetch\b/.test(haystack));
  }

  private normalizeToolSearchSourceItem(
    item: unknown,
    index: number,
    evidenceKind: ReportEvidenceKind,
  ): ReportSourceListItem | null {
    if (!item || typeof item !== 'object') return null;
    const source = item as Record<string, unknown>;
    const normalized = this.normalizeSourceRecord(source, index, 'tool_search');
    const inferredEngine = this.inferToolSearchEngine(normalized, source);
    const engine = inferredEngine || (
      evidenceKind === 'evidence_card' && /\bweb_fetch\b/i.test(JSON.stringify(source))
        ? 'tavily_extract'
        : undefined
    );
    if (!engine) return null;
    return {
      ...normalized,
      sourceGroup: 'tool_search',
      sourceOrigin: 'tool_search',
      evidenceKind,
      engine,
      sourceType: this.toolSearchSourceTypeLabel(engine),
      status: normalized.status || this.firstString(source, ['success']) || 'collected',
      method: normalized.method || this.toolSearchMethodLabel(engine),
    };
  }

  private inferDatabaseEngine(item: Partial<ReportSourceListItem>, raw?: Record<string, unknown>): ReportSourceEngine {
    const text = `${item.engine || ''} ${item.sourceType || ''} ${item.method || ''} ${raw ? JSON.stringify(raw).slice(0, 500) : ''}`.toLowerCase();
    return /pg|vector|向量/.test(text) ? 'pg_vector' : 'database';
  }

  private inferToolSearchEngine(item: Partial<ReportSourceListItem>, raw?: Record<string, unknown>): ReportSourceEngine | undefined {
    const text = `${item.engine || ''} ${item.sourceType || ''} ${item.method || ''} ${item.url || ''} ${raw ? JSON.stringify(raw).slice(0, 500) : ''}`.toLowerCase();
    if (/tavily_extract/.test(text)) return 'tavily_extract';
    if (/\bfirecrawl\b/.test(text)) return 'firecrawl';
    if (/\btavily\b/.test(text)) return 'tavily';
    if (/\bexa\b/.test(text)) return 'exa';
    return undefined;
  }

  private toolSearchSourceTypeLabel(engine?: ReportSourceEngine): string {
    if (engine === 'exa') return 'Exa搜索';
    if (engine === 'firecrawl') return 'Firecrawl抽取';
    if (engine === 'tavily_extract') return 'Tavily抽取';
    if (engine === 'tavily') return 'Tavily搜索';
    return '工具调用搜索';
  }

  private toolSearchMethodLabel(engine?: ReportSourceEngine): string {
    if (engine === 'exa') return 'Exa 语义搜索';
    if (engine === 'firecrawl') return 'Firecrawl 内容抽取';
    if (engine === 'tavily_extract') return 'Tavily Extract 内容抽取';
    if (engine === 'tavily') return 'Tavily 实时搜索';
    return '工具调用搜索';
  }

  private candidateHitTotal(data: DatabaseSourcesResponse | undefined): number {
    const queryPlanTotal = (data?.queryPlan.strictHits || 0) + (data?.queryPlan.expandedHits || 0);
    const vectorTotal = data?.vectorPlan?.vectorHits || 0;
    return Math.max(data?.totalHits || 0, queryPlanTotal + vectorTotal);
  }

  private async readCandidateSourceItems(job: JobRecord): Promise<unknown[]> {
    const artifactItems = this.arrayFromObject(job.artifacts, [
      'candidateSources',
      'candidate_hits',
      'candidateHits',
      'retrievalHits',
      'vectorDatabaseCandidateSources',
    ]);
    const fileItems: unknown[] = [];
    const dir = await this.resolveHermesJobDir(job);
    if (dir) {
      const databaseDir = this.remoteFs.joinPath(dir, 'database');
      for (const filename of ['database_candidate_sources.json', 'candidate_sources.json', 'retrieval_hits.json']) {
        const parsed = await this.readJsonFile(this.remoteFs.joinPath(databaseDir, filename));
        if (Array.isArray(parsed)) fileItems.push(...parsed);
        else fileItems.push(...this.arrayFromObject(parsed, ['items', 'sources', 'results', 'data', 'hits', 'candidates']));
      }
      const plan = await this.readJsonFile(this.remoteFs.joinPath(databaseDir, 'database_query_plan.json'));
      fileItems.push(...this.arrayFromObject(plan, [
        'candidateSources',
        'candidate_sources',
        'candidateHits',
        'candidate_hits',
        'retrievalHits',
        'retrieval_hits',
        'hits',
        'candidates',
      ]));
      const databaseDiagnostics = await this.readJsonFile(this.remoteFs.joinPath(databaseDir, 'database_sources_diagnostics.json'));
      const webDiagnostics = await this.readJsonFile(this.remoteFs.joinPath(dir, 'research', 'web_supplement_diagnostics.json'));
      const crawlerDiagnostics = await this.readJsonFile(this.remoteFs.joinPath(dir, 'crawler', 'crawler_sources_diagnostics.json'));
      for (const diagnostics of [databaseDiagnostics, webDiagnostics, crawlerDiagnostics]) {
        if (!diagnostics || Array.isArray(diagnostics)) continue;
        for (const key of [
          'uncertainSources', 'rejectedSources',
          'uncertainWebSources', 'rejectedWebSources',
          'uncertainCrawlerSources', 'rejectedCrawlerSources',
        ]) {
          if (Array.isArray(diagnostics[key])) fileItems.push(...diagnostics[key]);
        }
      }
    }
    return this.dedupeRawSources([...fileItems, ...artifactItems]);
  }

  private normalizeCandidateSourceItem(item: unknown, index: number): ReportSourceListItem {
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const normalized = this.normalizeSourceRecord(source, index, 'candidate_hits');
    const entityMatch = this.plainObject(source.entityMatch || source.entity_match);
    return {
      ...normalized,
      summary: normalized.summary || this.firstString(entityMatch, ['reason']),
      sourceType: normalized.sourceType || '候选命中',
      relevanceScore: this.firstNumber(source, ['relevance_score', 'relevanceScore', 'score', 'similarity', 'rank_score']) ?? normalized.relevanceScore,
      status: this.firstString(entityMatch, ['status']) || this.firstString(source, ['status', 'source_status']) || 'candidate',
      method: this.firstString(source, ['method', 'retrievalMode', 'collection_method']) || '检索阶段候选池',
      candidateStage: this.firstString(source, ['candidateStage', 'candidate_stage', 'stage']),
      hitType: this.firstString(source, ['hitType', 'hit_type', 'type']),
    };
  }

  private normalizeSourceRecord(source: Record<string, unknown>, index: number, sourceGroup: Exclude<ReportSourceListType, 'all'>): ReportSourceListItem {
    const title = this.firstString(source, ['title', 'ch_title', 'headline', 'sourceTitle', 'name']);
    const url = this.firstString(source, ['url', 'source_url', 'data_source_url', 'sourceUrl']);
    const sourceName = this.firstString(source, ['publisher', 'website_name', 'source_name', 'site_name', 'sourceName', 'websiteName']);
    const publishTime = this.firstString(source, ['published_at', 'publish_time', 'pub_time', 'source_time', 'publishTime', 'publishedAt', 'time']);
    const summary = this.firstString(source, ['summary', 'abstract', 'description', 'snippet', 'finding', 'claim', 'content_preview']);
    const excerpt = this.firstString(source, ['excerpt', 'content_excerpt', 'chunk_text', 'content_chunk', 'body', 'content', 'markdown', 'content_preview']);
    const sourceType = this.firstString(source, ['source_type', 'type', 'tag', 'designated_tag', 'sourceType']);
    const score = this.firstNumber(source, ['relevance_score', 'relevanceScore', 'score', 'similarity', 'rank_score', 'credibility_score']);
    const priority = this.firstNumber(source, ['sourcePriority', 'source_priority', 'finalScore', 'final_score']);
    const id = this.firstString(source, ['id', 'sourceId', 'source_id', 'mysql_id']) || `${sourceGroup}-${url || title || index}`;
    const engine = this.firstString(source, ['engine', 'search_engine', 'provider']);
    return {
      id: this.sanitizeLogText(id, 260),
      sourceGroup,
      title: this.sanitizeLogText(title || url || '未命名信源', 220),
      url: this.sanitizeLogText(url, 500),
      sourceName: this.sanitizeLogText(sourceName, 140),
      publishTime: this.sanitizeLogText(publishTime, 80),
      summary: this.sanitizeLogText(summary, 1200),
      excerpt: this.sanitizeLogText(excerpt, 1200),
      sourceType: this.sanitizeLogText(sourceType, 80),
      relevanceScore: score,
      sourcePriority: priority,
      status: this.sanitizeLogText(this.firstString(source, ['status', 'extract_status', 'source_status']), 80),
      method: this.sanitizeLogText(this.firstString(source, ['method', 'retrievalMode', 'collection_method']), 120),
      engine: this.sanitizeLogText(engine, 40) as ReportSourceEngine,
    };
  }

  private async reportMarkdown(job: JobRecord): Promise<string> {
    if (job.markdown) return job.markdown;
    const recovered = await this.readMarkdownFile(job.resultPath || null, job.jobId);
    return recovered?.markdown || '';
  }

  private async reportSourceDiagnostics(job: JobRecord): Promise<Record<string, unknown>> {
    const payloadContext = this.contextObjectFromPayload(job.payload as unknown as Record<string, unknown>);
    const dir = await this.resolveHermesJobDir(job);
    if (dir) {
      const contextJson = await this.readJsonFile(this.remoteFs.joinPath(dir, 'context.json'));
      if (contextJson && !Array.isArray(contextJson)) return this.plainObject(contextJson.sourceDiagnostics);
    }
    return this.plainObject(payloadContext.sourceDiagnostics);
  }

  private parseCitationNumbers(markdown: string): number[] {
    const refsStart = this.findReferenceSectionStart(markdown);
    const body = refsStart >= 0 ? markdown.slice(0, refsStart) : markdown;
    const seen = new Set<number>();
    const numbers: number[] = [];
    const regex = /\[(\d{1,3})\]|〔(\d{1,3})〕|【(\d{1,3})】/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      const number = Number(match[1] || match[2] || match[3]);
      if (!number || seen.has(number)) continue;
      seen.add(number);
      numbers.push(number);
    }
    return numbers.sort((a, b) => a - b);
  }

  private parseReferenceEntries(markdown: string): Map<number, Partial<ReportSourceListItem>> {
    const refs = new Map<number, Partial<ReportSourceListItem>>();
    const refsStart = this.findReferenceSectionStart(markdown);
    if (refsStart < 0) return refs;
    const refText = markdown.slice(refsStart);
    const regex = /\[(\d{1,3})\]\s*([\s\S]*?)(?=\n\s*\[\d{1,3}\]\s*|$)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(refText)) !== null) {
      const number = Number(match[1]);
      const entry = String(match[2] || '').replace(/\s+/g, ' ').trim();
      if (!number || !entry) continue;
      const url = entry.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;，。；）]+$/g, '') || '';
      const title = url ? entry.replace(url, '').trim() : entry;
      refs.set(number, {
        title: this.sanitizeLogText(title || entry, 220),
        url: this.sanitizeLogText(url, 500),
        summary: this.sanitizeLogText(entry, 800),
      });
    }
    return refs;
  }

  private arrayFromObject(value: unknown, keys: string[]): unknown[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const candidate = record[key];
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  }

  private dedupeRawSources(items: unknown[]): unknown[] {
    const seen = new Set<string>();
    const result: unknown[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const source = item as Record<string, unknown>;
      const key = this.firstString(source, ['url', 'source_url', 'data_source_url']) ||
        `${this.firstString(source, ['title', 'ch_title', 'headline'])}|${this.firstString(source, ['summary', 'abstract', 'description'])}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  private async resolveHermesJobDir(job: JobRecord): Promise<string | null> {
    const exactDir = this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId);
    if (job.status === 'queued' || job.status === 'running') return exactDir;

    const fromKnownPath = await this.resolveHermesJobDirFromKnownPaths(job);
    if (fromKnownPath) return fromKnownPath;

    const reportDir = this.remoteFs.remoteDir;
    const entries = await this.remoteFs.readdir(reportDir);
    const createdAtMs = new Date(job.createdAt).getTime();
    const updatedAtMs = new Date(job.updatedAt || job.createdAt).getTime();
    const candidates: Array<{ dir: string; score: number }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(entry.name)) continue;
      const dir = this.remoteFs.joinPath(reportDir, entry.name);
      const planPath = this.remoteFs.joinPath(dir, 'database', 'database_query_plan.json');
      const sourcesPath = this.remoteFs.joinPath(dir, 'database', 'database_sources.json');
      const hasPlan = await this.remoteFs.exists(planPath);
      const hasSources = await this.remoteFs.exists(sourcesPath);
      if (!hasPlan && !hasSources) continue;

      const reportPath = this.remoteFs.joinPath(dir, 'final', 'report.md');
      let mtimeMs = 0;
      try {
        mtimeMs = (await this.remoteFs.stat(reportPath)).mtimeMs;
      } catch {
        try {
          mtimeMs = (await this.remoteFs.stat(hasSources ? sourcesPath : planPath)).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
      }
      if (!mtimeMs) continue;

      const inWindow = mtimeMs >= createdAtMs - 15 * 60_000 && mtimeMs <= updatedAtMs + 15 * 60_000;
      if (!inWindow || !(await this.hermesJobDirHasJobEvidence(dir, job))) continue;
      const proximity = Math.abs(mtimeMs - updatedAtMs);
      const score = proximity;
      candidates.push({ dir, score });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.dir ?? null;
  }

  private async resolveHermesJobDirFromKnownPaths(job: JobRecord): Promise<string | null> {
    const candidates = new Set<string>();
    const addFromText = (value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return;
      for (const dir of this.extractHermesJobDirs(value)) candidates.add(dir);
    };

    addFromText(job.resultPath);
    addFromText(job.markdown);
    for (const entry of job.eventLog || []) {
      addFromText(entry.summary);
      addFromText(entry.command);
      addFromText(entry.detail);
    }
    for (const event of job.events || []) addFromText(JSON.stringify(event));

    for (const dir of candidates) {
      if (await this.hasDatabaseSourceFiles(dir)) return dir;
    }
    return null;
  }

  private hermesJobDirMatchesJob(dir: string, jobId: string): boolean {
    return dir.replace(/\\/g, '/').split('/').filter(Boolean).pop() === jobId;
  }

  private async hermesJobDirHasJobEvidence(dir: string, job: JobRecord): Promise<boolean> {
    if (this.hermesJobDirMatchesJob(dir, job.jobId)) return true;
    try {
      const contextText = await this.remoteFs.readFile(this.remoteFs.joinPath(dir, 'context.json'));
      return contextText.includes(job.jobId);
    } catch {
      return false;
    }
  }

  private extractHermesJobDirs(text: string): string[] {
    const dirs = new Set<string>();
    const normalizedText = text.replace(/\\/g, '/');
    const pathMatches = normalizedText.match(/(?:[A-Za-z]:\/|\/)[^\s"'<>，。；、)）\]]+/g) || [];
    for (const rawPath of pathMatches) {
      const candidate = rawPath.replace(/[.,;:]+$/g, '');
      const dir = this.hermesJobDirFromPath(candidate);
      if (dir) dirs.add(dir);
    }
    return Array.from(dirs);
  }

  private hermesJobDirFromPath(rawPath: string): string | null {
    const filePath = rawPath.replace(/\\/g, '/');
    const reportDir = this.remoteFs.remoteDir.replace(/\\/g, '/').replace(/\/+$/g, '');
    const uuidSegment = '[0-9a-f]{8}-[0-9a-f-]{27}';
    const nestedMatch = filePath.match(new RegExp(`^(.*/${uuidSegment})(?:/|$)`, 'i'));
    if (nestedMatch?.[1]) return nestedMatch[1];

    if (filePath.startsWith(`${reportDir}/`)) {
      const relative = filePath.slice(reportDir.length + 1);
      const firstSegment = relative.split('/')[0] || '';
      if (new RegExp(`^${uuidSegment}$`, 'i').test(firstSegment)) return `${reportDir}/${firstSegment}`;
    }
    return null;
  }

  private async hasDatabaseSourceFiles(dir: string): Promise<boolean> {
    const planPath = this.remoteFs.joinPath(dir, 'database', 'database_query_plan.json');
    const sourcesPath = this.remoteFs.joinPath(dir, 'database', 'database_sources.json');
    return (await this.remoteFs.exists(planPath)) || (await this.remoteFs.exists(sourcesPath));
  }

  private assertUsableGeneratedMarkdown(markdown: string): void {
    const text = String(markdown || '').trim();
    if (!text) throw new Error('未生成有效报告正文。');
    if (/[{｛]\s*(?:jobId|报告名|filename|fileName|actual file name|实际文件名)\s*[}｝]/i.test(text)) {
      throw new Error('生成结果仍是占位内容，未形成正式报告。');
    }
    if (/REPORT_FILE\s*:\s*.+\.json\b/i.test(text) || /\/final\/summary\.json/i.test(text)) {
      throw new Error('生成结果不是正式 Markdown 报告。');
    }
    if (/复制报告到|copy\s+report\s+to/i.test(text) && text.length < 2000) {
      throw new Error('生成结果仍是流程说明，未形成正式报告。');
    }
    if (/^no response from hermes\.?$/i.test(text)) {
      throw new Error('未返回有效响应。');
    }
    if (/agent couldn't generate a response/i.test(text)) {
      throw new Error('未能生成有效响应。');
    }
    if (/quota exhausted|429\s+quota|500\s+internal|internal error/i.test(text) && text.length < 2000) {
      throw new Error(text.slice(0, 300));
    }
    if (text.length < 1000 && !/REPORT_FILE:\s*\/.+\.md/i.test(text)) {
      throw new Error('生成内容不足，未达到编报成稿要求。');
    }
    if (this.hasForbiddenWriteHbPrefaceHeadings(text)) {
      throw new Error('生成结果不符合编报格式要求：不允许单独输出导语或摘要标题。');
    }
  }

  private isValidReportMarkdown(markdown: string, size: number): boolean {
    const text = markdown.trim();
    if (!text) return false;
    if (size < 2000) return false;
    if (/[{｛]\s*(?:jobId|报告名|filename|fileName|actual file name|实际文件名)\s*[}｝]/i.test(text)) return false;
    if (/REPORT_FILE\s*:\s*.+\.json\b/i.test(text) || /\/final\/summary\.json/i.test(text)) return false;
    if (/复制报告到|copy\s+report\s+to/i.test(text) && text.length < 2000) return false;
    if (/^no response from hermes\.?$/i.test(text)) return false;
    if (/agent couldn't generate a response/i.test(text)) return false;
    if (/please try again/i.test(text) && text.length < 1000) return false;
    if (/quota exhausted|429\s+quota|500\s+internal|internal error/i.test(text) && text.length < 2000) return false;
    if (/报告已生成并保存/.test(text) && size < 5000) return false;
    if (this.hasForbiddenWriteHbPrefaceHeadings(text)) return false;
    return true;
  }

  private hasForbiddenWriteHbPrefaceHeadings(markdown: string): boolean {
    const text = String(markdown || '');
    const looksLikeWriteHb =
      /\*\*编号：\*\*\s*[KH]-\d{8}-\d{3}/.test(text) ||
      /##\s*\*\*一、基本情况\*\*/.test(text) ||
      /##\s*\*\*二、涉我风险/.test(text) ||
      /##\s*\*\*三、对策建议/.test(text) ||
      /##\s*\*\*一、事件概述\*\*/.test(text);
    if (!looksLikeWriteHb) return false;

    const beforeFirstSection = text.split(/##\s*\*\*一、(?:基本情况|事件概述)\*\*/)[0] || text;
    return /(?:^|\n)\s{0,3}#{1,6}\s*(?:导语|摘要|导语\s*[/／、-]\s*摘要|摘要\s*导语)\s*(?:\n|$)/.test(beforeFirstSection) ||
      /(?:^|\n)\s*(?:导语|摘要|导语\s*[/／、-]\s*摘要|摘要\s*导语)\s*(?:\n|$)/.test(beforeFirstSection);
  }

  private buildRequestUser(job: JobRecord): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const key = `${y}${m}${d}`;
    const next = (this.dailySequence.get(key) ?? 0) + 1;
    this.dailySequence.set(key, next);
    return `report-task-${key}-${String(next).padStart(3, '0')}-${job.jobId.slice(0, 8)}`;
  }

  private async renderMarkdownToHtml(markdown: string): Promise<string> {
    const parsed = marked(this.normalizeMarkdownStrongMarkers(markdown || ''));
    return typeof parsed === 'string' ? parsed : await parsed;
  }

  private normalizeMarkdownStrongMarkers(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    let inFence = false;

    return lines
      .map((line) => {
        if (/^\s*```/.test(line)) {
          inFence = !inFence;
          return line;
        }
        if (inFence || !line.includes('**')) return line;

        const inlineCode: string[] = [];
        const masked = line.replace(/(`+)([^`]*?)\1/g, (match) => {
          inlineCode.push(match);
          return `\u0000CODE${inlineCode.length - 1}\u0000`;
        });

        const normalized = masked.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
        return normalized.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => inlineCode[Number(index)] || '');
      })
      .join('\n');
  }
}
