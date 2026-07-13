import assert from 'node:assert/strict';
import {
  deriveRoleModules,
  deriveUserModules,
  displayUserRoleNames,
  modulesFromPermissions,
} from '../b_k3ewYvsOEc1/src/lib/permissionModules.js';

function sameMembers(actual: string[], expected: string[]) {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

sameMembers(modulesFromPermissions(['report:create', 'chat:read', 'daily_awareness:read']), []);
sameMembers(modulesFromPermissions([
  'report:create',
  'report:read',
  'report:update',
  'crawler:create',
  'crawler:read',
  'crawler:execute',
  'template:create',
  'template:read',
  'template:update',
  'template:delete',
  'preference:read',
  'preference:update',
  'chat:execute',
  'chat:read',
  'daily_awareness:create',
  'daily_awareness:read',
  'daily_awareness:import',
]), ['report', 'qa', 'daily']);
sameMembers(modulesFromPermissions(['crawler:delete']), []);
sameMembers(deriveUserModules({ modules: ['report', 'draft'], permissions: ['chat:read'] }), ['report', 'draft']);
sameMembers(deriveUserModules({ modules: [], permissions: ['chat:read'], role: 'operator' }), []);
sameMembers(deriveUserModules({ permissions: ['chat:execute', 'draft_assistant:create'] }), []);
sameMembers(deriveUserModules({ role: 'admin', roles: ['admin'], permissions: [] }), ['report', 'qa', 'draft', 'daily']);
sameMembers(deriveUserModules({ role: 'operator', permissions: [] }), []);
sameMembers(deriveUserModules({ role: 'viewer', permissions: [] }), []);
assert.equal(displayUserRoleNames({ role: 'viewer', roles: ['test3'] }), 'test3');
assert.equal(displayUserRoleNames({ role: 'viewer', roles: ['viewer', 'test3'] }), '观察员、test3');
assert.equal(displayUserRoleNames({ role: 'viewer', roles: [] }), '暂无角色');
assert.equal(displayUserRoleNames({ role: 'viewer' }), '观察员');
sameMembers(deriveRoleModules({ name: 'editor', permissions: ['report:create', 'chat:read'] }), []);
sameMembers(deriveRoleModules({ name: 'operator', modules: [], permissions: ['report:create', 'chat:read'] }), []);
sameMembers(deriveRoleModules({ name: 'admin', permissions: [] }), ['report', 'qa', 'draft', 'daily']);

console.log('frontend permission module tests passed');
