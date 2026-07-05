import { Body, Controller, Delete, Get, Inject, Optional, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogService } from './audit-log.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';
import { RolesService } from './roles.service.js';

@Controller('/api')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('role:manage')
export class RolesController {
  constructor(
    @Inject(RolesService) private readonly roles: RolesService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService,
  ) {}

  @Get('roles')
  listRoles() {
    return this.roles.listRoles();
  }

  @Post('roles')
  async createRole(@Body() body: { name?: string; description?: string; permissions?: unknown }, @CurrentUser() user: AuthUser, @Req() request: Request) {
    const role = await this.roles.createRole(body || {});
    await this.audit?.log({ actor: user, action: 'role_create', resource: 'role', resourceId: role.id, request, detail: { roleName: role.name } });
    return role;
  }

  @Put('roles/:id')
  async updateRole(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; permissions?: unknown },
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const role = await this.roles.updateRole(id, body || {});
    await this.audit?.log({ actor: user, action: 'role_update', resource: 'role', resourceId: id, request, detail: { roleName: role.name, permissions: role.permissions } });
    return role;
  }

  @Delete('roles/:id')
  async deleteRole(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    const result = await this.roles.deleteRole(id);
    await this.audit?.log({ actor: user, action: 'role_delete', resource: 'role', resourceId: id, request });
    return result;
  }

  @Get('permissions')
  listPermissions() {
    return this.roles.listPermissions();
  }
}
