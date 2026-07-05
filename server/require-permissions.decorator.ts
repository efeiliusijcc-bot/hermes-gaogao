import { SetMetadata } from '@nestjs/common';

export type PermissionInput = string | { resource: string; action: string };

export const AUTH_PERMISSIONS_KEY = 'auth:permissions';

export function RequirePermissions(...permissions: PermissionInput[]) {
  return SetMetadata(AUTH_PERMISSIONS_KEY, permissions.map(normalizePermission));
}

function normalizePermission(permission: PermissionInput): string {
  if (typeof permission === 'string') return permission.trim();
  return `${String(permission.resource || '').trim()}:${String(permission.action || '').trim()}`;
}
