import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import bcrypt from 'bcrypt';
import { AuthGuard } from '../server/auth.guard.js';
import { AuthService } from '../server/auth.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';
import { PermissionsGuard } from '../server/permissions.guard.js';
import { RolesController } from '../server/roles.controller.js';
import { RolesService } from '../server/roles.service.js';
import { UsersController } from '../server/users.controller.js';
import { UsersService } from '../server/users.service.js';

type Query = { text: string; params?: unknown[] };

function authUser(id: string, role: AuthUser['role'], permissions: string[]): AuthUser {
  return {
    id,
    username: `${role}-${id}`,
    displayName: '',
    email: null,
    role,
    roles: [role],
    permissions,
  };
}

async function assertStatus(response: Response, expected: number) {
  const text = await response.text();
  assert.equal(response.status, expected, text);
  return text ? JSON.parse(text) : null;
}

async function testRoleManagementHttpAccess() {
  const usersByToken: Record<string, AuthUser> = {
    admin: authUser('admin-1', 'admin', ['role:manage', 'user:manage']),
    operator: authUser('operator-1', 'operator', []),
    viewer: authUser('viewer-1', 'viewer', []),
  };

  @Module({
    controllers: [RolesController],
    providers: [
      Reflector,
      {
        provide: AuthService,
        useValue: {
          verifyAccessToken: async (token: string) => {
            const found = usersByToken[token];
            if (!found) throw new Error('invalid token');
            return found;
          },
        },
      },
      { provide: AuthGuard, useFactory: (auth: AuthService) => new AuthGuard(auth), inject: [AuthService] },
      { provide: PermissionsGuard, useFactory: (reflector: Reflector) => new PermissionsGuard(reflector), inject: [Reflector] },
      {
        provide: RolesService,
        useValue: {
          listRoles: async () => [{ id: 'role-admin', name: 'admin', description: '管理员', isSystem: true, permissions: ['role:manage'] }],
          listPermissions: async () => [{ resource: 'role', action: 'manage', permission: 'role:manage', description: '角色管理' }],
          createRole: async () => ({ id: 'role-editor', name: 'editor', description: '编报编辑员', isSystem: false, permissions: ['report:read'] }),
          updateRole: async () => ({ id: 'role-editor', name: 'editor', description: '新的描述', isSystem: false, permissions: ['report:read'] }),
          deleteRole: async () => ({ id: 'role-editor', deleted: true }),
        },
      },
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: ['error'] });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await assertStatus(await fetch(`${baseUrl}/api/roles`, { headers: { Authorization: 'Bearer admin' } }), 200);
    await assertStatus(await fetch(`${baseUrl}/api/roles`, { headers: { Authorization: 'Bearer operator' } }), 403);
    await assertStatus(await fetch(`${baseUrl}/api/roles`, { headers: { Authorization: 'Bearer viewer' } }), 403);
    await assertStatus(await fetch(`${baseUrl}/api/permissions`, { headers: { Authorization: 'Bearer admin' } }), 200);
  } finally {
    await app.close();
  }
}

async function testRolesServiceCrud() {
  const queries: Query[] = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('FROM roles r') && text.includes('GROUP BY')) {
        return { rows: [{ id: 'role-editor', name: 'editor', description: '编报编辑员', is_system: false, permissions: ['report:read'] }] };
      }
      if (text.includes('FROM permissions') && text.includes('ORDER BY resource')) {
        return { rows: [{ resource: 'report', action: 'read', description: '读取编报' }] };
      }
      if (text.includes('SELECT id, resource, action') && text.includes('FROM permissions')) {
        return { rows: [{ id: 'perm-report-read', resource: 'report', action: 'read' }] };
      }
      if (text.includes('INSERT INTO roles')) {
        return { rows: [{ id: 'role-editor', name: params?.[0], description: params?.[1], is_system: false }] };
      }
      if (text.includes('SELECT id, name, description, is_system') && params?.[0] === 'role-system') {
        return { rows: [{ id: 'role-system', name: 'admin', description: '管理员', is_system: true }] };
      }
      if (text.includes('SELECT id, name, description, is_system') && params?.[0] === 'role-editor') {
        return { rows: [{ id: 'role-editor', name: 'editor', description: '编报编辑员', is_system: false }] };
      }
      if (text.includes('SELECT 1 FROM user_roles') && params?.[0] === 'role-editor') {
        return { rows: [] };
      }
      if (text.includes('UPDATE roles')) {
        return { rows: [{ id: params?.[2], name: params?.[0], description: params?.[1], is_system: false }] };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
  const service = new RolesService() as RolesService & { getPool: () => Promise<typeof pool> };
  service.getPool = async () => pool;

  const permissions = await service.listPermissions();
  assert.deepEqual(permissions, [{ resource: 'report', action: 'read', permission: 'report:read', description: '读取编报' }]);

  const created = await service.createRole({ name: 'editor', description: '编报编辑员', permissions: ['report:read'] });
  assert.equal(created.name, 'editor');
  assert.deepEqual(created.permissions, ['report:read']);
  assert.ok(queries.some((query) => query.text === 'BEGIN'));
  assert.ok(queries.some((query) => query.text.includes('INSERT INTO role_permissions')));

  const updated = await service.updateRole('role-editor', { description: '新的描述', permissions: ['report:read'] });
  assert.equal(updated.description, '新的描述');

  await assert.rejects(() => service.deleteRole('role-system'), /System roles cannot be deleted/);
  const deleted = await service.deleteRole('role-editor');
  assert.deepEqual(deleted, { id: 'role-editor', deleted: true });
}

