import { Body, Controller, Delete, Get, Header, HttpException, HttpStatus, Inject, Param, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';
import { ReportsService } from './reports.service.js';
import type { CreateJobRequest } from '../src/types/report.js';
import type { ServerEvent } from './types.js';

@Controller('/api/report-jobs')
@UseGuards(AuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Post()
  @RequirePermissions('report:create')
  create(@Body() body: CreateJobRequest, @CurrentUser() user: AuthUser) {
    if (!body.skill || !body.payload) {
      throw new HttpException({ error: 'Missing skill or payload' }, HttpStatus.BAD_REQUEST);
    }
    return this.reports.createJob(body, user);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('type') type?: string,
    @Query('q') q?: string,
    @Query('mine') mine?: string,
    @Query('trash') trash?: string,
  ) {
    return this.reports.listJobs({ page, pageSize, type, q, mine, trash }, user);
  }

  @Get(':jobId')
  async get(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const job = await this.reports.getJobWithRecoveredReport(jobId, user);
    if (!job) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return this.reports.serializeJob(job);
  }

  @Post(':jobId/cancel')
  async cancel(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const job = await this.reports.cancelJob(jobId, user);
    if (!job) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return this.reports.serializeJob(job);
  }

  @Delete(':jobId')
  @RequirePermissions('report:delete')
  async delete(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const job = await this.reports.deleteJob(jobId, user);
    if (!job) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return this.reports.serializeJob(job);
  }

  @Post(':jobId/edits')
  @RequirePermissions('report:update')
  createReportEdit(@Param('jobId') jobId: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.reports.createReportEdit(jobId, user, body || {});
  }

  @Get(':jobId/edits')
  async listReportEdits(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.reports.listReportEdits(jobId, user);
  }

  @Post(':jobId/edits/:editId/apply')
  @RequirePermissions('report:update')
  applyReportEdit(@Param('jobId') jobId: string, @Param('editId') editId: string, @CurrentUser() user: AuthUser) {
    return this.reports.applyReportEdit(jobId, user, editId);
  }

  @Post(':jobId/restore')
  async restore(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const job = await this.reports.restoreJob(jobId, user);
    if (!job) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return this.reports.serializeJob(job);
  }

  @Delete(':jobId/permanent')
  async permanentDelete(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.reports.permanentlyDeleteJob(jobId, user);
  }

  @Get(':jobId/progress')
  async progress(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const result = await this.reports.getProgressState(jobId, user);
    if (!result) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get(':jobId/event-log')
  eventLog(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const result = this.reports.getEventLog(jobId, user);
    if (!result) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Sse(':jobId/events')
  events(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      void (async () => {
        await this.reports.waitUntilReady();
        const job = this.reports.getJob(jobId, user);
        const stream = this.reports.getStream(jobId);

      if (!job) {
        subscriber.next({ data: { type: 'error', message: 'Job not found' } as ServerEvent } as MessageEvent);
        subscriber.complete();
        return;
      }

      for (const event of job.events) {
        subscriber.next({ data: event } as MessageEvent);
      }

      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
        subscriber.next({ data: { type: 'done', jobId } as ServerEvent } as MessageEvent);
        subscriber.complete();
        return;
      }

      if (!stream) {
        subscriber.next({
          data: { type: 'error', message: 'Job event stream is unavailable after service restart.' } as ServerEvent,
        } as MessageEvent);
        subscriber.complete();
        return;
      }

      const subscription = stream.subscribe({
        next: (event) => subscriber.next({ data: event } as MessageEvent),
        complete: () => subscriber.complete(),
      });
        subscriber.add(() => subscription.unsubscribe());
      })().catch((error) => {
        subscriber.next({
          data: { type: 'error', message: error instanceof Error ? error.message : String(error) } as ServerEvent,
        } as MessageEvent);
        subscriber.complete();
      });

      return undefined;
    });
  }

  @Get(':jobId/result')
  async result(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const result = await this.reports.getResultFromDisk(jobId, user);
    if (result === undefined) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    if (result === null) {
      const job = this.reports.getJob(jobId);
      throw new HttpException({ error: 'Job not completed', status: job?.status }, HttpStatus.CONFLICT);
    }
    return result;
  }

  @Get(':jobId/database-sources')
  async databaseSources(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const result = await this.reports.getDatabaseSources(jobId, user);
    if (result === undefined) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get(':jobId/sources')
  async sources(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthUser,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const result = await this.reports.getSources(jobId, { type, page, pageSize }, user);
    if (result === undefined) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get(':jobId/download')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async download(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser, @Query('format') format = 'md') {
    const result = await this.reports.getMarkdownFromDisk(jobId, user);
    if (result === undefined) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    if (result === null || !result.markdown) {
      throw new HttpException({ error: 'Report not ready' }, HttpStatus.CONFLICT);
    }
    void format;
    return result.markdown;
  }
}
