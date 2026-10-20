import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AuthUser } from './auth-user.interface.js';
import { createAuthPool, type PgClient, type PgPool } from './auth-database.js';
import { DraftAssistantService } from './draft-assistant.service.js';
import type { DraftAnalyzeInput } from './draft-assistant.types.js';
import { DRAFT_ANALYSIS_SCHEMA, draftAnalysisJob, type DraftAnalysisJob } from './draft-analysis-schema.js';
import { withOperationBudget } from './operation-budget.js';

const ACTIVE = "status IN ('queued','running')";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Submission = DraftAnalyzeInput & { clientRequestId?: string };

@Injectable()
export class DraftAnalysisJobsService implements OnModuleInit, OnModuleDestroy {
  private pool: PgPool | null = null;
  private initialized: Promise<void> | null = null;
  constructor(@Inject(DraftAssistantService) private readonly drafts: DraftAssistantService) {}

  async onModuleInit() { await this.initialize(); }
  async onModuleDestroy() { if (this.pool) await this.pool.end(); }
  private db() { return this.pool ||= createAuthPool({ max: 6, statement_timeout: 5000 }); }
  initialize() {
    return this.initialized ||= this.db().query(DRAFT_ANALYSIS_SCHEMA).then(() => undefined);
  }
  private id(value: string | undefined) {
    if (!value || !UUID.test(value)) throw new BadRequestException({ error: '无效的任务标识' });
    return value;
  }
  private async transaction<T>(fn: (db: PgClient) => Promise<T>): Promise<T> {
    await this.initialize();
    const db = await this.db().connect();
    try {
      await db.query('BEGIN');
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { db.release(); }
  }

  async submit(input: Submission, user: AuthUser, retryJobId?: string): Promise<DraftAnalysisJob> {
    const requestId = this.id(input.clientRequestId);
    return this.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 61901))', [user.id]);
      let eventId = '';
      let normalized;
      if (retryJobId) {
        const previous = (await db.query('SELECT * FROM draft_analysis_jobs WHERE job_id=$1 AND owner_id=$2', [this.id(retryJobId), user.id])).rows[0];
        if (!previous) throw new NotFoundException({ error: '分析任务不存在' });
        normalized = previous.input_json as ReturnType<DraftAssistantService['normalizeAnalyzeInput']>;
        eventId = String(previous.event_id);
      } else normalized = this.drafts.normalizeAnalyzeInput(input);
      const hash = createHash('sha256').update(JSON.stringify({ input: normalized, retryJobId: retryJobId || null })).digest('hex');
      const existing = (await db.query('SELECT * FROM draft_analysis_jobs WHERE owner_id=$1 AND client_request_id=$2', [user.id, requestId])).rows[0];
      if (existing) {
        if (existing.input_hash !== hash) throw new ConflictException({ code: 'DRAFT_REQUEST_MISMATCH', error: '同一请求标识不能提交不同材料' });
        return draftAnalysisJob(existing)!;
      }
      const active = (await db.query(`SELECT * FROM draft_analysis_jobs WHERE owner_id=$1 AND ${ACTIVE}`, [user.id])).rows[0];
      if (active) throw new ConflictException({ code: 'DRAFT_ANALYSIS_ACTIVE', error: '已有一条事件分析正在进行', job: draftAnalysisJob(active) });
      if (eventId) {
        const latest = (await db.query('SELECT * FROM draft_analysis_jobs WHERE event_id=$1 ORDER BY created_at DESC LIMIT 1', [eventId])).rows[0];
        if (latest?.status !== 'failed' || latest.job_id !== retryJobId) throw new ConflictException({ error: '只能重试最近一次失败的分析' });
      } else {
        const result = await db.query(
          'INSERT INTO events(owner_id,title,category,region,raw_input) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING event_id',
          [user.id, normalized.title, normalized.category || null, normalized.region || null, JSON.stringify(normalized)],
        );
        eventId = String(result.rows[0].event_id);
      }
      const result = await db.query(
        `INSERT INTO draft_analysis_jobs(event_id,owner_id,client_request_id,input_hash,input_json)
         VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *`,
        [eventId, user.id, requestId, hash, JSON.stringify(normalized)],
      );
      return draftAnalysisJob(result.rows[0])!;
    });
  }

  async list(user: AuthUser, requestId?: string) {
    await this.initialize();
    const rows = await this.db().query(
      `SELECT * FROM draft_analysis_jobs WHERE owner_id=$1 ${requestId ? 'AND client_request_id=$2' : ''}
       ORDER BY created_at DESC LIMIT 20`, requestId ? [user.id, this.id(requestId)] : [user.id],
    );
    return { items: rows.rows.map(draftAnalysisJob) };
  }
  async get(jobId: string, user: AuthUser) {
    await this.initialize();
    const row = (await this.db().query('SELECT * FROM draft_analysis_jobs WHERE job_id=$1 AND owner_id=$2', [this.id(jobId), user.id])).rows[0];
    if (!row) throw new NotFoundException({ error: '分析任务不存在' });
    return draftAnalysisJob(row)!;
  }
  async analyzeSync(input: Submission, user: AuthUser) {
    let job = await this.submit({ ...input, clientRequestId: input.clientRequestId || randomUUID() }, user);
    while (['queued', 'running'].includes(job.status)) {
      await delay(250);
      await this.expire();
      job = await this.get(job.jobId, user);
    }
    if (job.status === 'failed') throw new ServiceUnavailableException({ code: job.errorCode, error: job.errorMessage });
    const result = await this.drafts.getEvent(job.eventId, user);
    return { eventId: job.eventId, analysis: result.event.analysis, sources: result.sources };
  }
  async expire() {
    await this.initialize();
    await this.db().query(
      `UPDATE draft_analysis_jobs SET status='failed', completed_at=clock_timestamp(), slot=NULL,
         error_code=CASE WHEN deadline_at <= clock_timestamp() THEN 'DRAFT_ANALYSIS_TIMEOUT' ELSE 'DRAFT_ANALYSIS_INTERRUPTED' END,
         error_message=CASE WHEN deadline_at <= clock_timestamp() THEN '事件分析超过两分钟，请重试分析。' ELSE '分析执行已中断，请重试分析。' END
       WHERE ${ACTIVE} AND (deadline_at <= clock_timestamp() OR
         (status='running' AND heartbeat_at < clock_timestamp()-interval '45 seconds'))`,
    );
  }
  async claim() {
    return this.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(61901002)');
      const slot = (await db.query("SELECT n FROM generate_series(1,2) n WHERE NOT EXISTS (SELECT 1 FROM draft_analysis_jobs WHERE status='running' AND slot=n) ORDER BY n LIMIT 1")).rows[0];
      if (!slot) return null;
      const row = (await db.query("SELECT job_id FROM draft_analysis_jobs WHERE status='queued' AND deadline_at > clock_timestamp() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
      if (!row) return null;
      return (await db.query(
        `UPDATE draft_analysis_jobs SET status='running',step='retrieving',started_at=clock_timestamp(),
           heartbeat_at=clock_timestamp(),lease_token=$2,slot=$3 WHERE job_id=$1 RETURNING *`,
        [row.job_id, randomUUID(), slot.n],
      )).rows[0];
    });
  }
  async execute(row: Record<string, unknown>, signal: AbortSignal) {
    const jobId = String(row.job_id), lease = String(row.lease_token);
    const deadlineAt = (row.deadline_at instanceof Date ? row.deadline_at : new Date(String(row.deadline_at))).getTime();
    const assertLease = async (db: Pick<PgPool, 'query'>) => {
      signal.throwIfAborted();
      const found = await db.query(
        `SELECT job_id FROM draft_analysis_jobs WHERE job_id=$1 AND lease_token=$2 AND status='running'
         AND deadline_at > clock_timestamp() AND heartbeat_at > clock_timestamp()-interval '45 seconds' FOR UPDATE`,
        [jobId, lease],
      );
      if (!found.rows.length) throw new Error('DRAFT_ANALYSIS_INTERRUPTED');
    };
    await withOperationBudget({ signal, deadlineAt }, async () => {
      const prepared = await this.drafts.prepareAnalysis(row.input_json as DraftAnalyzeInput, async (step) => {
        const updated = await this.db().query(
          "UPDATE draft_analysis_jobs SET step=$3 WHERE job_id=$1 AND lease_token=$2 AND status='running' AND deadline_at>clock_timestamp() RETURNING job_id",
          [jobId, lease, step],
        );
        if (!updated.rows.length) throw new Error('DRAFT_ANALYSIS_INTERRUPTED');
      });
      await this.db().query("UPDATE draft_analysis_jobs SET step='saving' WHERE job_id=$1 AND lease_token=$2 AND status='running'", [jobId, lease]);
      await this.transaction(async (db) => {
        await db.query("SELECT set_config('statement_timeout',$1,true)", [String(Math.max(1, Math.min(5000, deadlineAt - Date.now())))]);
        await assertLease(db);
        await this.drafts.savePreparedAnalysis(String(row.event_id), String(row.owner_id), prepared, db);
        await assertLease(db);
        const completed = await db.query(
          `UPDATE draft_analysis_jobs SET status='succeeded',step='completed',completed_at=clock_timestamp(),slot=NULL
           WHERE job_id=$1 AND lease_token=$2 AND status='running' AND deadline_at>clock_timestamp() RETURNING job_id`, [jobId, lease]);
        if (!completed.rows.length) throw new Error('DRAFT_ANALYSIS_TIMEOUT');
      });
    });
  }
  async heartbeat(row: Record<string, unknown>) {
    const result = await this.db().query(
      `UPDATE draft_analysis_jobs SET heartbeat_at=clock_timestamp() WHERE job_id=$1 AND lease_token=$2
       AND status='running' AND deadline_at>clock_timestamp() RETURNING job_id`, [row.job_id, row.lease_token],
    );
    return result.rows.length > 0;
  }
  async fail(row: Record<string, unknown>, code: string) {
    const message = code === 'DRAFT_ANALYSIS_TIMEOUT' ? '事件分析超过两分钟，请重试分析。'
      : code === 'DRAFT_ANALYSIS_INTERRUPTED' ? '分析执行已中断，请重试分析。' : '事件分析执行失败，请稍后重试分析。';
    await this.db().query(
      "UPDATE draft_analysis_jobs SET status='failed',completed_at=clock_timestamp(),slot=NULL,error_code=$3,error_message=$4 WHERE job_id=$1 AND lease_token=$2 AND status='running'",
      [row.job_id, row.lease_token, code, message],
    );
  }
}
