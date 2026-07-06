import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CrawlerService } from './crawler.service.js';
import type { CreateCrawlerTaskInput } from './crawler.types.js';
import { CurrentUser } from './current-user.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';

@Controller('/api/crawler')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrawlerController {
  constructor(@Inject(CrawlerService) private readonly crawler: CrawlerService) {}

  @Post('tasks')
  @RequirePermissions('crawler:create')
  createTask(@Body() body: CreateCrawlerTaskInput, @CurrentUser() user: AuthUser) {
    return this.crawler.createTaskForUser(body || {}, user);
  }

  @Get('tasks')
  @RequirePermissions('crawler:read')
  listTasks(@CurrentUser() user: AuthUser) {
    return this.crawler.listTasks(user);
  }

  @Get('tasks/:taskId')
  @RequirePermissions('crawler:read')
  getTask(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    return this.crawler.getTask(taskId, user);
  }

  @Get('tasks/:taskId/items')
  @RequirePermissions('crawler:read')
  getTaskItems(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    return this.crawler.listItems(taskId, user);
  }

  @Post('tasks/:taskId/run')
  @RequirePermissions('crawler:execute')
  runTask(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    return this.crawler.runTaskForUser(taskId, user);
  }

  @Delete('tasks/:taskId')
  @RequirePermissions('crawler:delete')
  deleteTask(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    return this.crawler.deleteTask(taskId, user);
  }
}

@Controller('/api/internal/crawler')
export class InternalCrawlerController {
  constructor(@Inject(CrawlerService) private readonly crawler: CrawlerService) {}

  @Post('tasks')
  createTask(@Headers('x-internal-skill-token') token: string | undefined, @Body() body: CreateCrawlerTaskInput) {
    this.crawler.assertInternalToken(token);
    return this.crawler.createTask(body || {});
  }

  @Post('tasks/:taskId/run')
  runTask(@Headers('x-internal-skill-token') token: string | undefined, @Param('taskId') taskId: string) {
    this.crawler.assertInternalToken(token);
    return this.crawler.runTask(taskId);
  }

  @Get('tasks/:taskId/items')
  getTaskItems(@Headers('x-internal-skill-token') token: string | undefined, @Param('taskId') taskId: string) {
    this.crawler.assertInternalToken(token);
    return this.crawler.listItemsInternal(taskId);
  }
}
