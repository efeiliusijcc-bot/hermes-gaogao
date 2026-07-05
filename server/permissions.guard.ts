import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from './auth-user.interface.js';
import { AUTH_PERMISSIONS_KEY } from './require-permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(AUTH_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException({ error: 'User context is required' });
    }
    if (user.role === 'admin' || user.roles?.includes('admin')) {
      return true;
    }

    const permissions = new Set(user.permissions || []);
    if (requiredPermissions.every((permission) => permissions.has(permission))) {
      return true;
    }

    throw new ForbiddenException({ error: 'Insufficient permissions' });
  }
}
