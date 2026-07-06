import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import dns from 'node:dns/promises';
import net from 'node:net';
import { createAuthPool, type PgPool } from './auth-database.js';
import type { AuthUser } from './auth-user.interface.js';
import type { CreateCrawlerTaskInput, CrawlerItemResponse, CrawlerPlan, CrawlerTaskResponse } from './crawler.types.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PAGES_LIMIT = 50;
const MAX_DEPTH_LIMIT = 2;

export class CrawlerSecurityError extends BadRequestException {}

@Injectable()
export class CrawlerService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async createTaskForUser(input: CreateCrawlerTaskInput, user: AuthUser): Promise<CrawlerTaskResponse> {
    const payload = {
      ...input,
      ownerId: user.id,
      ownerUsername: user.username,
    };
    return this.createTask(payload);
  }

  async createTask(input: CreateCrawlerTaskInput): Promise<CrawlerTaskResponse> {
    const normalized = this.normalizeTaskInput(input);
    await this.validateCrawlerPlan(normalized.crawlerPlan);
    const pool = await this.getPool();
    const result = await pool.query(
      `INSERT INTO crawler_tasks
        (owner_id, owner_username, job_id, title, goal, status, crawler_plan, max_pages, max_depth)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6::jsonb, $7, $8)
       RETURNING *`,
      [
        normalized.ownerId,
        normalized.ownerUsername,
        normalized.jobId,
        normalized.title,
        normalized.goal,
        JSON.stringify(normalized.crawlerPlan),
        normalized.maxPages,
        normalized.maxDepth,
      ],
    );
    const task = this.toTask(result.rows[0]);
    await this.log(task.taskId, 'info', '资料采集工具：已创建采集任务', { jobId: task.jobId, maxPages: task.maxPages });
    return task;
  }

  async listTasks(user: AuthUser): Promise<{ items: CrawlerTaskResponse[] }> {
    const pool = await this.getPool();
    const params: unknown[] = [];
    const ownerClause = this.isAdmin(user) ? '' : 'WHERE owner_id = $1';
    if (!this.isAdmin(user)) params.push(user.id);
    const result = await pool.query(
      `SELECT * FROM crawler_tasks ${ownerClause} ORDER BY created_at DESC LIMIT 100`,
      params,
    );
    return { items: result.rows.map((row) => this.toTask(row)) };
  }

  async getTask(taskId: string, user: AuthUser): Promise<CrawlerTaskResponse> {
    const task = await this.findTask(taskId);
    this.assertTaskAccess(task, user);
    return task;
  }

  async deleteTask(taskId: string, user: AuthUser): Promise<{ deleted: true }> {
    const task = await this.findTask(taskId);
    this.assertTaskAccess(task, user);
    const pool = await this.getPool();
    await pool.query('DELETE FROM crawler_tasks WHERE task_id = $1', [taskId]);
    return { deleted: true };
  }

  async listItems(taskId: string, user: AuthUser): Promise<{ items: CrawlerItemResponse[] }> {
    const task = await this.findTask(taskId);
    this.assertTaskAccess(task, user);
    return this.listItemsInternal(taskId);
  }

  async listItemsInternal(taskId: string): Promise<{ items: CrawlerItemResponse[] }> {
    const pool = await this.getPool();
    const result = await pool.query('SELECT * FROM crawler_items WHERE task_id = $1 ORDER BY created_at ASC', [taskId]);
    return { items: result.rows.map((row) => this.toItem(row)) };
  }

  async runTaskForUser(taskId: string, user: AuthUser): Promise<{ task: CrawlerTaskResponse; items: CrawlerItemResponse[] }> {
    const task = await this.findTask(taskId);
    this.assertTaskAccess(task, user);
    return this.runTask(taskId);
  }

  async runTask(taskId: string): Promise<{ task: CrawlerTaskResponse; items: CrawlerItemResponse[] }> {
    const task = await this.findTask(taskId);
    const pool = await this.getPool();
    await pool.query(
      `UPDATE crawler_tasks
       SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now(), error_message = NULL
       WHERE task_id = $1`,
      [taskId],
    );
    await this.log(taskId, 'info', '资料采集工具：开始执行受控采集', { jobId: task.jobId });

    try {
      const urls = await this.buildSeedUrls(task.crawlerPlan, task.maxPages);
      const items: CrawlerItemResponse[] = [];
      for (const url of urls.slice(0, task.maxPages)) {
        try {
          await this.assertSafeUrl(url);
          const fetched = await this.fetchPublicPage(url);
          const inserted = await this.insertItem(task, fetched);
          items.push(inserted);
          await this.log(taskId, 'info', '资料采集工具：已采集公开页面', { url });
        } catch (error) {
          await this.log(taskId, 'warn', '资料采集工具：跳过不安全或不可采集页面', {
            url,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const status = items.length ? 'completed' : 'failed';
      const errorMessage = items.length ? null : 'No safe public pages were collected';
      const updated = await pool.query(
        `UPDATE crawler_tasks
         SET status = $2, error_message = $3, finished_at = now(), updated_at = now()
         WHERE task_id = $1
         RETURNING *`,
        [taskId, status, errorMessage],
      );
      await this.log(taskId, items.length ? 'info' : 'error', items.length ? '资料采集工具：采集完成' : '资料采集工具：未采集到可用页面', { itemCount: items.length });
      return { task: this.toTask(updated.rows[0]), items };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = await pool.query(
        `UPDATE crawler_tasks
         SET status = 'failed', error_message = $2, finished_at = now(), updated_at = now()
         WHERE task_id = $1
         RETURNING *`,
        [taskId, message],
      );
      await this.log(taskId, 'error', '资料采集工具：采集失败', { error: message });
      return { task: this.toTask(updated.rows[0]), items: [] };
    }
  }

  assertInternalToken(token: unknown) {
    const expected = process.env.INTERNAL_SKILL_TOKEN || '';
    if (!expected || String(token || '') !== expected) {
      throw new UnauthorizedException({ error: 'Invalid internal skill token' });
    }
  }

  private normalizeTaskInput(input: CreateCrawlerTaskInput) {
    const planningSessionId = String(input.planningSessionId || '').trim();
    const sourcePhase = String(input.sourcePhase || '').trim() === 'planning' ? 'planning' : undefined;
    const jobId = String(input.jobId || (sourcePhase === 'planning' ? `planning:${planningSessionId || Date.now()}` : '')).trim();
    const ownerId = String(input.ownerId || '').trim();
    if (!jobId) throw new BadRequestException({ error: 'jobId is required' });
    if (!ownerId) throw new BadRequestException({ error: 'ownerId is required' });
    const crawlerPlan = this.normalizeCrawlerPlan(input.crawlerPlan);
    if (sourcePhase === 'planning') {
      crawlerPlan.executePhase = 'planning';
      crawlerPlan.sourcePhase = 'planning';
      crawlerPlan.planningSessionId = planningSessionId;
      crawlerPlan.reportTitle = String(input.reportTitle || input.title || '').trim();
      crawlerPlan.alreadyExecuted = false;
      crawlerPlan.allowFurtherCollectionInResearch = false;
    }
    const maxPages = this.boundInt(input.maxPages ?? crawlerPlan.maxPages, 10, 1, MAX_PAGES_LIMIT);
    const maxDepth = this.boundInt(input.maxDepth ?? crawlerPlan.maxDepth, 1, 0, MAX_DEPTH_LIMIT);
    crawlerPlan.maxPages = maxPages;
    crawlerPlan.maxDepth = maxDepth;
    return {
      ownerId,
      ownerUsername: String(input.ownerUsername || '').trim(),
      jobId,
      title: String(input.title || crawlerPlan.goal || '资料采集任务').trim().slice(0, 512),
      goal: String(input.goal || crawlerPlan.goal || '').trim(),
      crawlerPlan,
      maxPages,
      maxDepth,
    };
  }

  private normalizeCrawlerPlan(value: unknown): CrawlerPlan {
    const plan = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
      enabled: plan.enabled === true,
      mode: ['auto', 'manual', 'hybrid'].includes(String(plan.mode)) ? plan.mode as CrawlerPlan['mode'] : 'hybrid',
      goal: String(plan.goal || '').trim(),
      autoGapFilling: plan.autoGapFilling !== false,
      directions: Array.isArray(plan.directions)
        ? plan.directions.map((item, index) => {
          const direction = item && typeof item === 'object' ? item as Record<string, unknown> : {};
          return {
            name: String(direction.name || `采集方向 ${index + 1}`).trim(),
            enabled: direction.enabled !== false,
            description: String(direction.description || '').trim(),
            queries: this.stringList(direction.queries, 12),
            targetDomains: this.stringList(direction.targetDomains, 12),
          };
        }).slice(0, 12)
        : [],
      manualUrls: this.stringList(plan.manualUrls, 50),
      manualDomains: this.stringList(plan.manualDomains, 50),
      manualKeywords: this.stringList(plan.manualKeywords, 50),
      maxPages: this.boundInt(plan.maxPages, 10, 1, MAX_PAGES_LIMIT),
      maxDepth: this.boundInt(plan.maxDepth, 1, 0, MAX_DEPTH_LIMIT),
      lookbackHours: this.optionalBoundInt(plan.lookbackHours, 1, 720),
      language: String(plan.language || 'zh-CN').trim() || 'zh-CN',
      executePhase: String(plan.executePhase || '') === 'planning' ? 'planning' : 'research',
      alreadyExecuted: plan.alreadyExecuted === true,
      allowFurtherCollectionInResearch: plan.allowFurtherCollectionInResearch === true,
      planningSessionId: String(plan.planningSessionId || '').trim(),
      sourcePhase: String(plan.sourcePhase || '') === 'planning' ? 'planning' : 'research',
      reportTitle: String(plan.reportTitle || '').trim(),
    };
  }

  private async validateCrawlerPlan(plan: CrawlerPlan) {
    for (const url of plan.manualUrls) await this.assertSafeUrl(url);
    for (const domain of plan.manualDomains) {
      const normalized = domain.includes('://') ? domain : `https://${domain}`;
      await this.assertSafeUrl(normalized);
    }
    for (const direction of plan.directions) {
      for (const domain of direction.targetDomains) {
        const normalized = domain.includes('://') ? domain : `https://${domain}`;
        await this.assertSafeUrl(normalized);
      }
    }
  }

  private async buildSeedUrls(plan: CrawlerPlan, maxPages: number): Promise<string[]> {
    const urls = [...plan.manualUrls];
    for (const domain of plan.manualDomains) urls.push(domain.includes('://') ? domain : `https://${domain}`);
    for (const direction of plan.directions.filter((item) => item.enabled)) {
      for (const domain of direction.targetDomains) urls.push(domain.includes('://') ? domain : `https://${domain}`);
    }
    return Array.from(new Set(urls)).slice(0, maxPages);
  }

  private async assertSafeUrl(rawUrl: string) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new CrawlerSecurityError({ error: 'Invalid URL' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new CrawlerSecurityError({ error: 'Only http/https URLs are allowed' });
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || ['localhost', 'localhost.localdomain'].includes(hostname)) {
      throw new CrawlerSecurityError({ error: 'Localhost is not allowed' });
    }
    if (this.isPrivateIp(hostname)) throw new CrawlerSecurityError({ error: 'Private network URL is not allowed' });
    const records = await this.resolveHostname(hostname);
    for (const address of records) {
      if (this.isPrivateIp(address)) throw new CrawlerSecurityError({ error: 'Private network URL is not allowed' });
    }
  }

  private async resolveHostname(hostname: string): Promise<string[]> {
    if (net.isIP(hostname)) return [hostname];
    try {
      const results = await dns.lookup(hostname, { all: true, verbatim: true });
      return results.map((item) => item.address);
    } catch {
      return [];
    }
  }

  private isPrivateIp(value: string): boolean {
    const ipType = net.isIP(value);
    if (ipType === 4) {
      const parts = value.split('.').map((part) => Number(part));
      const [a, b] = parts;
      return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    }
    if (ipType === 6) {
      const normalized = value.toLowerCase();
      return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
    }
    return false;
  }

  private async fetchPublicPage(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
          'User-Agent': 'HermesControlledWebCollector/1.0',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
      }
      const html = await response.text();
      const text = this.htmlToText(html).slice(0, 30_000);
      return {
        url: response.url || url,
        title: this.extractTitle(html) || new URL(response.url || url).hostname,
        publisher: new URL(response.url || url).hostname,
        publishedAt: null,
        contentText: text,
        contentSummary: text.slice(0, 1000),
        metadata: { contentType, fetchedBy: 'controlled-web-collector' },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async insertItem(task: CrawlerTaskResponse, item: {
    url: string;
    title: string;
    publisher: string;
    publishedAt: string | null;
    contentText: string;
    contentSummary: string;
    metadata: Record<string, unknown>;
  }): Promise<CrawlerItemResponse> {
    const pool = await this.getPool();
    const result = await pool.query(
      `INSERT INTO crawler_items
        (task_id, owner_id, job_id, url, title, publisher, published_at, content_text, content_summary, metadata, relevance_score, credibility_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       RETURNING *`,
      [
        task.taskId,
        task.ownerId,
        task.jobId,
        item.url,
        item.title,
        item.publisher,
        item.publishedAt,
        item.contentText,
        item.contentSummary,
        JSON.stringify({
          ...item.metadata,
          sourcePhase: task.crawlerPlan.sourcePhase || task.crawlerPlan.executePhase || 'research',
          planningSessionId: task.crawlerPlan.planningSessionId || '',
        }),
        50,
        50,
      ],
    );
    return this.toItem(result.rows[0]);
  }

  private async findTask(taskId: string): Promise<CrawlerTaskResponse> {
    const pool = await this.getPool();
    const result = await pool.query('SELECT * FROM crawler_tasks WHERE task_id = $1', [taskId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ error: 'Crawler task not found' });
    return this.toTask(row);
  }

  private assertTaskAccess(task: CrawlerTaskResponse, user: AuthUser) {
    if (this.isAdmin(user)) return;
    if (task.ownerId && task.ownerId === user.id) return;
    throw new ForbiddenException({ error: 'Insufficient crawler task permissions' });
  }

  private async log(taskId: string, level: string, message: string, detail: Record<string, unknown> = {}) {
    const pool = await this.getPool();
    await pool.query(
      'INSERT INTO crawler_task_logs (task_id, level, message, detail) VALUES ($1, $2, $3, $4::jsonb)',
      [taskId, level, message, JSON.stringify(detail)],
    );
  }

  private toTask(row: Record<string, unknown>): CrawlerTaskResponse {
    return {
      taskId: String(row.task_id),
      ownerId: row.owner_id ? String(row.owner_id) : null,
      ownerUsername: String(row.owner_username || ''),
      jobId: String(row.job_id || ''),
      title: String(row.title || ''),
      goal: String(row.goal || ''),
      status: String(row.status || 'pending'),
      crawlerPlan: this.normalizeCrawlerPlan(row.crawler_plan),
      maxPages: Number(row.max_pages || 10),
      maxDepth: Number(row.max_depth || 1),
      errorMessage: row.error_message ? String(row.error_message) : null,
      createdAt: this.dateString(row.created_at),
      updatedAt: this.dateString(row.updated_at),
      startedAt: row.started_at ? this.dateString(row.started_at) : null,
      finishedAt: row.finished_at ? this.dateString(row.finished_at) : null,
    };
  }

  private toItem(row: Record<string, unknown>): CrawlerItemResponse {
    return {
      itemId: String(row.item_id),
      taskId: String(row.task_id),
      ownerId: row.owner_id ? String(row.owner_id) : null,
      jobId: String(row.job_id || ''),
      url: String(row.url || ''),
      title: String(row.title || ''),
      publisher: String(row.publisher || ''),
      publishedAt: row.published_at ? this.dateString(row.published_at) : null,
      fetchedAt: this.dateString(row.fetched_at),
      contentText: String(row.content_text || ''),
      contentSummary: String(row.content_summary || ''),
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
      relevanceScore: row.relevance_score == null ? null : Number(row.relevance_score),
      credibilityScore: row.credibility_score == null ? null : Number(row.credibility_score),
      sourceType: 'crawler',
      createdAt: this.dateString(row.created_at),
    };
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? this.htmlToText(match[1]).slice(0, 500) : '';
  }

  private stringList(value: unknown, limit: number): string[] {
    const source = Array.isArray(value) ? value : String(value || '').split(/\r?\n|[；;,，]/);
    return Array.from(new Set(source.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, limit);
  }

  private boundInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  }

  private optionalBoundInt(value: unknown, min: number, max: number): number | null {
    if (value === null || value === undefined || value === '') return null;
    return this.boundInt(value, min, min, max);
  }

  private dateString(value: unknown): string {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString();
    const date = new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
  }

  private isAdmin(user: AuthUser): boolean {
    return user.role === 'admin' || user.roles?.includes('admin');
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }
}
