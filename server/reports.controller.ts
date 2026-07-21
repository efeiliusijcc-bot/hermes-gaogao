import { Body, Controller, Delete, Get, HttpException, HttpStatus, Inject, Param, Post, Query, Res, Sse, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
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
  @RequirePermissions('report:read')
  async list(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('type') type?: string,
    @Query('q') q?: string,
    @Query('mine') mine?: string,
    @Query('trash') trash?: string,
    @Query('createdAfter') createdAfter?: string,
  ) {
    return this.reports.listJobs({ page, pageSize, type, q, mine, trash, createdAfter }, user);
  }

  @Get(':jobId')
  @RequirePermissions('report:read')
  async get(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const job = await this.reports.getJobWithRecoveredReport(jobId, user);
    if (!job) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return this.reports.serializeJob(job);
  }

  @Post(':jobId/cancel')
  @RequirePermissions('report:update')
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
  @RequirePermissions('report:read')
  async listReportEdits(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.reports.listReportEdits(jobId, user);
  }

  @Post(':jobId/edits/:editId/apply')
  @RequirePermissions('report:update')
  applyReportEdit(@Param('jobId') jobId: string, @Param('editId') editId: string, @CurrentUser() user: AuthUser) {
    return this.reports.applyReportEdit(jobId, user, editId);
  }

  @Get(':jobId/quality-review')
  @RequirePermissions('report:read')
  getQualityReview(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.reports.getQualityReview(jobId, user);
  }

  @Post(':jobId/quality-review/run')
  @RequirePermissions('report:read')
  runQualityReview(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.reports.runQualityReview(jobId, user);
  }

  @Post(':jobId/restore')
  @RequirePermissions('report:update')
  async restore(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const job = await this.reports.restoreJob(jobId, user);
    if (!job) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return this.reports.serializeJob(job);
  }

  @Delete(':jobId/permanent')
  @RequirePermissions('report:delete')
  async permanentDelete(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.reports.permanentlyDeleteJob(jobId, user);
  }

  @Get(':jobId/progress')
  @RequirePermissions('report:read')
  async progress(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const result = await this.reports.getProgressState(jobId, user);
    if (!result) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get(':jobId/event-log')
  @RequirePermissions('report:read')
  eventLog(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const result = this.reports.getEventLog(jobId, user);
    if (!result) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Sse(':jobId/events')
  @RequirePermissions('report:read')
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
  @RequirePermissions('report:read')
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

  @Get(':jobId/artifacts')
  @RequirePermissions('report:read')
  async artifacts(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const result = await this.reports.getArtifacts(jobId, user);
    if (result === undefined) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get(':jobId/database-sources')
  @RequirePermissions('report:read')
  async databaseSources(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const result = await this.reports.getDatabaseSources(jobId, user);
    if (result === undefined) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get(':jobId/sources')
  @RequirePermissions('report:read')
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
  @RequirePermissions('report:read')
  async download(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
    @Query('format') format = 'md',
  ) {
    const result = await this.reports.getMarkdownFromDisk(jobId, user);
    if (result === undefined) {
      throw new HttpException({ error: 'Job not found' }, HttpStatus.NOT_FOUND);
    }
    if (result === null || !result.markdown) {
      throw new HttpException({ error: 'Report not ready' }, HttpStatus.CONFLICT);
    }
    void format;
    const artifact = result.artifact && typeof result.artifact === 'object' ? result.artifact as Record<string, unknown> : {};
    const sha256 = typeof artifact.sha256 === 'string' ? artifact.sha256 : '';
    const fileName = typeof artifact.fileName === 'string' && artifact.fileName ? artifact.fileName : `${jobId}.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/["\\\r\n]/g, '_')}"`);
    res.setHeader('Content-Length', String(Buffer.byteLength(result.markdown, 'utf8')));
    if (sha256) {
      res.setHeader('ETag', `"sha256-${sha256}"`);
      res.setHeader('X-Artifact-SHA256', sha256);
    }
    return result.markdown;
  }
}
