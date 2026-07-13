export const BUSINESS_MODULES = ['report', 'qa', 'draft', 'daily']

export const SYSTEM_ROLE_MODULES = {
  admin: ['report', 'qa', 'draft', 'daily'],
}

const SYSTEM_ROLE_LABELS = {
  admin: '管理员',
  operator: '操作员',
  viewer: '观察员',
}

const MODULE_KEYS = new Set(BUSINESS_MODULES)

const MODULE_PERMISSION_HINTS = {
  report: [
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
  ],
  qa: ['chat:execute', 'chat:read'],
  draft: ['draft_assistant:create', 'draft_assistant:read', 'draft_assistant:update'],
  daily: ['daily_awareness:create', 'daily_awareness:read', 'daily_awareness:import'],
}

function uniqueStrings(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ))
}

export function normalizeModules(value) {
  return uniqueStrings(value).filter((module) => MODULE_KEYS.has(module))
}

export function modulesFromPermissions(permissions) {
  const permissionSet = new Set(uniqueStrings(permissions))
  return BUSINESS_MODULES.filter((module) => {
    return MODULE_PERMISSION_HINTS[module].every((permission) => permissionSet.has(permission))
  })
}

export function deriveUserModules(user) {
  if (user && Object.prototype.hasOwnProperty.call(user, 'modules')) {
    return normalizeModules(user.modules)
  }

  const explicitModules = normalizeModules(user?.modules)
  if (explicitModules.length) return explicitModules

  const permissionModules = modulesFromPermissions(user?.permissions)
  if (permissionModules.length) return permissionModules

  const roleNames = uniqueStrings(Array.isArray(user?.roles) ? user.roles : [user?.role])
  if (roleNames.includes('admin')) return SYSTEM_ROLE_MODULES.admin.slice()

  return []
}

export function deriveRoleModules(role) {
  if (role && Object.prototype.hasOwnProperty.call(role, 'modules')) {
    return normalizeModules(role.modules)
  }

  const explicitModules = normalizeModules(role?.modules)
  if (explicitModules.length) return explicitModules

  const permissionModules = modulesFromPermissions(role?.permissions)
  if (permissionModules.length) return permissionModules

  return String(role?.name || '').trim() === 'admin' ? SYSTEM_ROLE_MODULES.admin.slice() : []
}

export function roleDisplayName(role) {
  const value = String(role || '').trim()
  return SYSTEM_ROLE_LABELS[value] || value || '--'
}

export function displayUserRoleNames(user) {
  const hasExplicitRoles = user && Object.prototype.hasOwnProperty.call(user, 'roles') && Array.isArray(user.roles)
  const roles = uniqueStrings(hasExplicitRoles ? user.roles : [user?.role])
  return roles.map((role) => roleDisplayName(role)).join('、') || '暂无角色'
}
