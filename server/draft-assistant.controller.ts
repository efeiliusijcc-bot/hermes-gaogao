import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { DraftAssistantService } from './draft-assistant.service.js';
import type { DraftAnalyzeInput, DraftOutlineImportInput, DraftOutlineInput, DraftOutlineManualInput, DraftOutlineRefineInput } from './draft-assistant.types.js';
import { Roles, RolesGuard } from './roles.guard.js';

@Controller('/api/draft-assistant')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin', 'operator', 'viewer')
export class DraftAssistantController {
  constructor(private readonly draftAssistant: DraftAssistantService) {}

  @Post('analyze')
  analyze(@Body() body: DraftAnalyzeInput, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.analyze(body || {}, user);
  }

  @Get('events')
  listEvents(@Query('page') page: string, @Query('pageSize') pageSize: string, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.listEvents(user, page, pageSize);
  }

  @Get('events/:eventId')
  getEvent(@Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.getEvent(eventId, user);
  }

  @Post('outline')
  generateOutline(@Body() body: DraftOutlineInput, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.generateOutline(body || {}, user);
  }

  @Post('outline/refine')
  refineOutline(@Body() body: DraftOutlineRefineInput, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.refineOutline(body || {}, user);
  }

  @Post('outline/manual-update')
  manualUpdateOutline(@Body() body: DraftOutlineManualInput, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.manualUpdateOutline(body || {}, user);
  }

  @Post('outline/import')
  importOutline(@Body() body: DraftOutlineImportInput, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.importOutlineToReportPlan(body || {}, user);
  }

  @Get('outlines/:outlineId')
  getOutline(@Param('outlineId') outlineId: string, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.getOutline(outlineId, user);
  }

  @Get('events/:eventId/outlines')
  listOutlines(@Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.draftAssistant.listOutlines(eventId, user);
  }
}
