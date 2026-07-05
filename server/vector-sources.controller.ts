import { Body, Controller, Get, Inject, Optional, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogService } from './audit-log.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';
import { Roles, RolesGuard } from './roles.guard.js';
import { VectorSourceService } from './vector-source.service.js';

@Controller('/api/vector-sources')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class VectorSourcesController {
  constructor(
    @Inject(VectorSourceService) private readonly vectorSources: VectorSourceService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService,
  ) {}

  @Get('status')
  @Roles('admin', 'operator', 'viewer')
  status() {
    return this.vectorSources.status();
  }

  @Get('profiles')
  @Roles('admin', 'operator', 'viewer')
  profiles() {
    return this.vectorSources.profiles();
  }

  @Post('profile')
  @Roles('admin')
  @RequirePermissions('vector_source:update')
  async switchProfile(@Body() body: { profile?: string } = {}, @CurrentUser() user: AuthUser, @Req() request: Request) {
    const result = await this.vectorSources.switchProfile(String(body?.profile || ''));
    await this.audit?.log({ actor: user, action: 'vector_source_profile_switch', resource: 'vector_source', request, detail: { profile: body?.profile || '' } });
    return result;
  }

  @Post('reindex')
  @Roles('admin')
  @RequirePermissions('vector_source:update')
  async reindex(@Body() body: { limit?: number } = {}, @CurrentUser() user: AuthUser, @Req() request: Request) {
    const result = await this.vectorSources.reindex(Number(body?.limit || 100));
    await this.audit?.log({ actor: user, action: 'vector_source_reindex', resource: 'vector_source', request, detail: { limit: Number(body?.limit || 100) } });
    return result;
  }
}
