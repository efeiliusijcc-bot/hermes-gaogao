import { Body, Controller, Delete, Get, Inject, Optional, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogService } from './audit-log.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';
import { UserPreferencesService } from './user-preferences.service.js';

@Controller('/api')
@UseGuards(AuthGuard, PermissionsGuard)
export class UserPreferencesController {
  constructor(
    @Inject(UserPreferencesService) private readonly preferences: UserPreferencesService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService,
  ) {}

  @Get('user-preferences/me')
  @RequirePermissions('preference:read')
  getMyPreferences(@CurrentUser() user: AuthUser) {
    return this.preferences.getMyPreferences(user);
  }

  @Put('user-preferences/me')
  @RequirePermissions('preference:update')
  async updateMyPreferences(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>, @Req() request: Request) {
    const result = await this.preferences.updateMyPreferences(user, body || {});
    await this.audit?.log({ actor: user, action: 'preference_update', resource: 'user_preference', resourceId: result.preferenceId || user.id, request });
    return result;
  }

  @Get('user-templates')
  @RequirePermissions('template:read')
  listTemplates(
    @CurrentUser() user: AuthUser,
    @Query('templateType') templateType?: string,
    @Query('ownerId') ownerId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.preferences.listTemplates(user, { templateType, ownerId, page, pageSize });
  }

  @Post('user-templates')
  @RequirePermissions('template:create')
  async createTemplate(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>, @Req() request: Request) {
    const result = await this.preferences.createTemplate(user, body || {});
    await this.audit?.log({
      actor: user,
      action: 'user_template_create',
      resource: 'user_template',
      resourceId: result.templateId,
      request,
      detail: { templateName: result.templateName, templateType: result.templateType },
    });
    return result;
  }

  @Put('user-templates/:templateId')
  @RequirePermissions('template:update')
  async updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
    @Body() body: Record<string, unknown>,
    @Req() request: Request,
  ) {
    const result = await this.preferences.updateTemplate(user, templateId, body || {});
    await this.audit?.log({
      actor: user,
      action: 'user_template_update',
      resource: 'user_template',
      resourceId: result.templateId,
      request,
      detail: { templateName: result.templateName, templateType: result.templateType, isDefault: result.isDefault },
    });
    return result;
  }

  @Delete('user-templates/:templateId')
  @RequirePermissions('template:delete')
  async deleteTemplate(@CurrentUser() user: AuthUser, @Param('templateId') templateId: string, @Req() request: Request) {
    const result = await this.preferences.deleteTemplate(user, templateId);
    await this.audit?.log({ actor: user, action: 'user_template_delete', resource: 'user_template', resourceId: templateId, request });
    return result;
  }

  @Post('user-templates/:templateId/apply')
  @RequirePermissions('template:read')
  applyTemplate(@CurrentUser() user: AuthUser, @Param('templateId') templateId: string) {
    return this.preferences.applyTemplate(user, templateId);
  }

  @Get('user-prompt-snippets')
  @RequirePermissions('template:read')
  listPromptSnippets(
    @CurrentUser() user: AuthUser,
    @Query('snippetType') snippetType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.preferences.listPromptSnippets(user, { snippetType, page, pageSize });
  }

  @Post('user-prompt-snippets')
  @RequirePermissions('template:create')
  async createPromptSnippet(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>, @Req() request: Request) {
    const result = await this.preferences.createPromptSnippet(user, body || {});
    await this.audit?.log({
      actor: user,
      action: 'prompt_snippet_create',
      resource: 'prompt_snippet',
      resourceId: result.snippetId,
      request,
      detail: { snippetName: result.snippetName, snippetType: result.snippetType },
    });
    return result;
  }

  @Put('user-prompt-snippets/:snippetId')
  @RequirePermissions('template:update')
  async updatePromptSnippet(
    @CurrentUser() user: AuthUser,
    @Param('snippetId') snippetId: string,
    @Body() body: Record<string, unknown>,
    @Req() request: Request,
  ) {
    const result = await this.preferences.updatePromptSnippet(user, snippetId, body || {});
    await this.audit?.log({
      actor: user,
      action: 'prompt_snippet_update',
      resource: 'prompt_snippet',
      resourceId: result.snippetId,
      request,
      detail: { snippetName: result.snippetName, snippetType: result.snippetType },
    });
    return result;
  }

  @Delete('user-prompt-snippets/:snippetId')
  @RequirePermissions('template:delete')
  async deletePromptSnippet(@CurrentUser() user: AuthUser, @Param('snippetId') snippetId: string, @Req() request: Request) {
    const result = await this.preferences.deletePromptSnippet(user, snippetId);
    await this.audit?.log({ actor: user, action: 'prompt_snippet_delete', resource: 'prompt_snippet', resourceId: snippetId, request });
    return result;
  }
}
