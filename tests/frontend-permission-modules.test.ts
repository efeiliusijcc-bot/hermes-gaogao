import assert from 'node:assert/strict';
import {
  deriveRoleModules,
  deriveUserModules,
  modulesFromPermissions,
} from '../b_k3ewYvsOEc1/src/lib/permissionModules.js';

function sameMembers(actual: string[], expected: string[]) {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

sameMembers(modulesFromPermissions(['report:create', 'chat:read', 'daily_awareness:read']), ['report', 'qa', 'daily']);
sameMembers(deriveUserModules({ modules: ['report', 'draft'], permissions: ['chat:read'] }), ['report', 'draft']);
sameMembers(deriveUserModules({ permissions: ['chat:execute', 'draft_assistant:create'] }), ['qa', 'draft']);
sameMembers(deriveUserModules({ role: 'admin', roles: ['admin'], modules: [], permissions: [] }), ['report', 'qa', 'draft', 'daily']);
sameMembers(deriveUserModules({ role: 'operator', modules: [], permissions: [] }), ['report', 'qa', 'draft', 'daily']);
sameMembers(deriveUserModules({ role: 'viewer', modules: [], permissions: [] }), ['qa', 'daily']);
sameMembers(deriveRoleModules({ name: 'editor', modules: [], permissions: ['report:create', 'chat:read'] }), ['report', 'qa']);
sameMembers(deriveRoleModules({ name: 'admin', modules: [], permissions: [] }), ['report', 'qa', 'draft', 'daily']);

console.log('frontend permission module tests passed');
