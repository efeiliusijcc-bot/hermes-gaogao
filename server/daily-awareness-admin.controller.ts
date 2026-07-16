import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Optional, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogService } from './audit-log.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { DailyAwarenessAdminService } from './daily-awareness-admin.service.js';
import { DailyAwarenessConfigService } from './daily-awareness-config.service.js';
import type { DailyAwarenessConfig } from './daily-awareness.contracts.js';
import { DailyAwarenessGenerationService } from './daily-awareness-generation.service.js';
import { DailyAwarenessInboxService } from './daily-awareness-inbox.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';

@Controller('/api/admin/daily-awareness')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('system:daily-awareness:manage')
export class DailyAwarenessAdminController {
  constructor(
    @Inject(DailyAwarenessAdminService) private readonly admin: DailyAwarenessAdminService,
    @Inject(DailyAwarenessConfigService) private readonly config: DailyAwarenessConfigService,
    @Inject(DailyAwarenessInboxService) private readonly inbox: DailyAwarenessInboxService,
    @Inject(DailyAwarenessGenerationService) private readonly generation: DailyAwarenessGenerationService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService,
  ) {}

  @Get('status')
  status(@Query('businessDate') businessDate?: string) {
    return this.admin.status(businessDate);
  }

  @Get('config')
  getConfig() {
    return this.config.get();
  }

  @Put('config')
  async updateConfig(@Body() body: DailyAwarenessConfig, @CurrentUser() user: AuthUser, @Req() request: Request) {
    const before = await this.config.get();
    const result = await this.config.update(body, user.id);
    await this.audit?.log({ actor: user, action: 'daily_awareness_config_update', resource: 'daily_awareness_config', request, detail: { before, after: result } });
    return result;
  }

  @Get('runs')
  runs(@Query() query: Record<string, unknown>) {
    return this.admin.runs(query);
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.admin.run(id);
  }

  @Get('inbox')
  inboxItems(@Query() query: Record<string, unknown>) {
    return this.inbox.list(query);
  }

  @Post('inbox/:eventId/reprocess')
  @HttpCode(HttpStatus.ACCEPTED)
  async reprocess(@Param('eventId') eventId: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    const result = await this.inbox.reprocess(eventId, user.id);
    await this.audit?.log({ actor: user, action: 'daily_awareness_inbox_reprocess', resource: 'daily_awareness_event', resourceId: eventId, request });
    return result;
  }

  @Post('regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  async regenerate(
    @Body() body: { businessDate?: unknown; reason?: unknown; confirmOverwrite?: unknown },
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const result = await this.generation.regenerate(body || {}, user);
    await this.audit?.log({ actor: user, action: 'daily_awareness_regenerate', resource: 'daily_awareness_brief', resourceId: String(body.businessDate || ''), request, detail: { reason: String(body.reason || '') } });
    return result;
  }
}
