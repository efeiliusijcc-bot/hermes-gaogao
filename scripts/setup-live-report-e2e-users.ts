import 'dotenv/config';
import { RolesService } from '../server/roles.service.js';
import { UsersService } from '../server/users.service.js';

if (process.env.RUN_LIVE_REPORT_E2E_TESTS !== 'true') throw new Error('RUN_LIVE_REPORT_E2E_TESTS=true is required.');

const roleName = 'retrieval_e2e_reporter';
const reporterPermissions = ['report:create', 'report:read', 'report:update', 'preference:read', 'preference:update', 'template:read'];
const roles = new RolesService();
const users = new UsersService();

function required(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function ensureUser(username: string, password: string, role: string, legacyRole: 'admin' | 'operator') {
  const existing = (await users.listUsers()).find((user) => user.username === username);
  if (existing) {
    await users.resetPassword(existing.id, password);
    return users.updateUser(existing.id, { role: legacyRole, roles: [role], isActive: true });
  }
  return users.createUser({ username, password, displayName: username, role: legacyRole, roles: [role] });
}

try {
  const existingRoles = await roles.listRoles();
  if (!existingRoles.some((role) => role.name === roleName)) {
    await roles.createRole({ name: roleName, description: 'Least-privilege live report E2E validation role', permissions: reporterPermissions });
  }
  const owner = await ensureUser(required('E2E_TEST_USERNAME'), required('E2E_TEST_PASSWORD'), roleName, 'operator');
  const peer = await ensureUser(required('E2E_PEER_USERNAME'), required('E2E_PEER_PASSWORD'), roleName, 'operator');
  const admin = await ensureUser(required('E2E_ADMIN_USERNAME'), required('E2E_ADMIN_PASSWORD'), 'admin', 'admin');
  console.log(JSON.stringify({ role: roleName, owner: owner.username, peer: peer.username, admin: admin.username, reporterPermissions }, null, 2));
} finally {
  await Promise.allSettled([roles.onModuleDestroy(), users.onModuleDestroy()]);
}
