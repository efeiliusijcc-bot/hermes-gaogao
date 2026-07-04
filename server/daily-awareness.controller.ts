import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { DailyAwarenessService } from './daily-awareness.service.js';
import type { DailyAwarenessGenerateInput } from './daily-awareness.types.js';
import { RolesGuard } from './roles.guard.js';

@Controller('/api/daily-awareness')
@UseGuards(AuthGuard, RolesGuard)
export class DailyAwarenessController {
  constructor(private readonly dailyAwareness: DailyAwarenessService) {}

  @Post('generate')
  generate(@Body() body: DailyAwarenessGenerateInput, @CurrentUser() user: AuthUser) {
    return this.dailyAwareness.generate(body || {}, user);
  }

  @Get('briefs')
  listBriefs(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('date') date: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dailyAwareness.listBriefs({ page, pageSize, date }, user);
  }

  @Get('briefs/:briefId')
  getBrief(@Param('briefId') briefId: string, @CurrentUser() user: AuthUser) {
    return this.dailyAwareness.getBrief(briefId, user);
  }

  @Get('briefs/:briefId/events')
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
  importDraft(@Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    return this.dailyAwareness.importEventToDraft(itemId, user);
  }
}
