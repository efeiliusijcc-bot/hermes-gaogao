import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Reflector } from '@nestjs/core';
import { DailyAwarenessAdminController } from '../server/daily-awareness-admin.controller.js';
import { DailyAwarenessController } from '../server/daily-awareness.controller.js';
import { PermissionsGuard } from '../server/permissions.guard.js';
import { SYSTEM_ROLE_PERMISSIONS, permissionsFromModules } from '../server/permission-modules.js';
import { AUTH_PERMISSIONS_KEY } from '../server/require-permissions.decorator.js';

test('admin role name does not bypass missing explicit permissions', () => {
  const guard = new PermissionsGuard({
    getAllAndOverride: () => ['daily-awareness:view'],
  } as unknown as Reflector);
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { role: 'admin', roles: ['admin'], permissions: [] } }),
    }),
  };

  assert.throws(
    () => guard.canActivate(context as never),
    (error) => {
      const response = (error as { getResponse?: () => unknown }).getResponse?.() as { error?: string } | undefined;
      return response?.error === 'Insufficient permissions';
    },
  );
});

test('daily module grants view only while admin fallback grants view and manage', () => {
  assert.deepEqual(permissionsFromModules(['daily']), ['daily-awareness:view']);
  assert.ok(SYSTEM_ROLE_PERMISSIONS.admin.includes('daily-awareness:view'));
  assert.ok(SYSTEM_ROLE_PERMISSIONS.admin.includes('system:daily-awareness:manage'));
});

test('daily awareness controllers declare exact V2 permissions', () => {
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessController.prototype.current), ['daily-awareness:view']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessController.prototype.history), ['daily-awareness:view']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessController.prototype.generate), ['system:daily-awareness:manage']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessController.prototype.importDraft), ['daily-awareness:view', 'draft_assistant:create']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessAdminController), ['system:daily-awareness:manage']);
});

test('RBAC migration retains old permissions and maps old read roles to new view', async () => {
  const sql = await readFile(new URL('../scripts/init-rbac.sql', import.meta.url), 'utf8');
  assert.match(sql, /'daily-awareness'\s*,\s*'view'/);
  assert.match(sql, /'system:daily-awareness'\s*,\s*'manage'/);
  assert.match(sql, /daily_awareness['"]?\s*,\s*['"]?read/is);
  assert.match(sql, /daily-awareness:view/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+permissions[^;]+daily_awareness/is);
});
