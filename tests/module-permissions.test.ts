import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { AuthService } from '../server/auth.service.js';
import { modulesFromPermissions, permissionsFromModules } from '../server/permission-modules.js';
import { RolesService } from '../server/roles.service.js';
import { UsersService } from '../server/users.service.js';

type Query = { text: string; params?: unknown[] };

function sameMembers(actual: string[], expected: string[]) {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

function testPermissionModuleMappings() {
  const reportPermissions = permissionsFromModules(['report']);
  assert.ok(reportPermissions.includes('report:create'));
  assert.ok(reportPermissions.includes('crawler:execute'));
  assert.ok(reportPermissions.includes('template:update'));
  assert.ok(reportPermissions.includes('preference:update'));
  assert.ok(!reportPermissions.includes('report:delete'));
  assert.ok(!reportPermissions.includes('user:manage'));

  sameMembers(modulesFromPermissions(['report:read']), ['report']);
  sameMembers(modulesFromPermissions(['chat:execute']), ['qa']);
  sameMembers(modulesFromPermissions(['draft_assistant:read']), ['draft']);
  sameMembers(modulesFromPermissions(['daily_awareness:create']), ['daily']);
  sameMembers(modulesFromPermissions(permissionsFromModules(['daily'])), ['daily']);
  sameMembers(modulesFromPermissions(permissionsFromModules(['draft'])), ['draft']);
  sameMembers(modulesFromPermissions(permissionsFromModules(['report', 'draft'])), ['report', 'draft']);
}

async function testRolesServiceAcceptsModulesAndProtectsAdmin() {
  const queries: Query[] = [];
  const permissionIds = new Map<string, string>();
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('INSERT INTO roles')) {
        return { rows: [{ id: 'role-editor', name: params?.[0], description: params?.[1], is_system: false }] };
      }
      if (text.includes('SELECT id, name, description, is_system') && params?.[0] === 'role-admin') {
        return { rows: [{ id: 'role-admin', name: 'admin', description: '管理员', is_system: true }] };
      }
      if (text.includes('SELECT id, name, description, is_system') && params?.[0] === 'role-editor') {
        return { rows: [{ id: 'role-editor', name: 'editor', description: '编报编辑员', is_system: false }] };
      }
      if (text.includes('FROM permissions') && text.includes('WHERE concat')) {
        const permissions = params?.[0] as string[];
        return {
          rows: permissions.map((permission) => {
            const [resource, action] = permission.split(':');
            const id = `perm-${permission}`;
            permissionIds.set(permission, id);
            return { id, resource, action };
          }),
        };
      }
      if (text.includes('SELECT p.resource, p.action')) {
        return { rows: [
          { resource: 'user', action: 'manage' },
          { resource: 'role', action: 'manage' },
          { resource: 'report', action: 'delete' },
        ] };
      }
      if (text.includes('UPDATE roles')) {
        return { rows: [{ id: params?.[2], name: params?.[0], description: params?.[1], is_system: true }] };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };

  const service = new RolesService() as RolesService & { getPool: () => Promise<typeof pool> };
  service.getPool = async () => pool;

  const created = await service.createRole({ name: 'editor', description: '编报编辑员', modules: ['report', 'qa'] });
  sameMembers(created.modules, ['report', 'qa']);
  assert.ok(created.permissions.includes('report:create'));
  assert.ok(created.permissions.includes('chat:execute'));
  assert.ok(!created.permissions.includes('report:delete'));

  const updatedAdmin = await service.updateRole('role-admin', { modules: ['report'] });
  assert.ok(updatedAdmin.permissions.includes('user:manage'));
  assert.ok(updatedAdmin.permissions.includes('role:manage'));
  assert.ok(updatedAdmin.permissions.includes('report:delete'));
  assert.ok(updatedAdmin.permissions.includes('report:create'));
}

async function testUsersAndAuthExposeModules() {
  const passwordHash = await bcrypt.hash('password123', 4);
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      if (text.includes('FROM users') && params?.[0] === 'editor') {
        return { rows: [{
          id: 'user-1',
          username: 'editor',
          password_hash: passwordHash,
          display_name: 'Editor',
          email: null,
          role: 'viewer',
          is_active: true,
        }] };
      }
      if (text.includes('SELECT u.id, u.username') && !text.includes('WHERE u.id = $1')) {
        return { rows: [{
          id: 'user-1',
          username: 'editor',
          display_name: 'Editor',
          email: null,
          role: 'viewer',
          is_active: true,
          created_at: '2026-07-06T00:00:00.000Z',
          updated_at: '2026-07-06T00:00:00.000Z',
          roles: ['editor'],
          permissions: ['report:read', 'chat:execute', 'daily_awareness:read'],
        }] };
      }
      if (text.includes('FROM user_roles') && params?.[0] === 'user-1') {
        return { rows: [
          { role_name: 'editor', resource: 'report', action: 'read' },
          { role_name: 'editor', resource: 'chat', action: 'execute' },
          { role_name: 'editor', resource: 'daily_awareness', action: 'read' },
        ] };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };

  const users = new UsersService() as UsersService & { getPool: () => Promise<typeof pool> };
  users.getPool = async () => pool;
  const list = await users.listUsers();
  sameMembers(list[0].modules, ['report', 'qa', 'daily']);

  const auth = new AuthService() as AuthService & { getPool: () => Promise<typeof pool> };
  auth.getPool = async () => pool;
  const login = await auth.login('editor', 'password123');
  sameMembers(login.user.modules, ['report', 'qa', 'daily']);
  const decoded = jwt.decode(login.access_token) as { modules?: string[] };
  sameMembers(decoded.modules || [], ['report', 'qa', 'daily']);
}

async function testSystemRoleFallsBackWhenRbacPermissionsAreEmpty() {
  const passwordHash = await bcrypt.hash('password123', 4);
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      if (text.includes('FROM users') && params?.[0] === 'admin') {
        return { rows: [{
          id: 'admin-1',
          username: 'admin',
          password_hash: passwordHash,
          display_name: 'Administrator',
          email: null,
          role: 'admin',
          is_active: true,
        }] };
      }
      if (text.includes('FROM user_roles') && params?.[0] === 'admin-1') {
        return { rows: [{ role_name: 'admin', resource: null, action: null }] };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };

  const auth = new AuthService() as AuthService & { getPool: () => Promise<typeof pool> };
  auth.getPool = async () => pool;
  const login = await auth.login('admin', 'password123');
  sameMembers(login.user.roles, ['admin']);
  sameMembers(login.user.modules, ['report', 'qa', 'draft', 'daily']);
  assert.ok(login.user.permissions.includes('user:manage'));
  assert.ok(login.user.permissions.includes('role:manage'));
}

testPermissionModuleMappings();
await testRolesServiceAcceptsModulesAndProtectsAdmin();
await testUsersAndAuthExposeModules();
await testSystemRoleFallsBackWhenRbacPermissionsAreEmpty();

console.log('module permissions tests passed');
