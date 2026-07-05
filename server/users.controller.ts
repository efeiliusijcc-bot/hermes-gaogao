import { Body, Controller, Delete, Get, Inject, Optional, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogService } from './audit-log.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';
import { UsersService } from './users.service.js';

@Controller('/api/users')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('user:manage')
export class UsersController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService,
  ) {}

  @Get()
  list() {
    return this.users.listUsers();
  }

  @Post()
  async create(
    @Body() body: { username?: string; password?: string; displayName?: string; email?: string | null; role?: string; roles?: string[] },
    @CurrentUser() currentUser: AuthUser,
    @Req() request: Request,
  ) {
    const user = await this.users.createUser(body || {});
    await this.audit?.log({ actor: currentUser, action: 'user_create', resource: 'user', resourceId: user.id, request, detail: { username: user.username, roles: user.roles } });
    return user;
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() body: { displayName?: string; email?: string | null; role?: string; roles?: string[]; isActive?: boolean },
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.users.updateUser(id, body || {}, currentUser);
  }

  @Put(':id/password')
  async resetPassword(@Param('id') id: string, @Body() body: { password?: string }, @CurrentUser() currentUser: AuthUser, @Req() request: Request) {
    const user = await this.users.resetPassword(id, String(body?.password || ''));
    await this.audit?.log({ actor: currentUser, action: 'user_password_reset', resource: 'user', resourceId: id, request, detail: { username: user.username } });
    return user;
  }

  @Delete(':id')
  async disable(@Param('id') id: string, @CurrentUser() currentUser: AuthUser, @Req() request: Request) {
    const user = await this.users.disableUser(id, currentUser);
    await this.audit?.log({ actor: currentUser, action: 'user_disable', resource: 'user', resourceId: id, request, detail: { username: user.username } });
    return user;
  }
}
