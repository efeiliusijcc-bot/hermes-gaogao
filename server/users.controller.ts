import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { Roles, RolesGuard } from './roles.guard.js';
import { UsersService } from './users.service.js';

@Controller('/api/users')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.listUsers();
  }

  @Post()
  create(@Body() body: { username?: string; password?: string; displayName?: string; email?: string | null; role?: string }) {
    return this.users.createUser(body || {});
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() body: { displayName?: string; email?: string | null; role?: string; isActive?: boolean },
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.users.updateUser(id, body || {}, currentUser);
  }

  @Put(':id/password')
  resetPassword(@Param('id') id: string, @Body() body: { password?: string }) {
    return this.users.resetPassword(id, String(body?.password || ''));
  }

  @Delete(':id')
  disable(@Param('id') id: string, @CurrentUser() currentUser: AuthUser) {
    return this.users.disableUser(id, currentUser);
  }
}
