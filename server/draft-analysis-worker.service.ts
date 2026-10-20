import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DraftAnalysisJobsService } from './draft-analysis-jobs.service.js';

@Injectable()
export class DraftAnalysisWorkerService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private stopped = false;
  private running = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  constructor(@Inject(DraftAnalysisJobsService) private readonly jobs: DraftAnalysisJobsService) {}
  async onModuleInit() {
    await this.jobs.initialize();
    this.timer = setInterval(() => { void this.tick(); }, 1000);
    this.timer.unref();
    await this.tick();
  }
  async tick() {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      await this.jobs.expire();
      while (!this.stopped && this.running.size < 2) {
        const row = await this.jobs.claim();
        if (!row) break;
        const controller = new AbortController();
        const promise = this.run(row, controller).finally(() => this.running.delete(String(row.job_id)));
        this.running.set(String(row.job_id), { controller, promise });
      }
    } catch {
      console.error('Draft analysis worker could not poll its queue');
    } finally { this.ticking = false; }
  }
  private async run(row: Record<string, unknown>, controller: AbortController) {
    const deadlineAt = (row.deadline_at instanceof Date ? row.deadline_at : new Date(String(row.deadline_at))).getTime();
    const timeout = setTimeout(() => controller.abort(new Error('DRAFT_ANALYSIS_TIMEOUT')), Math.max(0, deadlineAt - Date.now()));
    const heartbeat = setInterval(() => {
      void this.jobs.heartbeat(row).then((valid) => {
        if (!valid) controller.abort(new Error('DRAFT_ANALYSIS_INTERRUPTED'));
      }).catch(() => controller.abort(new Error('DRAFT_ANALYSIS_INTERRUPTED')));
    }, 10_000);
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    try {
      await Promise.race([this.jobs.execute(row, controller.signal), aborted]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = ['DRAFT_ANALYSIS_TIMEOUT', 'DRAFT_ANALYSIS_INTERRUPTED'].includes(message) ? message : 'DRAFT_ANALYSIS_FAILED';
      await this.jobs.fail(row, code).catch(() => undefined);
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      controller.signal.removeEventListener('abort', rejectAbort);
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const item of this.running.values()) item.controller.abort(new Error('DRAFT_ANALYSIS_INTERRUPTED'));
    await Promise.allSettled([...this.running.values()].map((item) => item.promise));
  }
}
