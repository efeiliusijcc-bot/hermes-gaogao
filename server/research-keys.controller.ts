import { Body, Controller, Get, Inject, Optional, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogService } from './audit-log.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';
import { ResearchKeysService, type UpdateResearchKeysInput } from './research-keys.service.js';
import { Roles, RolesGuard } from './roles.guard.js';

@Controller('/api/research-keys')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class ResearchKeysController {
  constructor(
    @Inject(ResearchKeysService) private readonly researchKeys: ResearchKeysService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService,
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  getStatus() {
    return this.researchKeys.getStatus();
  }

  @Put()
  @Roles('admin')
  @RequirePermissions('research_key:update')
  async update(@Body() body: UpdateResearchKeysInput, @CurrentUser() user: AuthUser, @Req() request: Request) {
    const result = await this.researchKeys.updateKeys(body || {});
    await this.audit?.log({ actor: user, action: 'research_key_update', resource: 'research_key', request, detail: { updated: true } });
    return result;
  }
}
