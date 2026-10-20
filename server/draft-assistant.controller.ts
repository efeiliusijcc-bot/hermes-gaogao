import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { DraftAnalysisJobsService } from './draft-analysis-jobs.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { DraftAssistantService } from './draft-assistant.service.js';
import type { DraftAnalyzeInput, DraftOutlineImportInput, DraftOutlineInput, DraftOutlineManualInput, DraftOutlineRefineInput } from './draft-assistant.types.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';

@Controller('/api/draft-assistant')
@UseGuards(AuthGuard, PermissionsGuard)
export class DraftAssistantController {
  constructor(
    @Inject(DraftAssistantService) private readonly draftAssistant: DraftAssistantService,
    @Inject(DraftAnalysisJobsService) private readonly analysisJobs: DraftAnalysisJobsService,
  ) {}

  @Post('analyze')
  @RequirePermissions('draft_assistant:create')
  analyze(@Body() body: DraftAnalyzeInput, @CurrentUser() user: AuthUser) {
    return this.analysisJobs.analyzeSync(body || {}, user);
  }

  @Post('analysis-jobs')
  @HttpCode(202)
  @RequirePermissions('draft_assistant:create')
  submitAnalysis(@Body() body: DraftAnalyzeInput & { clientRequestId?: string }, @CurrentUser() user: AuthUser) {
    return this.analysisJobs.submit(body || {}, user);
  }

  @Get('analysis-jobs')
  @RequirePermissions('draft_assistant:read')
  listAnalysis(@Query('clientRequestId') requestId: string, @CurrentUser() user: AuthUser) {
    return this.analysisJobs.list(user, requestId);
  }

  @Get('analysis-jobs/:jobId')
  @RequirePermissions('draft_assistant:read')
  getAnalysis(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.analysisJobs.get(jobId, user);
  }

  @Post('analysis-jobs/:jobId/retry')
  @HttpCode(202)
  @RequirePermissions('draft_assistant:create')
  retryAnalysis(@Param('jobId') jobId: string, @Body() body: { clientRequestId?: string }, @CurrentUser() user: AuthUser) {
    return this.analysisJobs.submit(body || {}, user, jobId);
  }

  @Get('events')
  @RequirePermissions('draft_assistant:read')
  listEvents(@Query('page') page: string, @Query('pageSize') pageSize: string, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.listEvents(user, page, pageSize);
  }

  @Get('events/:eventId')
  @RequirePermissions('draft_assistant:read')
  getEvent(@Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.getEvent(eventId, user);
  }

  @Post('outline')
  @RequirePermissions('draft_assistant:create')
  generateOutline(@Body() body: DraftOutlineInput, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.generateOutline(body || {}, user);
  }

  @Post('outline/refine')
  @RequirePermissions('draft_assistant:update')
  refineOutline(@Body() body: DraftOutlineRefineInput, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.refineOutline(body || {}, user);
  }

  @Post('outline/manual-update')
  @RequirePermissions('draft_assistant:update')
  manualUpdateOutline(@Body() body: DraftOutlineManualInput, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.manualUpdateOutline(body || {}, user);
  }

  @Post('outline/import')
  @RequirePermissions('draft_assistant:create')
  importOutline(@Body() body: DraftOutlineImportInput, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.importOutlineToReportPlan(body || {}, user);
  }

  @Get('outlines/:outlineId')
  @RequirePermissions('draft_assistant:read')
  getOutline(@Param('outlineId') outlineId: string, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.getOutline(outlineId, user);
  }

  @Get('events/:eventId/outlines')
  @RequirePermissions('draft_assistant:read')
  listOutlines(@Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.listOutlines(eventId, user);
  }
}
