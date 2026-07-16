import { Body, Controller, Get, HttpException, HttpStatus, Inject, Optional, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { DailyAwarenessService } from './daily-awareness.service.js';
import { DailyAwarenessQueryService } from './daily-awareness-query.service.js';
import type { DailyAwarenessGenerateInput } from './daily-awareness.types.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';

@Controller('/api/daily-awareness')
@UseGuards(AuthGuard, PermissionsGuard)
export class DailyAwarenessController {
  constructor(
    @Inject(DailyAwarenessService) private readonly dailyAwareness: DailyAwarenessService,
    @Optional() @Inject(DailyAwarenessQueryService) private readonly queryService?: DailyAwarenessQueryService,
  ) {}

  @Get('current')
  @RequirePermissions('daily-awareness:view')
  current(@Query('businessDate') businessDate?: string) {
    return this.query().current(businessDate || this.todayBusinessDate());
  }

  @Get('history')
  @RequirePermissions('daily-awareness:view')
  history(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.query().history({ page, pageSize, from, to });
  }

  @Get('briefs/by-date/:businessDate')
  @RequirePermissions('daily-awareness:view')
  getByDate(@Param('businessDate') businessDate: string) {
    return this.query().byDate(businessDate);
  }

  @Get('briefs/by-date/:businessDate/export')
  @RequirePermissions('daily-awareness:view')
  async exportByDate(
    @Param('businessDate') businessDate: string,
    @CurrentUser() user: AuthUser,
    @Query('format') format = 'docx',
    @Res() response: Response,
  ) {
    const brief = await this.query().byDate(businessDate);
    const result = await this.dailyAwareness.downloadBrief(brief.briefId, user, format);
    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
    response.send(result.buffer);
  }

  @Post('generate')
  @RequirePermissions('daily_awareness:create')
  generate(@Body() body: DailyAwarenessGenerateInput, @CurrentUser() user: AuthUser) {
    return this.dailyAwareness.generate(body || {}, user);
  }

  @Get('briefs')
  @RequirePermissions('daily_awareness:read')
  listBriefs(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('date') date: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dailyAwareness.listBriefs({ page, pageSize, date }, user);
  }

  @Get('briefs/:briefId')
  @RequirePermissions('daily_awareness:read')
  getBrief(@Param('briefId') briefId: string, @CurrentUser() user: AuthUser) {
    return this.dailyAwareness.getBrief(briefId, user);
  }

  @Get('briefs/:briefId/download')
  @RequirePermissions('daily_awareness:read')
  async downloadBrief(
    @Param('briefId') briefId: string,
    @CurrentUser() user: AuthUser,
    @Query('format') format = 'docx',
    @Res() response: Response,
  ) {
    const result = await this.dailyAwareness.downloadBrief(briefId, user, format);
    if (!result) throw new HttpException({ error: 'Daily brief not found' }, HttpStatus.NOT_FOUND);
    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
    response.send(result.buffer);
  }

  @Get('briefs/:briefId/events')
  @RequirePermissions('daily_awareness:read')
  listEvents(
    @Param('briefId') briefId: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('category') category: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dailyAwareness.listEvents(briefId, { page, pageSize, category }, user);
  }

  @Post('events/:itemId/import-draft')
  @RequirePermissions('daily_awareness:import')
  importDraft(@Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    return this.dailyAwareness.importEventToDraft(itemId, user);
  }

  private query(): DailyAwarenessQueryService {
    if (!this.queryService) throw new HttpException({ error: 'Daily awareness query service is unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    return this.queryService;
  }

  private todayBusinessDate(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.DAILY_AWARENESS_TIME_ZONE || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
}