async function testUsersServiceMultiRolesAndLastAdmin() {
  const passwordHash = await bcrypt.hash('password123', 4);
  const queries: Query[] = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('SELECT id, name') && text.includes('FROM roles')) {
        const roleNames = (params?.[0] || []) as string[];
        return { rows: roleNames.map((name) => ({ id: `role-${name}`, name })) };
      }
      if (text.includes('INSERT INTO users')) {
        return { rows: [{
          id: 'user-1',
          username: params?.[0],
          display_name: params?.[2],
          email: params?.[3],
          role: params?.[4],
          is_active: true,
          created_at: '2026-07-05T00:00:00.000Z',
          updated_at: '2026-07-05T00:00:00.000Z',
        }] };
      }
      if (text.includes('SELECT u.id, u.username') && text.includes('WHERE u.id = $1')) {
        if (params?.[0] === 'admin-1') {
          return { rows: [{
            id: 'admin-1',
            username: 'admin',
            display_name: 'Admin',
            email: null,
            role: 'admin',
            is_active: true,
            created_at: '2026-07-05T00:00:00.000Z',
            updated_at: '2026-07-05T00:00:00.000Z',
            roles: ['admin'],
            permissions: ['user:manage'],
          }] };
        }
        return { rows: [{
          id: params?.[0],
          username: 'user1',
          display_name: '用户1',
          email: null,
          role: 'viewer',
          is_active: true,
          created_at: '2026-07-05T00:00:00.000Z',
          updated_at: '2026-07-05T00:00:00.000Z',
          roles: ['viewer', 'editor'],
          permissions: ['report:read', 'report:update'],
        }] };
      }
      if (text.includes('FROM users') && params?.[0] === 'user1') {
        return { rows: [{
          id: 'user-1',
          username: 'user1',
          password_hash: passwordHash,
          display_name: '用户1',
          email: null,
          role: 'viewer',
          is_active: true,
        }] };
      }
      if (text.includes('FROM user_roles') && params?.[0] === 'user-1') {
        return { rows: [
          { role_name: 'viewer', resource: 'report', action: 'read' },
          { role_name: 'editor', resource: 'report', action: 'update' },
        ] };
      }
      if (text.includes('COUNT(*)') && text.includes("r.name = 'admin'")) {
        return { rows: [{ count: '1' }] };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
  const users = new UsersService() as UsersService & { getPool: () => Promise<typeof pool> };
  users.getPool = async () => pool;

  const created = await users.createUser({
    username: 'user1',
    password: 'password123',
    displayName: '用户1',
    email: null,
    roles: ['viewer', 'editor'],
  });
  assert.deepEqual(created.roles, ['viewer', 'editor']);
  assert.equal(created.role, 'viewer');
  assert.ok(queries.some((query) => query.text.includes('INSERT INTO user_roles')));

  const auth = new AuthService() as AuthService & { getPool: () => Promise<typeof pool> };
  auth.getPool = async () => pool;
  const login = await auth.login('user1', 'password123');
  assert.deepEqual(login.user.roles, ['viewer', 'editor']);
  assert.ok(login.user.permissions.includes('report:update'));

  await assert.rejects(
    () => users.updateUser('admin-1', { roles: ['viewer'], role: 'viewer' }, authUser('admin-1', 'admin', ['user:manage'])),
    /last admin/i,
  );
}

await testRoleManagementHttpAccess();
await testRolesServiceCrud();
await testUsersServiceMultiRolesAndLastAdmin();
console.log('role management tests passed');
