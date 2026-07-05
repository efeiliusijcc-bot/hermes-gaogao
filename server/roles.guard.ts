import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser, UserRole } from './auth-user.interface.js';

export const AUTH_ROLES_KEY = 'auth:roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(AUTH_ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(AUTH_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException({ error: 'User context is required' });
    }
    if (user.role === 'admin' || requiredRoles.includes(user.role)) {
      return true;
    }
    throw new ForbiddenException({ error: 'Insufficient role permissions' });
  }
}
